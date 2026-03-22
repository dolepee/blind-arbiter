import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import nodeHttp from "node:http";
import nodeHttps from "node:https";
import { fileURLToPath } from "node:url";

import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http as viemHttp,
  keccak256,
  parseEther,
  formatEther,
  stringToHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(ROOT, "runtime");
const CONTRACT_FILE = path.join(ROOT, "contracts", "BlindArbiterEscrow.sol");
const DEPLOYMENT_FILE = path.join(RUNTIME_DIR, "sepolia-escrow-deployment.json");
const SMOKE_FILE = path.join(RUNTIME_DIR, "sepolia-escrow-smoke.json");
const COUNTERPARTY_FILE = path.join(RUNTIME_DIR, "sepolia-counterparty-wallet.json");
const DEFAULT_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_EXPLORER_BASE_URL = "https://sepolia.etherscan.io";
const DEFAULT_CHAIN_ID = 11155111;
const DEFAULT_COUNTERPARTY_BALANCE_ETH = "0.0012";
const DEFAULT_COUNTERPARTY_MIN_BALANCE_ETH = "0.0008";

let compiledContractPromise = null;

export async function initializeSepoliaEscrowEnvironment() {
  await loadEnvFile(path.join(ROOT, ".env.local"));
  await loadEnvFile(path.join(ROOT, ".env"));
}

export function getSepoliaEscrowConfig() {
  const privateKeyValue = process.env.SEPOLIA_PRIVATE_KEY || process.env.STATUS_PRIVATE_KEY || "";
  const chainId = Number(process.env.SEPOLIA_CHAIN_ID || DEFAULT_CHAIN_ID);

  return {
    rpcUrl: process.env.SEPOLIA_RPC_URL || DEFAULT_RPC_URL,
    explorerBaseUrl: process.env.SEPOLIA_EXPLORER_BASE_URL || DEFAULT_EXPLORER_BASE_URL,
    chainId: Number.isFinite(chainId) ? chainId : DEFAULT_CHAIN_ID,
    privateKey: privateKeyValue ? normalizePrivateKey(privateKeyValue) : null,
    configuredEscrowAddress: process.env.SEPOLIA_ESCROW_ADDRESS || null,
    smokeTestValueEth: process.env.SEPOLIA_SMOKE_TEST_VALUE_ETH || "0.001",
    counterpartyFundingEth: process.env.SEPOLIA_COUNTERPARTY_FUNDING_ETH || DEFAULT_COUNTERPARTY_BALANCE_ETH,
    counterpartyMinBalanceEth: process.env.SEPOLIA_COUNTERPARTY_MIN_BALANCE_ETH || DEFAULT_COUNTERPARTY_MIN_BALANCE_ETH,
  };
}

