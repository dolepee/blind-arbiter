import { mkdir, readFile, writeFile } from "node:fs/promises";
import nodeHttp from "node:http";
import nodeHttps from "node:https";
import path from "node:path";

import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http as viemHttp,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { IntegrationReadiness, ReceiptDraft } from "@/lib/types";

const STATUS_NETWORK = "status-sepolia";
const DEFAULT_STATUS_RPC_URL = "https://public.sepolia.rpc.status.network";
const DEFAULT_STATUS_CHAIN_ID = 1660990954;
const DEFAULT_STATUS_EXPLORER_BASE_URL = "https://sepoliascan.status.network";
const ROOT = process.cwd();
const RUNTIME_DIR = path.join(ROOT, "runtime");
const STATUS_DEPLOYMENT_FILE = path.join(ROOT, "runtime", "status-deployment.json");
const CONTRACT_FILE = path.join(ROOT, "contracts", "BlindArbiterReceiptRegistry.sol");

let compiledContractPromise: Promise<CompiledContract> | null = null;

interface StatusConfig {
  rpcUrl: string;
  chainId: number;
  explorerBaseUrl: string;
  privateKey: Hex | null;
  registryAddress: Address | null;
}

export interface StatusDeployment {
  network: string;
  chainId: number;
  rpcUrl: string;
  contractAddress: Address;
  txHash: Hex;
  explorerUrl: string;
  deployedAt: string;
}

interface SolcOutput {
  contracts?: Record<
    string,
    Record<
      string,
      {
        abi: Abi;
        evm: {
          bytecode: {
            object: string;
          };
        };
      }
    >
  >;
  errors?: Array<{
    severity: "error" | "warning";
    formattedMessage: string;
  }>;
}

interface CompiledContract {
  abi: Abi;
  bytecode: Hex;
}

interface PublishStatusReceiptInput {
  caseId: string;
  action: ReceiptDraft["action"];
  payloadHash: string;
  note: string;
}

function now() {
  return new Date().toISOString();
}

function getStatusConfig(): StatusConfig {
  const privateKey = process.env.STATUS_PRIVATE_KEY ? normalizePrivateKey(process.env.STATUS_PRIVATE_KEY) : null;
  const registryAddress = process.env.STATUS_RECEIPT_REGISTRY_ADDRESS as Address | undefined;
  const parsedChainId = Number(process.env.STATUS_CHAIN_ID || DEFAULT_STATUS_CHAIN_ID);

  return {
    rpcUrl: process.env.STATUS_RPC_URL || DEFAULT_STATUS_RPC_URL,
    chainId: Number.isFinite(parsedChainId) ? parsedChainId : DEFAULT_STATUS_CHAIN_ID,
    explorerBaseUrl: process.env.STATUS_EXPLORER_BASE_URL || DEFAULT_STATUS_EXPLORER_BASE_URL,
    privateKey,
    registryAddress: registryAddress || null,
  };
}

export async function resolveStatusReadiness(): Promise<IntegrationReadiness["status"]> {
  const config = getStatusConfig();
  const deployment = await loadStatusDeployment();

  if (config.privateKey && (config.registryAddress || deployment?.contractAddress)) {
    return "ready";
  }
  if (config.privateKey) {
    return "planned";
  }
  return "local_stub";
}

export async function loadStatusDeployment(): Promise<StatusDeployment | null> {
  try {
    const raw = await readFile(STATUS_DEPLOYMENT_FILE, "utf8");
    return JSON.parse(raw) as StatusDeployment;
  } catch {
    return null;
  }
}

