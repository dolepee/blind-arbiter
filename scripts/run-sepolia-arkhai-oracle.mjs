import { readFile } from "node:fs/promises";
import path from "node:path";
import nodeHttp from "node:http";
import nodeHttps from "node:https";
import { fileURLToPath } from "node:url";

import { contractAddresses, makeClient } from "alkahest-ts";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeAbiParameters,
  defineChain,
  fromHex,
  http as viemHttp,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_EXPLORER_BASE_URL = "https://sepolia.etherscan.io";
const DEFAULT_CHAIN_ID = 11155111;
const DEFAULT_POLLING_INTERVAL = 5000;
const DEFAULT_LOOKBACK_BLOCKS = 2000n;
const ARBITRATION_REQUESTED_ABI = [
  {
    type: "event",
    name: "ArbitrationRequested",
    inputs: [
      { indexed: true, name: "obligation", type: "bytes32" },
      { indexed: true, name: "oracle", type: "address" },
      { indexed: false, name: "demand", type: "bytes" },
    ],
  },
];

function normalizePrivateKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}

async function loadEnvFile(file) {
  try {
    const raw = await readFile(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) {
        continue;
      }

      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) {
        continue;
      }

      const [, key, value] = match;
      if (process.env[key]) {
        continue;
      }

      let parsed = value.trim();
      if (
        (parsed.startsWith("\"") && parsed.endsWith("\"")) ||
        (parsed.startsWith("'") && parsed.endsWith("'"))
      ) {
        parsed = parsed.slice(1, -1);
      }

      process.env[key] = parsed;
    }
  } catch {
    // optional
  }
}

async function initializeEnvironment() {
  await loadEnvFile(path.join(ROOT, ".env.local"));
  await loadEnvFile(path.join(ROOT, ".env"));
}

function buildRpcTransport(rpcUrl) {
  return viemHttp(rpcUrl, {
    fetchFn: rpcNodeFetch,
  });
}

async function rpcNodeFetch(input, init = {}) {
  const url =
    typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
  const client = url.protocol === "https:" ? nodeHttps : nodeHttp;
  const headers = new Headers(init.headers);

  if (!headers.has("user-agent")) {
    headers.set("user-agent", "BlindArbiter/0.1");
  }

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: init.method || "GET",
        headers: Object.fromEntries(headers.entries()),
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode || 500,
              headers: response.headers,
            })
          );
        });
      }
    );

    request.on("error", reject);

    if (init.body) {
      if (typeof init.body === "string" || Buffer.isBuffer(init.body)) {
        request.write(init.body);
      } else if (init.body instanceof Uint8Array) {
        request.write(Buffer.from(init.body));
      } else {
        request.write(String(init.body));
      }
    }

    request.end();
  });
}

function getConfig() {
  const privateKeyValue =
    process.env.ARKHAI_PRIVATE_KEY ||
    process.env.SEPOLIA_PRIVATE_KEY ||
    process.env.STATUS_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    "";
  const chainId = Number(process.env.SEPOLIA_CHAIN_ID || DEFAULT_CHAIN_ID);
  const pollingInterval = Number(process.env.ARKHAI_ORACLE_POLL_INTERVAL_MS || DEFAULT_POLLING_INTERVAL);
  const lookbackBlocks = BigInt(process.env.ARKHAI_ORACLE_LOOKBACK_BLOCKS || String(DEFAULT_LOOKBACK_BLOCKS));

  return {
    rpcUrl: process.env.SEPOLIA_RPC_URL || DEFAULT_RPC_URL,
    explorerBaseUrl: process.env.SEPOLIA_EXPLORER_BASE_URL || DEFAULT_EXPLORER_BASE_URL,
    chainId: Number.isFinite(chainId) ? chainId : DEFAULT_CHAIN_ID,
    privateKey: privateKeyValue ? normalizePrivateKey(privateKeyValue) : null,
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    pollingInterval: Number.isFinite(pollingInterval) ? pollingInterval : DEFAULT_POLLING_INTERVAL,
    lookbackBlocks: lookbackBlocks > 0n ? lookbackBlocks : DEFAULT_LOOKBACK_BLOCKS,
  };
}