export async function loadSepoliaEscrowDeployment() {
  try {
    const raw = await readFile(DEPLOYMENT_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function deploySepoliaEscrow() {
  const config = getSepoliaEscrowConfig();

  if (!config.privateKey) {
    throw new Error("SEPOLIA_PRIVATE_KEY or STATUS_PRIVATE_KEY is required before deploying BlindArbiterEscrow.");
  }

  const account = privateKeyToAccount(config.privateKey);
  const chain = getSepoliaChain(config);
  const contract = await compileEscrowContract();
  const publicClient = createPublicClient({
    chain,
    transport: buildRpcTransport(config.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: buildRpcTransport(config.rpcUrl),
  });

  const txHash = await walletClient.deployContract({
    abi: contract.abi,
    bytecode: contract.bytecode,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (!receipt.contractAddress) {
    throw new Error("Ethereum Sepolia deployment receipt did not include a contract address.");
  }

  const deployment = {
    network: "ethereum-sepolia",
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    contractAddress: receipt.contractAddress,
    txHash,
    explorerUrl: buildExplorerUrl(config.explorerBaseUrl, txHash),
    deployer: account.address,
    deployedAt: new Date().toISOString(),
  };

  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2));

  return deployment;
}

export async function runSepoliaEscrowSmokeTest() {
  const config = getSepoliaEscrowConfig();

  if (!config.privateKey) {
    throw new Error("SEPOLIA_PRIVATE_KEY or STATUS_PRIVATE_KEY is required before running the Sepolia smoke test.");
  }

  const deployment = (await loadSepoliaEscrowDeployment()) || (config.configuredEscrowAddress
    ? { contractAddress: config.configuredEscrowAddress }
    : null);

  if (!deployment?.contractAddress) {
    throw new Error("No Ethereum Sepolia escrow deployment found. Deploy first or set SEPOLIA_ESCROW_ADDRESS.");
  }

  const account = privateKeyToAccount(config.privateKey);
  const chain = getSepoliaChain(config);
  const contract = await compileEscrowContract();
  const publicClient = createPublicClient({
    chain,
    transport: buildRpcTransport(config.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: buildRpcTransport(config.rpcUrl),
  });
  const counterparty = await ensureCounterpartyAccount({
    config,
    publicClient,
    walletClient,
  });
  const counterpartyWalletClient = createWalletClient({
    account: counterparty.account,
    chain,
    transport: buildRpcTransport(config.rpcUrl),
  });

  const contractAddress = deployment.contractAddress;
  const caseId = await publicClient.readContract({
    address: contractAddress,
    abi: contract.abi,
    functionName: "nextCaseId",
  });
  const specHash = keccak256(stringToHex(`BlindArbiter spec ${new Date().toISOString()}`));
  const deliverableHash = keccak256(stringToHex(`BlindArbiter deliverable ${new Date().toISOString()}`));
  const verdictHash = keccak256(stringToHex(`BlindArbiter verdict ${new Date().toISOString()}`));
  const amountWei = parseEther(config.smokeTestValueEth);
  const transactions = [];
  const report = {
    network: "ethereum-sepolia",
    chainId: config.chainId,
    contractAddress,
    operator: account.address,
    roles: {
      buyer: account.address,
      seller: counterparty.account.address,
      arbiter: account.address,
      sellerFundingTxHash: counterparty.fundingTxHash || null,
      sellerFundingExplorerUrl: counterparty.fundingTxHash
        ? buildExplorerUrl(config.explorerBaseUrl, counterparty.fundingTxHash)
        : null,
      sellerBalanceEth: counterparty.balanceEth,
      distinctActors: account.address.toLowerCase() !== counterparty.account.address.toLowerCase(),
    },
    caseId: caseId.toString(),
    amountEth: config.smokeTestValueEth,
    hashes: {
      specHash,
      deliverableHash,
      verdictHash,
    },
    transactions,
    completedAt: null,
  };

  await persistSmokeReport(report);

  const createTx = await walletClient.writeContract({
    address: contractAddress,
    abi: contract.abi,
    functionName: "createCase",
    args: [counterparty.account.address, account.address, specHash],
    value: amountWei,
  });
  transactions.push(await finalizeTransaction(publicClient, config.explorerBaseUrl, "create_case", createTx));
  await persistSmokeReport(report);

  const acceptTx = await counterpartyWalletClient.writeContract({
    address: contractAddress,
    abi: contract.abi,
    functionName: "acceptCase",
    args: [caseId],
  });
  transactions.push(await finalizeTransaction(publicClient, config.explorerBaseUrl, "accept_case", acceptTx));
  await persistSmokeReport(report);

  const submitTx = await counterpartyWalletClient.writeContract({
    address: contractAddress,
    abi: contract.abi,
    functionName: "submitDeliverable",
    args: [caseId, deliverableHash],
  });
  transactions.push(await finalizeTransaction(publicClient, config.explorerBaseUrl, "submit_deliverable", submitTx));
  await persistSmokeReport(report);

  const verdictTx = await walletClient.writeContract({
    address: contractAddress,
    abi: contract.abi,
    functionName: "postVerdict",
    args: [caseId, verdictHash, 4],
  });
  transactions.push(await finalizeTransaction(publicClient, config.explorerBaseUrl, "post_verdict", verdictTx));
  await persistSmokeReport(report);

  const releaseTx = await walletClient.writeContract({
    address: contractAddress,
    abi: contract.abi,
    functionName: "release",
    args: [caseId],
  });
  transactions.push(await finalizeTransaction(publicClient, config.explorerBaseUrl, "release", releaseTx));
  await persistSmokeReport(report);

  const finalCase = await publicClient.readContract({
    address: contractAddress,
    abi: contract.abi,
    functionName: "cases",
    args: [caseId],
  });

  report.finalCase = {
    buyer: finalCase[0],
    seller: finalCase[1],
    arbiter: finalCase[2],
    amountWei: finalCase[3].toString(),
    specHash: finalCase[4],
    deliverableHash: finalCase[5],
    verdictHash: finalCase[6],
    status: Number(finalCase[7]),
  };
  report.completedAt = new Date().toISOString();
  await persistSmokeReport(report);

  return report;
}

async function ensureCounterpartyAccount({
  config,
  publicClient,
  walletClient,
}) {
  const runtimeWallet = await loadCounterpartyWallet();
  const privateKey = runtimeWallet?.privateKey || generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const minBalanceWei = parseEther(config.counterpartyMinBalanceEth);
  const targetBalanceWei = parseEther(config.counterpartyFundingEth);
  const currentBalance = await publicClient.getBalance({ address: account.address });
  let fundingTxHash = null;

  if (currentBalance < minBalanceWei) {
    fundingTxHash = await walletClient.sendTransaction({
      to: account.address,
      value: currentBalance >= targetBalanceWei ? targetBalanceWei : targetBalanceWei - currentBalance,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundingTxHash });
  }

  const refreshedBalance = await publicClient.getBalance({ address: account.address });
  const payload = {
    label: runtimeWallet?.label || "BlindArbiter Sepolia seller",
    address: account.address,
    privateKey,
    createdAt: runtimeWallet?.createdAt || new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };
  await writeFile(COUNTERPARTY_FILE, JSON.stringify(payload, null, 2));

  return {
    account,
    fundingTxHash,
    balanceEth: formatEther(refreshedBalance),
  };
}

async function loadCounterpartyWallet() {
  try {
    const raw = await readFile(COUNTERPARTY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.privateKey) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function compileEscrowContract() {
  if (!compiledContractPromise) {
    compiledContractPromise = (async () => {
      const source = await readFile(CONTRACT_FILE, "utf8");
      const input = {
        language: "Solidity",
        sources: {
          "BlindArbiterEscrow.sol": {
            content: source,
          },
        },
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "paris",
          outputSelection: {
            "*": {
              "*": ["abi", "evm.bytecode.object"],
            },
          },
        },
      };

      const output = JSON.parse(solc.compile(JSON.stringify(input)));
      const errors = (output.errors || []).filter((item) => item.severity === "error");

      if (errors.length > 0) {
        throw new Error(errors.map((item) => item.formattedMessage).join("\n\n"));
      }

      const contract = output.contracts?.["BlindArbiterEscrow.sol"]?.BlindArbiterEscrow;

      if (!contract?.evm?.bytecode?.object) {
        throw new Error("Failed to compile BlindArbiterEscrow.");
      }

      return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
      };
    })();
  }

  return compiledContractPromise;
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

function buildRpcTransport(rpcUrl) {
  return viemHttp(rpcUrl, {
    fetchFn: rpcNodeFetch,
  });
}

async function finalizeTransaction(publicClient, explorerBaseUrl, label, txHash) {
  const receipt = await withRetry(
    () => publicClient.waitForTransactionReceipt({ hash: txHash }),
    `waiting for ${label} receipt`
  );

  return {
    label,
    txHash,
    explorerUrl: buildExplorerUrl(explorerBaseUrl, txHash),
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
  };
}

async function persistSmokeReport(report) {
  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(SMOKE_FILE, JSON.stringify(report, stringifyBigInts, 2));
}

function buildExplorerUrl(baseUrl, txHash) {
  return `${baseUrl}/tx/${txHash}`;
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
    // optional file
  }
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

function stringifyBigInts(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function formatJson(value) {
  return JSON.stringify(value, stringifyBigInts, 2);
}

async function withRetry(action, label, attempts = 4, delayMs = 2500) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /EAI_AGAIN|ECONNRESET|ETIMEDOUT|HTTP request failed/i.test(message);

      if (!transient || attempt === attempts) {
        throw new Error(`${label} failed after ${attempt} attempt(s): ${message}`);
      }

      await sleep(delayMs * attempt);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
