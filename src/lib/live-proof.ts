import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ArkhaiLiveProof,
  BlindArbiterCase,
  DeploymentProof,
  FinalCaseProof,
  LiveProofBundle,
  ProofReceipt,
  SepoliaEscrowSmokeProof,
} from "@/lib/types";

const ROOT = process.cwd();
const STATUS_DEPLOYMENT_FILE = path.join(ROOT, "runtime", "status-deployment.json");
const SEPOLIA_DEPLOYMENT_FILE = path.join(ROOT, "runtime", "sepolia-escrow-deployment.json");
const SEPOLIA_SMOKE_FILE = path.join(ROOT, "runtime", "sepolia-escrow-smoke.json");
const ARKHAI_LIVE_FILE = path.join(ROOT, "runtime", "arkhai-live-sepolia.json");

export async function loadLiveProof(cases: BlindArbiterCase[]): Promise<LiveProofBundle> {
  const [statusDeployment, sepoliaEscrowDeployment, rawSepoliaSmoke, arkhaiLive] = await Promise.all([
    readJsonFile<DeploymentProof>(STATUS_DEPLOYMENT_FILE),
    readJsonFile<DeploymentProof>(SEPOLIA_DEPLOYMENT_FILE),
    readJsonFile<Record<string, unknown>>(SEPOLIA_SMOKE_FILE),
    readJsonFile<ArkhaiLiveProof>(ARKHAI_LIVE_FILE),
  ]);

  const anchoredReceipts = collectAnchoredReceipts(cases);
  const sepoliaEscrowSmoke = normalizeSepoliaSmoke(rawSepoliaSmoke);

  return {
    statusDeployment,
    sepoliaEscrowDeployment,
    sepoliaEscrowSmoke,
    arkhaiLive,
    anchoredReceipts,
    summary: {
      statusReceiptCount: anchoredReceipts.length,
      sepoliaTxCount: sepoliaEscrowSmoke?.transactions.length || 0,
      canonicalCaseId: sepoliaEscrowSmoke?.caseId || null,
      arkhaiTxCount: arkhaiLive?.transactions.length || 0,
    },
  };
}

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function collectAnchoredReceipts(cases: BlindArbiterCase[]): ProofReceipt[] {
  return cases
    .flatMap((caseFile) =>
      caseFile.receipts
        .filter((receipt) => receipt.mode === "anchored" && receipt.txHash && receipt.explorerUrl)
        .map((receipt) => ({
          caseId: caseFile.id,
          caseTitle: caseFile.title,
          action: receipt.action,
          txHash: receipt.txHash!,
          explorerUrl: receipt.explorerUrl!,
          createdAt: receipt.createdAt,
          network: receipt.network,
          receiptHash: receipt.receiptHash,
        }))
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function normalizeSepoliaSmoke(raw: Record<string, unknown> | null): SepoliaEscrowSmokeProof | null {
  if (!raw) {
    return null;
  }

  const finalCase = normalizeFinalCase(raw.finalCase);
  const transactions = Array.isArray(raw.transactions)
    ? raw.transactions.map((item) => ({
        label: String((item as Record<string, unknown>).label || ""),
        txHash: String((item as Record<string, unknown>).txHash || ""),
        explorerUrl: String((item as Record<string, unknown>).explorerUrl || ""),
        blockNumber: String((item as Record<string, unknown>).blockNumber || ""),
        gasUsed: String((item as Record<string, unknown>).gasUsed || ""),
        status: String((item as Record<string, unknown>).status || ""),
      }))
    : [];

  return {
    network: String(raw.network || "ethereum-sepolia"),
    chainId: Number(raw.chainId || 11155111),
    contractAddress: String(raw.contractAddress || ""),
    operator: String(raw.operator || ""),
    roles: raw.roles && typeof raw.roles === "object"
      ? {
          buyer: String((raw.roles as Record<string, unknown>).buyer || ""),
          seller: String((raw.roles as Record<string, unknown>).seller || ""),
          arbiter: String((raw.roles as Record<string, unknown>).arbiter || ""),
          sellerFundingTxHash: ((raw.roles as Record<string, unknown>).sellerFundingTxHash as string | undefined) || null,
          sellerFundingExplorerUrl: ((raw.roles as Record<string, unknown>).sellerFundingExplorerUrl as string | undefined) || null,
          sellerBalanceEth: ((raw.roles as Record<string, unknown>).sellerBalanceEth as string | undefined) || null,
          distinctActors: Boolean((raw.roles as Record<string, unknown>).distinctActors),
        }
      : undefined,
    caseId: String(raw.caseId || ""),
    amountEth: String(raw.amountEth || ""),
    hashes: {
      specHash: String(((raw.hashes as Record<string, unknown> | undefined)?.specHash as string | undefined) || ""),
      deliverableHash: String(((raw.hashes as Record<string, unknown> | undefined)?.deliverableHash as string | undefined) || ""),
      verdictHash: String(((raw.hashes as Record<string, unknown> | undefined)?.verdictHash as string | undefined) || ""),
    },
    transactions,
    completedAt: raw.completedAt ? String(raw.completedAt) : null,
    finalCase,
  };
}

function normalizeFinalCase(value: unknown): FinalCaseProof | null {
  if (Array.isArray(value) && value.length >= 8) {
    return {
      buyer: String(value[0] || ""),
      seller: String(value[1] || ""),
      arbiter: String(value[2] || ""),
      amountWei: String(value[3] || "0"),
      specHash: String(value[4] || ""),
      deliverableHash: String(value[5] || ""),
      verdictHash: String(value[6] || ""),
      status: Number(value[7] || 0),
    };
  }

  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return {
      buyer: String(item.buyer || ""),
      seller: String(item.seller || ""),
      arbiter: String(item.arbiter || ""),
      amountWei: String(item.amountWei || "0"),
      specHash: String(item.specHash || ""),
      deliverableHash: String(item.deliverableHash || ""),
      verdictHash: String(item.verdictHash || ""),
      status: Number(item.status || 0),
    };
  }

  return null;
}
