import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { isReadOnlyDeployment, READ_ONLY_MESSAGE } from "@/lib/deployment-mode";
import { persistArkhaiAgreement } from "@/lib/integrations/arkhai";
import { resolveEigenComputeReadiness } from "@/lib/integrations/eigencompute";
import { publishStatusReceipt, resolveStatusReadiness } from "@/lib/integrations/status";
import { loadLiveProof } from "@/lib/live-proof";
import type {
  AgentLogEntry,
  BlindArbiterCase,
  BlindArbiterDatabase,
  DeliverableSubmission,
  Participant,
  ReviewVerdict,
} from "@/lib/types";

const ROOT = process.cwd();
const RUNTIME_DIR = path.join(ROOT, "runtime");
const DB_FILE = path.join(RUNTIME_DIR, "blind-arbiter.json");
const AGENT_LOG_FILE = path.join(RUNTIME_DIR, "agent_log.json");
const DEMO_DB_FILE = path.join(ROOT, "data", "demo-db.json");

const DEMO_CASE_ID = "case-access-control-audit";

function now() {
  return new Date().toISOString();
}

async function seedCase(): Promise<BlindArbiterCase> {
  const createdAt = now();
  return {
    id: DEMO_CASE_ID,
    title: "Private patch verification for access control fix",
    amountUsd: 350,
    buyer: {
      displayName: "Acme Protocol",
      wallet: "0xBuyerDemo000000000000000000000000000000001",
      selfId: "self:buyer-demo",
      verified: true,
    },
    operator: {
      displayName: "BlindArbiter Operator",
      wallet: "0xArbiterDemo0000000000000000000000000000001",
      selfId: "self:operator-demo",
      verified: true,
    },
    status: "funded",
    createdAt,
    updatedAt: createdAt,
    milestone: {
      summary: "Release payment only if the private Solidity patch removes the access control issue and the acceptance narrative explains how tests were run.",
      privacyModel: "tee_bundle",
      criteria: [
        {
          id: "access-control",
          label: "Access control fix",
          description: "Submission must describe how privileged functions are protected after the patch.",
        },
        {
          id: "tests-pass",
          label: "Tests pass",
          description: "Submission must describe test coverage or test execution evidence.",
        },
        {
          id: "no-secret-leak",
          label: "No secret leakage",
          description: "Private material should stay sealed while still producing a verdict hash.",
        },
      ],
    },
    receipts: [],
    integrations: {
      eigenCompute: await resolveEigenComputeReadiness(),
      self: "local_stub",
      status: await resolveStatusReadiness(),
    },
  };
}

async function writeAgentLog(entries: AgentLogEntry[]) {
  await writeFile(AGENT_LOG_FILE, JSON.stringify(entries, null, 2));
}

async function ensureDb() {
  await mkdir(RUNTIME_DIR, { recursive: true });

  try {
    await readFile(DB_FILE, "utf8");
  } catch {
    const db: BlindArbiterDatabase = {
      cases: [await seedCase()],
      agentLog: [
        {
          id: randomUUID(),
          caseId: DEMO_CASE_ID,
          kind: "case_created",
          message: "Seeded the demo case so the review and settlement loop is visible immediately.",
          createdAt: now(),
        },
      ],
    };
    await writeFile(DB_FILE, JSON.stringify(db, null, 2));
    await writeAgentLog(db.agentLog);
  }
}

export async function readDb(): Promise<BlindArbiterDatabase> {
  if (isReadOnlyDeployment()) {
    return readSnapshotDb();
  }

  await ensureDb();
  const raw = await readFile(DB_FILE, "utf8");
  const db = JSON.parse(raw) as BlindArbiterDatabase;
  return {
    cases: db.cases,
    agentLog: db.agentLog,
    proof: await loadLiveProof(db.cases),
    readOnlyMode: false,
  };
}

async function writeDb(db: BlindArbiterDatabase) {
  await writeFile(
    DB_FILE,
    JSON.stringify(
      {
        cases: db.cases,
        agentLog: db.agentLog,
      },
      null,
      2
    )
  );
  await writeAgentLog(db.agentLog);
}

async function readSnapshotDb(): Promise<BlindArbiterDatabase> {
  const raw = await readFile(DEMO_DB_FILE, "utf8");
  const db = JSON.parse(raw) as BlindArbiterDatabase;
  return {
    cases: db.cases,
    agentLog: db.agentLog,
    proof: db.proof,
    readOnlyMode: true,
  };
}

function assertWritableMode() {
  if (isReadOnlyDeployment()) {
    throw new Error(READ_ONLY_MESSAGE);
  }
}

function logEntry(caseId: string, kind: AgentLogEntry["kind"], message: string): AgentLogEntry {
  return {
    id: randomUUID(),
    caseId,
    kind,
    message,
    createdAt: now(),
  };
}