function getSepoliaChain(config) {
  return defineChain({
    id: config.chainId,
    name: "ethereum-sepolia",
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [config.rpcUrl],
      },
      public: {
        http: [config.rpcUrl],
      },
    },
    blockExplorers: {
      default: {
        name: "Etherscan",
        url: config.explorerBaseUrl,
      },
    },
    testnet: true,
  });
}

function compareLogsDescending(left, right) {
  const leftBlock = typeof left.blockNumber === "bigint" ? left.blockNumber : BigInt(left.blockNumber || 0);
  const rightBlock = typeof right.blockNumber === "bigint" ? right.blockNumber : BigInt(right.blockNumber || 0);

  if (leftBlock !== rightBlock) {
    return leftBlock > rightBlock ? -1 : 1;
  }

  const leftIndex = typeof left.logIndex === "bigint" ? left.logIndex : BigInt(left.logIndex || 0);
  const rightIndex = typeof right.logIndex === "bigint" ? right.logIndex : BigInt(right.logIndex || 0);

  if (leftIndex !== rightIndex) {
    return leftIndex > rightIndex ? -1 : 1;
  }

  return 0;
}

function decodeLlmDemand(data) {
  const llmAbi = parseAbiParameters(
    "(string arbitrationProvider, string arbitrationModel, string arbitrationPrompt, string demand)"
  );

  return decodeAbiParameters(llmAbi, data)[0];
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deterministicDecision(llmDemand, obligation) {
  const obligationText = normalize(obligation);
  const demandText = normalize(llmDemand.demand);
  const checks = [];

  const includesAny = (needles) => needles.some((needle) => obligationText.includes(needle));

  if (demandText.includes("review")) {
    checks.push({
      label: "reviewed",
      matched: includesAny(["reviewed", "review", "evaluated", "checked"]),
    });
  }

  if (demandText.includes("sealed") || demandText.includes("deliverable")) {
    checks.push({
      label: "sealed_deliverable",
      matched:
        includesAny(["sealed", "private"]) &&
        includesAny(["deliverable", "artifact", "work", "submission"]),
    });
  }

  if (demandText.includes("pass") || demandText.includes("satisfied") || demandText.includes("approved")) {
    checks.push({
      label: "pass_explained",
      matched:
        includesAny(["explain", "explained", "reason", "rationale"]) &&
        includesAny(["pass", "passed", "satisfied", "approved", "success"]),
    });
  }

  if (demandText.includes("hidden") || demandText.includes("private") || demandText.includes("reveal")) {
    checks.push({
      label: "privacy_preserved",
      matched: includesAny([
        "hidden",
        "redacted",
        "did not reveal",
        "not reveal",
        "kept private",
        "private artifact",
        "private work",
      ]),
    });
  }

  if (checks.length === 0) {
    checks.push({
      label: "non_empty_obligation",
      matched: obligationText.length > 0,
    });
  }

  const matches = checks.filter((check) => check.matched).map((check) => check.label);
  const ratio = checks.length === 0 ? 0 : matches.length / checks.length;

  return {
    decision: ratio >= 0.75,
    matched: matches,
    ratio,
  };
}

async function arbitrateWithOpenAI(apiKey, llmDemand, obligation) {
  const system =
    "You are an escrow arbitrator. Reply with only true or false. No explanation, no punctuation, no extra words.";
  const prompt = `${llmDemand.arbitrationPrompt}`
    .replace(/\{\{demand\}\}/g, llmDemand.demand)
    .replace(/\{\{obligation\}\}/g, obligation);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: llmDemand.arbitrationModel || "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${prompt}\nAnswer only true or false.` },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI arbitration failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content?.trim()?.toLowerCase() || "";

  if (text === "true") {
    return true;
  }

  if (text === "false") {
    return false;
  }

  throw new Error(`Unexpected arbitration response: ${text}`);
}

export async function runSepoliaArkhaiOracle() {
  await initializeEnvironment();
  const config = getConfig();

  if (!config.privateKey) {
    throw new Error("ARKHAI_PRIVATE_KEY, SEPOLIA_PRIVATE_KEY, STATUS_PRIVATE_KEY, or PRIVATE_KEY is required.");
  }

  const addresses = contractAddresses["Ethereum Sepolia"];
  if (!addresses?.trustedOracleArbiter) {
    throw new Error("Ethereum Sepolia Arkhai addresses are unavailable in alkahest-ts.");
  }

  const account = privateKeyToAccount(config.privateKey);
  const chain = getSepoliaChain(config);
  const publicClient = createPublicClient({
    chain,
    transport: buildRpcTransport(config.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: buildRpcTransport(config.rpcUrl),
  });
  const client = makeClient(walletClient, addresses);

  console.log(`[arkhai-oracle] operator=${account.address} rpc=${config.rpcUrl}`);
  console.log(`[arkhai-oracle] polling_interval_ms=${config.pollingInterval}`);
  console.log(`[arkhai-oracle] lookback_blocks=${config.lookbackBlocks.toString()}`);
  console.log("[arkhai-oracle] polling recent arbitration requests");

  const handled = new Set();
  let stopped = false;

  const shutdown = () => {
    stopped = true;
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopped) {
    const latestBlock = await publicClient.getBlockNumber();
    const fromBlock = latestBlock > config.lookbackBlocks ? latestBlock - config.lookbackBlocks : 0n;
    const logs = await publicClient.getLogs({
      address: addresses.trustedOracleArbiter,
      fromBlock,
      toBlock: "latest",
    });

    const recentLogs = [...logs].sort(compareLogsDescending);

    for (const log of recentLogs) {
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: ARBITRATION_REQUESTED_ABI,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        continue;
      }

      if (decoded.eventName !== "ArbitrationRequested") {
        continue;
      }

      const obligationUid = decoded.args.obligation;
      const oracle = decoded.args.oracle;
      const demand = decoded.args.demand;
      const requestKey = `${obligationUid}:${oracle}:${log.transactionHash}`;

      if (oracle.toLowerCase() !== account.address.toLowerCase() || handled.has(requestKey)) {
        continue;
      }

      const attestation = await client.getAttestation(obligationUid);
      const commitRevealData = client.commitReveal.decode(attestation.data);
      const obligation = fromHex(commitRevealData.payload, "string");
      const trustedOracleDemand = client.arbiters.general.trustedOracle.decodeDemand(demand);
      const llmDemand = decodeLlmDemand(trustedOracleDemand.data);

      console.log(`[arkhai-oracle] request_tx=${log.transactionHash}`);
      console.log(`[arkhai-oracle] attestation_uid=${obligationUid}`);
      console.log(`[arkhai-oracle] obligation=${obligation}`);
      console.log(`[arkhai-oracle] demand=${llmDemand.demand}`);
      console.log(`[arkhai-oracle] model=${llmDemand.arbitrationModel}`);

      let decision;
      if (config.openAiApiKey) {
        try {
          decision = await arbitrateWithOpenAI(config.openAiApiKey, llmDemand, obligation);
          console.log(`[arkhai-oracle] decision=${decision} source=openai`);
        } catch (error) {
          const fallback = deterministicDecision(llmDemand, obligation);
          decision = fallback.decision;
          console.log(
            `[arkhai-oracle] openai_unavailable=${error instanceof Error ? error.message : String(error)}`
          );
          console.log(
            `[arkhai-oracle] decision=${decision} source=deterministic_fallback ratio=${fallback.ratio.toFixed(2)} matched=${fallback.matched.join(",")}`
          );
        }
      } else {
        const fallback = deterministicDecision(llmDemand, obligation);
        decision = fallback.decision;
        console.log(
          `[arkhai-oracle] decision=${decision} source=deterministic_fallback ratio=${fallback.ratio.toFixed(2)} matched=${fallback.matched.join(",")}`
        );
      }

      const txHash = await client.arbiters.general.trustedOracle.arbitrate(
        obligationUid,
        trustedOracleDemand.data,
        decision
      );
      console.log(`[arkhai-oracle] arbitrate_tx=${txHash}`);
      handled.add(requestKey);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollingInterval));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSepoliaArkhaiOracle().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