export async function deployBlindArbiterReceiptRegistry(): Promise<StatusDeployment> {
  const config = getStatusConfig();

  if (!config.privateKey) {
    throw new Error("STATUS_PRIVATE_KEY is required before deploying the BlindArbiter receipt registry.");
  }

  const chain = getStatusChain(config);
  const account = privateKeyToAccount(config.privateKey);
  const contract = await compileReceiptRegistry();
  const publicClient = createPublicClient({
    chain,
    transport: buildStatusTransport(config.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: buildStatusTransport(config.rpcUrl),
  });

  const txHash = await walletClient.deployContract({
    abi: contract.abi,
    bytecode: contract.bytecode,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (!receipt.contractAddress) {
    throw new Error("Status deployment receipt did not return a contract address.");
  }

  const deployment: StatusDeployment = {
    network: STATUS_NETWORK,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    contractAddress: receipt.contractAddress,
    txHash,
    explorerUrl: buildExplorerUrl(config.explorerBaseUrl, txHash),
    deployedAt: now(),
  };

  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(STATUS_DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2));
  return deployment;
}

export async function publishStatusReceipt(input: PublishStatusReceiptInput): Promise<ReceiptDraft> {
  const createdAt = now();
  const config = getStatusConfig();
  const deployment = await loadStatusDeployment();
  const registryAddress = config.registryAddress || deployment?.contractAddress || null;
  const receiptHash = computeStatusReceiptHash({
    caseId: input.caseId,
    action: input.action,
    payloadHash: input.payloadHash,
    note: input.note,
    createdAt,
  });

  if (!config.privateKey || !registryAddress) {
    return {
      network: STATUS_NETWORK,
      action: input.action,
      payloadHash: input.payloadHash,
      receiptHash,
      note: input.note,
      mode: "draft",
      createdAt,
      error: config.privateKey
        ? "Status wallet is configured but no receipt registry is deployed yet."
        : "Status wallet is not configured yet.",
    };
  }

  try {
    const chain = getStatusChain(config);
    const account = privateKeyToAccount(config.privateKey);
    const contract = await compileReceiptRegistry();
    const publicClient = createPublicClient({
      chain,
      transport: buildStatusTransport(config.rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: buildStatusTransport(config.rpcUrl),
    });

    const txHash = await walletClient.writeContract({
      address: registryAddress,
      abi: contract.abi,
      functionName: "anchorReceipt",
      args: [receiptHash, input.caseId, input.action, truncate(input.note.replace(/\s+/g, " ").trim(), 240)],
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      network: STATUS_NETWORK,
      action: input.action,
      payloadHash: input.payloadHash,
      receiptHash,
      note: input.note,
      mode: "anchored",
      createdAt,
      chainId: config.chainId,
      contractAddress: registryAddress,
      txHash,
      explorerUrl: buildExplorerUrl(config.explorerBaseUrl, txHash),
    };
  } catch (error) {
    return {
      network: STATUS_NETWORK,
      action: input.action,
      payloadHash: input.payloadHash,
      receiptHash,
      note: input.note,
      mode: "draft",
      createdAt,
      error: error instanceof Error ? error.message : "Status anchoring failed.",
    };
  }
}

export function computeStatusReceiptHash(input: {
  caseId: string;
  action: ReceiptDraft["action"];
  payloadHash: string;
  note: string;
  createdAt: string;
}): Hex {
  const canonical = JSON.stringify(
    {
      app: "BlindArbiter",
      version: 1,
      caseId: input.caseId,
      action: input.action,
      payloadHash: input.payloadHash,
      note: input.note,
      createdAt: input.createdAt,
    },
    null,
    2
  );

  return keccak256(stringToHex(canonical));
}

async function compileReceiptRegistry(): Promise<CompiledContract> {
  if (!compiledContractPromise) {
    compiledContractPromise = (async () => {
      const source = await readFile(CONTRACT_FILE, "utf8");
      const input = {
        language: "Solidity",
        sources: {
          "BlindArbiterReceiptRegistry.sol": {
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

      const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
      const errors = output.errors?.filter((item) => item.severity === "error") ?? [];

      if (errors.length > 0) {
        throw new Error(errors.map((item) => item.formattedMessage).join("\n\n"));
      }

      const contract = output.contracts?.["BlindArbiterReceiptRegistry.sol"]?.BlindArbiterReceiptRegistry;

      if (!contract?.evm.bytecode.object) {
        throw new Error("Failed to compile BlindArbiterReceiptRegistry.");
      }

      return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}` as Hex,
      };
    })();
  }

  return compiledContractPromise;
}

function buildStatusTransport(rpcUrl: string) {
  return viemHttp(rpcUrl, {
    fetchFn: statusNodeFetch,
  });
}

function getStatusChain(config: StatusConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: STATUS_NETWORK,
    nativeCurrency: {
      name: "Ether",
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
        name: "Status Explorer",
        url: config.explorerBaseUrl,
      },
    },
    testnet: true,
  });
}

function normalizePrivateKey(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

function buildExplorerUrl(baseUrl: string, txHash: Hex): string {
  return `${baseUrl}/tx/${txHash}`;
}

async function statusNodeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
  const client = url.protocol === "https:" ? nodeHttps : nodeHttp;
  const headers = new Headers(init?.headers);

  return new Promise<Response>((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: init?.method || "GET",
        headers: Object.fromEntries(headers.entries()),
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode || 500,
              headers: response.headers as HeadersInit,
            })
          );
        });
      }
    );

    request.on("error", reject);

    if (init?.body) {
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}