export async function createCase(input: {
  title: string;
  amountUsd: number;
  summary: string;
  buyerName: string;
  buyerWallet?: string;
  buyerSelfId?: string;
  criteria: string[];
}) {
  assertWritableMode();

  if (!input.title) {
    throw new Error("Title is required.");
  }
  if (!input.buyerName) {
    throw new Error("Buyer name is required.");
  }
  if (!input.summary) {
    throw new Error("Milestone summary is required.");
  }
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  const db = await readDb();
  const timestamp = now();
  const newCase: BlindArbiterCase = {
    id: randomUUID(),
    title: input.title,
    amountUsd: input.amountUsd,
    buyer: {
      displayName: input.buyerName,
      wallet: input.buyerWallet,
      selfId: input.buyerSelfId || "self:pending-buyer",
      verified: Boolean(input.buyerSelfId),
    },
    operator: {
      displayName: "BlindArbiter Operator",
      wallet: "0xArbiterLocal000000000000000000000000000001",
      selfId: "self:operator-local",
      verified: true,
    },
    status: "funded",
    createdAt: timestamp,
    updatedAt: timestamp,
    milestone: {
      summary: input.summary,
      privacyModel: "tee_bundle",
      criteria: input.criteria.map((criterion, index) => ({
        id: `criterion-${index + 1}`,
        label: criterion,
        description: criterion,
      })),
    },
    receipts: [],
    integrations: {
      eigenCompute: await resolveEigenComputeReadiness(),
      self: "local_stub",
      status: await resolveStatusReadiness(),
    },
  };

  db.cases.unshift(newCase);
  db.agentLog.unshift(logEntry(newCase.id, "case_created", `Case created and escrow marked as funded for ${input.amountUsd} USD.`));
  await writeDb(db);
  return newCase;
}

export async function acceptCase(caseId: string, seller: Participant) {
  assertWritableMode();

  const db = await readDb();
  const found = db.cases.find((item) => item.id === caseId);
  if (!found) {
    throw new Error("Case not found.");
  }
  if (found.status !== "funded") {
    throw new Error("Only funded cases can be accepted.");
  }
  if (!seller.displayName.trim()) {
    throw new Error("Seller name is required.");
  }

  found.seller = seller;
  found.status = "accepted";
  found.updatedAt = now();
  found.integrations.self = seller.selfId ? "ready" : "local_stub";
  db.agentLog.unshift(logEntry(caseId, "case_accepted", `${seller.displayName} accepted the milestone and bound identity.`));
  await writeDb(db);
  return found;
}

export async function submitDeliverable(caseId: string, submission: Omit<DeliverableSubmission, "submittedAt">) {
  assertWritableMode();

  const db = await readDb();
  const found = db.cases.find((item) => item.id === caseId);
  if (!found) {
    throw new Error("Case not found.");
  }
  if (found.status !== "accepted" && found.status !== "disputed") {
    throw new Error("Case must be accepted before submission.");
  }
  if (!submission.artifactName.trim()) {
    throw new Error("Artifact name is required.");
  }
  if (!submission.narrative.trim()) {
    throw new Error("Private narrative is required.");
  }

  found.submission = {
    ...submission,
    submittedAt: now(),
  };
  found.status = "submitted";
  found.updatedAt = now();
  db.agentLog.unshift(logEntry(caseId, "deliverable_submitted", `Private deliverable ${submission.artifactName} was sealed for review.`));
  await writeDb(db);
  return found;
}

export async function completeReview(caseId: string, review: ReviewVerdict) {
  assertWritableMode();

  const db = await readDb();
  const found = db.cases.find((item) => item.id === caseId);
  if (!found) {
    throw new Error("Case not found.");
  }
  found.review = review;
  found.status =
    review.verdict === "pass"
      ? "passed"
      : review.verdict === "fail"
        ? "failed"
      : "needs_dispute";
  found.updatedAt = now();
  const receipt = await publishStatusReceipt({
    caseId,
    action: "verdict_posted",
    payloadHash: review.reportHash,
    note: "Verdict hash prepared for Status publication.",
  });
  found.receipts.unshift(receipt);
  found.arkhaiAgreement = await persistArkhaiAgreement(found);
  found.integrations.eigenCompute = review.execution?.mode === "ready" ? "ready" : await resolveEigenComputeReadiness();
  found.integrations.status = receipt.mode === "anchored" ? "ready" : await resolveStatusReadiness();
  db.agentLog.unshift(
    logEntry(caseId, "review_completed", `Review completed with verdict ${review.verdict} at confidence ${review.confidence}.`)
  );
  await writeDb(db);
  return found;
}

export async function releaseCase(caseId: string) {
  assertWritableMode();

  const db = await readDb();
  const found = db.cases.find((item) => item.id === caseId);
  if (!found) {
    throw new Error("Case not found.");
  }
  if (found.status !== "passed") {
    throw new Error("Only passed cases can be released.");
  }

  found.status = "released";
  found.updatedAt = now();
  const receipt = await publishStatusReceipt({
    caseId,
    action: "released",
    payloadHash: found.review?.reportHash || "0x0",
    note: "Settlement release prepared for Status publication.",
  });
  found.receipts.unshift(receipt);
  found.arkhaiAgreement = await persistArkhaiAgreement(found);
  found.integrations.status = receipt.mode === "anchored" ? "ready" : await resolveStatusReadiness();
  db.agentLog.unshift(logEntry(caseId, "released", "Escrow marked as released from the BlindArbiter verdict."));
  await writeDb(db);
  return found;
}

export async function disputeCase(caseId: string, reason: string) {
  assertWritableMode();

  const db = await readDb();
  const found = db.cases.find((item) => item.id === caseId);
  if (!found) {
    throw new Error("Case not found.");
  }
  if (!["failed", "needs_dispute", "submitted", "accepted"].includes(found.status)) {
    throw new Error("This case cannot be disputed from its current status.");
  }

  found.status = "disputed";
  found.updatedAt = now();
  const receipt = await publishStatusReceipt({
    caseId,
    action: "disputed",
    payloadHash: found.review?.reportHash || "0x0",
    note: `Dispute opened: ${reason}`,
  });
  found.receipts.unshift(receipt);
  found.arkhaiAgreement = await persistArkhaiAgreement(found);
  found.integrations.status = receipt.mode === "anchored" ? "ready" : await resolveStatusReadiness();
  db.agentLog.unshift(logEntry(caseId, "disputed", `Dispute opened with reason: ${reason}`));
  await writeDb(db);
  return found;
}
