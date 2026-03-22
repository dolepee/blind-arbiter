import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import nodeHttp from "node:http";
import nodeHttps from "node:https";
import { fileURLToPath } from "node:url";

import {
  contractAddresses,
  contracts,
  fixtures,
  makeClient,
} from "alkahest-ts";
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  defineChain,
  encodeAbiParameters,
  http as viemHttp,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(ROOT, "runtime");
const LIVE_FILE = path.join(RUNTIME_DIR, "arkhai-live-sepolia.json");

const DEFAULT_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_EXPLORER_BASE_URL = "https://sepolia.etherscan.io";
const DEFAULT_CHAIN_ID = 11155111;
const DEFAULT_ORACLE_ADDRESS = "0xc5c132B69f57dAAAb75d9ebA86cab504b272Ccbc";
const DEFAULT_PROVIDER = "OpenAI";
const DEFAULT_MODEL = "gpt-4o-mini";

function now() {
  return new Date().toISOString();
}

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
  const amountRaw = BigInt(process.env.ARKHAI_ESCROW_AMOUNT_RAW || "100");
  const pollIntervalMs = Number(process.env.ARKHAI_POLL_INTERVAL_MS || "10000");
  const maxPollAttempts = Number(process.env.ARKHAI_MAX_POLL_ATTEMPTS || "24");

  return {
    rpcUrl: process.env.SEPOLIA_RPC_URL || DEFAULT_RPC_URL,
    explorerBaseUrl: process.env.SEPOLIA_EXPLORER_BASE_URL || DEFAULT_EXPLORER_BASE_URL,
    chainId: Number.isFinite(chainId) ? chainId : DEFAULT_CHAIN_ID,
    privateKey: privateKeyValue ? normalizePrivateKey(privateKeyValue) : null,
    oracleAddress: process.env.NLA_ORACLE_ADDRESS || DEFAULT_ORACLE_ADDRESS,
    arbitrationProvider: process.env.NLA_ARBITRATION_PROVIDER || DEFAULT_PROVIDER,
    arbitrationModel: process.env.NLA_ARBITRATION_MODEL || DEFAULT_MODEL,
    tokenName: process.env.ARKHAI_TOKEN_NAME || "BlindArbiter Demo Token",
    tokenSymbol: process.env.ARKHAI_TOKEN_SYMBOL || "BATD",
    amountRaw,
    pollIntervalMs: Number.isFinite(pollIntervalMs) ? pollIntervalMs : 10000,
    maxPollAttempts: Number.isFinite(maxPollAttempts) ? maxPollAttempts : 24,
    demand:
      process.env.ARKHAI_ESCROW_DEMAND ||
      "Release the escrow only if the fulfillment shows that BlindArbiter reviewed a sealed deliverable, explained why it passed, and kept the private work hidden.",
    fulfillment:
      process.env.ARKHAI_ESCROW_FULFILLMENT ||
      "BlindArbiter reviewed a sealed deliverable, confirmed the private work satisfied the milestone, explained the pass in redacted language, and did not reveal the private artifact.",
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

function buildExplorerUrl(baseUrl, txHash) {
  return `${baseUrl}/tx/${txHash}`;
}

function getSepoliaAddresses() {
  const addresses = contractAddresses["Ethereum Sepolia"];

  if (!addresses?.eas || !addresses?.trustedOracleArbiter || !addresses?.erc20EscrowObligation) {
    throw new Error("Ethereum Sepolia Alkahest addresses are unavailable in alkahest-ts.");
  }

  return addresses;
}

function buildArbitrationPrompt() {
  return [
    "You are arbitrating a Natural Language Agreement escrow.",
    "Demand: {{demand}}",
    "Fulfillment: {{obligation}}",
    "Return true only if the fulfillment clearly satisfies every explicit criterion in the demand.",
    "Return false if any criterion is missing, contradicted, or uncertain.",
  ].join("\n");
}

function buildLlmDemand(config) {
  const llmAbi = parseAbiParameters(
    "(string arbitrationProvider, string arbitrationModel, string arbitrationPrompt, string demand)"
  );

  return encodeAbiParameters(llmAbi, [
    {
      arbitrationProvider: config.arbitrationProvider,
      arbitrationModel: config.arbitrationModel,
      arbitrationPrompt: buildArbitrationPrompt(),
      demand: config.demand,
    },
  ]);
}

async function waitForDecision(publicClient, addresses, fromBlock, fulfillmentUid, config) {
  const eventAbi = contracts.IEAS.abi.abi;

  for (let attempt = 1; attempt <= config.maxPollAttempts; attempt += 1) {
    const events = await publicClient.getContractEvents({
      address: addresses.eas,
      abi: eventAbi,
      eventName: "Attested",
      fromBlock,
      toBlock: "latest",
    });

    const decisions = events.filter((event) => {
      const refUid = event.args?.refUID;
      return refUid && refUid.toLowerCase() === fulfillmentUid.toLowerCase();
    });

    if (decisions.length > 0) {
      const latest = decisions[decisions.length - 1];
      const decisionUid = latest.args?.uid;

      if (!decisionUid) {
        throw new Error("Decision event did not include a UID.");
      }

      const decisionAttestation = await publicClient.readContract({
        address: addresses.eas,
        abi: eventAbi,
        functionName: "getAttestation",
        args: [decisionUid],
      });
      const decisionAbi = parseAbiParameters("(bool item)");
      const decoded = decodeAbiParameters(decisionAbi, decisionAttestation.data);

      return {
        attempts: attempt,
        decisionUid,
        decision: Boolean(decoded[0].item),
        txHash: latest.transactionHash,
        explorerUrl: buildExplorerUrl(config.explorerBaseUrl, latest.transactionHash),
        attester: decisionAttestation.attester,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }

  throw new Error(`No arbitration decision found after ${config.maxPollAttempts} polling attempts.`);
}

function stringifyBigInts(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

export async function runSepoliaArkhaiLiveDemo() {
  await initializeEnvironment();

  const config = getConfig();

  if (!config.privateKey) {
    throw new Error("ARKHAI_PRIVATE_KEY, SEPOLIA_PRIVATE_KEY, STATUS_PRIVATE_KEY, or PRIVATE_KEY is required.");
  }

  const account = privateKeyToAccount(config.privateKey);
  const chain = getSepoliaChain(config);
  const addresses = getSepoliaAddresses();
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

  const nativeBalanceBefore = await publicClient.getBalance({ address: account.address });
  console.log(`[arkhai-live] operator=${account.address} rpc=${config.rpcUrl}`);
  console.log(`[arkhai-live] native_balance_before=${nativeBalanceBefore.toString()}`);

  console.log("[arkhai-live] deploying demo token");
  const tokenDeployHash = await walletClient.deployContract({
    abi: fixtures.MockERC20Permit.abi,
    bytecode: fixtures.MockERC20Permit.bytecode.object,
    args: [config.tokenName, config.tokenSymbol],
  });
  console.log(`[arkhai-live] token_deploy_tx=${tokenDeployHash}`);
  const tokenDeployReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenDeployHash });

  if (!tokenDeployReceipt.contractAddress) {
    throw new Error("Mock token deployment did not return a contract address.");
  }

  const tokenAddress = tokenDeployReceipt.contractAddress;
  const tokenBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: fixtures.MockERC20Permit.abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  const tokenTotalSupply = await publicClient.readContract({
    address: tokenAddress,
    abi: fixtures.MockERC20Permit.abi,
    functionName: "totalSupply",
  });

  if (tokenBalance < config.amountRaw) {
    throw new Error(`Mock token balance ${tokenBalance} is below required escrow amount ${config.amountRaw}.`);
  }
  console.log(
    `[arkhai-live] token=${tokenAddress} total_supply=${tokenTotalSupply.toString()} balance=${tokenBalance.toString()}`
  );

  const encodedDemand = buildLlmDemand(config);
  const trustedOracleDemand = client.arbiters.general.trustedOracle.encodeDemand({
    oracle: config.oracleAddress,
    data: encodedDemand,
  });

  console.log("[arkhai-live] creating escrow");
  const createResult = await client.erc20.escrow.nonTierable.permitAndCreate(
    {
      address: tokenAddress,
      value: config.amountRaw,
    },
    {
      arbiter: addresses.trustedOracleArbiter,
      demand: trustedOracleDemand,
    },
    0n
  );
  console.log(`[arkhai-live] escrow_create_tx=${createResult.hash}`);
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createResult.hash });
  const escrowUid = createResult.attested.uid;
  console.log(`[arkhai-live] escrow_uid=${escrowUid}`);

  console.log("[arkhai-live] creating direct string obligation fulfillment");
  const fulfillResult = await client.stringObligation.doObligation(config.fulfillment, undefined, escrowUid);
  console.log(`[arkhai-live] fulfill_tx=${fulfillResult.hash}`);
  await publicClient.waitForTransactionReceipt({ hash: fulfillResult.hash });
  const fulfillmentUid = fulfillResult.attested.uid;
  console.log(`[arkhai-live] fulfillment_uid=${fulfillmentUid}`);

  const escrowAttestation = await client.getAttestation(escrowUid);
  const decodedEscrow = client.erc20.escrow.nonTierable.decodeObligation(escrowAttestation.data);

  console.log(`[arkhai-live] requesting arbitration from oracle=${config.oracleAddress}`);
  const arbitrationRequestHash = await client.arbiters.general.trustedOracle.requestArbitration(
    fulfillmentUid,
    config.oracleAddress,
    decodedEscrow.demand
  );
  console.log(`[arkhai-live] arbitration_request_tx=${arbitrationRequestHash}`);
  const arbitrationRequestReceipt = await publicClient.waitForTransactionReceipt({
    hash: arbitrationRequestHash,
  });

  console.log("[arkhai-live] waiting for arbitration decision");
  const arbitration = await waitForDecision(
    publicClient,
    addresses,
    createReceipt.blockNumber,
    fulfillmentUid,
    config
  );
  console.log(
    `[arkhai-live] arbitration_decision=${arbitration.decision} decision_uid=${arbitration.decisionUid} tx=${arbitration.txHash}`
  );

  let collectHash = null;
  if (arbitration.decision) {
    console.log("[arkhai-live] collecting escrow");
    collectHash = await client.erc20.escrow.nonTierable.collect(escrowUid, fulfillmentUid);
    console.log(`[arkhai-live] collect_tx=${collectHash}`);
    await publicClient.waitForTransactionReceipt({ hash: collectHash });
  }

  const nativeBalanceAfter = await publicClient.getBalance({ address: account.address });
  const tokenBalanceAfter = await publicClient.readContract({
    address: tokenAddress,
    abi: fixtures.MockERC20Permit.abi,
    functionName: "balanceOf",
    args: [account.address],
  });

  const report = {
    generatedAt: now(),
    network: "ethereum-sepolia",
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    explorerBaseUrl: config.explorerBaseUrl,
    operator: account.address,
    oracleAddress: config.oracleAddress,
    trustedOracleArbiter: addresses.trustedOracleArbiter,
    eas: addresses.eas,
    demand: config.demand,
    fulfillment: config.fulfillment,
    token: {
      address: tokenAddress,
      symbol: config.tokenSymbol,
      amountRaw: config.amountRaw.toString(),
      deployTxHash: tokenDeployHash,
      deployExplorerUrl: buildExplorerUrl(config.explorerBaseUrl, tokenDeployHash),
      totalSupply: tokenTotalSupply.toString(),
      balanceBeforeEscrow: tokenBalance.toString(),
      balanceAfterLifecycle: tokenBalanceAfter.toString(),
    },
    nativeBalance: {
      before: nativeBalanceBefore.toString(),
      after: nativeBalanceAfter.toString(),
    },
    escrow: {
      uid: escrowUid,
      createTxHash: createResult.hash,
      createExplorerUrl: buildExplorerUrl(config.explorerBaseUrl, createResult.hash),
      createBlockNumber: createReceipt.blockNumber.toString(),
    },
    fulfillment: {
      kind: "string_obligation",
      uid: fulfillmentUid,
      fulfillTxHash: fulfillResult.hash,
      fulfillExplorerUrl: buildExplorerUrl(config.explorerBaseUrl, fulfillResult.hash),
      commitTxHash: null,
      commitExplorerUrl: null,
      reclaimBondTxHash: null,
      reclaimBondExplorerUrl: null,
    },
    arbitrationRequest: {
      txHash: arbitrationRequestHash,
      explorerUrl: buildExplorerUrl(config.explorerBaseUrl, arbitrationRequestHash),
      blockNumber: arbitrationRequestReceipt.blockNumber.toString(),
    },
    arbitration,
    collection: collectHash
      ? {
          txHash: collectHash,
          explorerUrl: buildExplorerUrl(config.explorerBaseUrl, collectHash),
        }
      : null,
  };

  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(LIVE_FILE, JSON.stringify(report, stringifyBigInts, 2));

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSepoliaArkhaiLiveDemo().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
