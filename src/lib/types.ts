export type BlindArbiterStatus =
  | "funded"
  | "accepted"
  | "submitted"
  | "under_review"
  | "passed"
  | "failed"
  | "needs_dispute"
  | "released"
  | "disputed";

export interface Participant {
  displayName: string;
  wallet?: string;
  selfId?: string;
  verified?: boolean;
}

export interface AcceptanceCriterion {
  id: string;
  label: string;
  description: string;
}

export interface MilestoneSpec {
  summary: string;
  privacyModel: "sealed_upload" | "private_prompt" | "tee_bundle";
  criteria: AcceptanceCriterion[];
}

export interface DeliverableSubmission {
  artifactName: string;
  artifactType: string;
  artifactHash: string;
  storageUri: string;
  narrative: string;
  submittedAt: string;
}

export interface CriterionReview {
  id: string;
  label: string;
  result: "pass" | "fail" | "unclear";
  notes: string;
}

export interface ReviewExecution {
  mode: "local_stub" | "ready";
  strategy: "deterministic_local" | "http_worker";
  image: string;
  workerVersion: string;
  requestHash: string;
  attestationHash: string;
  enclaveProof: string;
  workerUrl?: string;
  fallbackReason?: string;
}

export interface ArkhaiAgreementPacket {
  protocol: "natural-language-agreements";
  network: string;
  oracleAddress: string;
  tokenAddress: string;
  amount: string;
  llmDemand: {
    arbitrationProvider: string;
    arbitrationModel: string;
    arbitrationPrompt: string;
    demand: string;
  };
  encodedDemand: string;
  fulfillmentStatement?: string;
  createCommand: string;
  fulfillCommand?: string;
  statusCommand: string;
  collectCommand?: string;
  artifactJsonPath?: string;
  artifactMarkdownPath?: string;
  generatedAt: string;
}

export interface ReviewVerdict {
  verdict: "pass" | "fail" | "needs_dispute";
  confidence: number;
  redactedSummary: string;
  reportHash: string;
  criteria: CriterionReview[];
  recommendedAction: "release" | "dispute";
  computedAt: string;
  execution?: ReviewExecution;
}

export interface IntegrationReadiness {
  eigenCompute: "planned" | "local_stub" | "ready";
  self: "planned" | "local_stub" | "ready";
  status: "planned" | "local_stub" | "ready";
}

export interface ReceiptDraft {
  network: string;
  action: "verdict_posted" | "released" | "disputed";
  payloadHash: string;
  receiptHash: string;
  note: string;
  mode: "draft" | "anchored";
  createdAt: string;
  chainId?: number;
  contractAddress?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface BlindArbiterCase {
  id: string;
  title: string;
  amountUsd: number;
  buyer: Participant;
  seller?: Participant;
  operator: Participant;
  status: BlindArbiterStatus;
  createdAt: string;
  updatedAt: string;
  milestone: MilestoneSpec;
  submission?: DeliverableSubmission;
  review?: ReviewVerdict;
  arkhaiAgreement?: ArkhaiAgreementPacket;
  receipts: ReceiptDraft[];
  integrations: IntegrationReadiness;
}

export interface AgentLogEntry {
  id: string;
  caseId: string;
  kind: "case_created" | "case_accepted" | "deliverable_submitted" | "review_completed" | "released" | "disputed";
  message: string;
  createdAt: string;
}

export interface DeploymentProof {
  network: string;
  chainId: number;
  rpcUrl: string;
  contractAddress: string;
  txHash: string;
  explorerUrl: string;
  deployedAt: string;
  deployer?: string;
}

export interface ProofTransaction {
  label: string;
  txHash: string;
  explorerUrl: string;
  blockNumber: string;
  gasUsed: string;
  status: string;
}

export interface FinalCaseProof {
  buyer: string;
  seller: string;
  arbiter: string;
  amountWei: string;
  specHash: string;
  deliverableHash: string;
  verdictHash: string;
  status: number;
}

export interface SepoliaEscrowSmokeProof {
  network: string;
  chainId: number;
  contractAddress: string;
  operator: string;
  caseId: string;
  amountEth: string;
  hashes: {
    specHash: string;
    deliverableHash: string;
    verdictHash: string;
  };
  transactions: ProofTransaction[];
  completedAt: string | null;
  finalCase: FinalCaseProof | null;
}

export interface ArkhaiLifecycleTransaction {
  label: string;
  txHash: string;
  explorerUrl: string;
}

export interface ArkhaiLiveProof {
  generatedAt: string;
  network: string;
  chainId: number;
  operator: string;
  oracleAddress: string;
  trustedOracleArbiter: string;
  eas: string;
  demand: string;
  fulfillment: string;
  escrowUid: string;
  fulfillmentUid: string;
  decisionTxHash: string;
  decisionKey: string;
  collectionTxHash: string;
  token: {
    address: string;
    symbol: string;
    amountRaw: string;
    totalSupply: string;
    balanceBeforeEscrow: string;
    balanceAfterLifecycle: string;
  };
  nativeBalance: {
    before: string;
    after: string;
  };
  transactions: ArkhaiLifecycleTransaction[];
}

export interface ProofReceipt {
  caseId: string;
  caseTitle: string;
  action: ReceiptDraft["action"];
  txHash: string;
  explorerUrl: string;
  createdAt: string;
  network: string;
  receiptHash: string;
}

export interface LiveProofBundle {
  statusDeployment: DeploymentProof | null;
  sepoliaEscrowDeployment: DeploymentProof | null;
  sepoliaEscrowSmoke: SepoliaEscrowSmokeProof | null;
  arkhaiLive: ArkhaiLiveProof | null;
  anchoredReceipts: ProofReceipt[];
  summary: {
    statusReceiptCount: number;
    sepoliaTxCount: number;
    canonicalCaseId: string | null;
    arkhaiTxCount: number;
  };
}

export interface BlindArbiterDatabase {
  cases: BlindArbiterCase[];
  agentLog: AgentLogEntry[];
  proof?: LiveProofBundle;
}
