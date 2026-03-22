"use client";

import { useState, useTransition } from "react";

import { READ_ONLY_MESSAGE } from "@/lib/deployment-mode";
import type { BlindArbiterCase, BlindArbiterDatabase, LiveProofBundle } from "@/lib/types";

interface WorkbenchProps {
  initialData: BlindArbiterDatabase;
}

interface CreateFormState {
  title: string;
  amountUsd: string;
  buyerName: string;
  buyerWallet: string;
  buyerSelfId: string;
  summary: string;
  criteria: string;
}

const initialCreateForm: CreateFormState = {
  title: "Private deliverable review for milestone 1",
  amountUsd: "250",
  buyerName: "Builder Team",
  buyerWallet: "0xBuyer000000000000000000000000000000000000",
  buyerSelfId: "self:buyer-local",
  summary: "Release escrow only if the private deliverable satisfies the stated milestone conditions.",
  criteria: "Acceptance criteria are fully addressed\nPrivate evidence supports each claim\nRedacted reasoning is enough to justify release",
};

async function postJson(url: string, payload?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function formatStatus(status: BlindArbiterCase["status"]) {
  return status.replaceAll("_", " ");
}

function formatOnchainCaseStatus(status: number) {
  const labels = [
    "none",
    "funded",
    "accepted",
    "submitted",
    "passed",
    "failed",
    "needs dispute",
    "released",
    "disputed",
    "refunded",
  ];

  return labels[status] || `unknown (${status})`;
}

function shortHash(value: string, start = 8, end = 6) {
  if (!value || value.length <= start + end + 3) {
    return value;
  }

  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

const docsUrl = "https://github.com/dolepee/blind-arbiter#readme";
const deployUrl = "https://github.com/dolepee/blind-arbiter#run-locally";

export function Workbench({ initialData }: WorkbenchProps) {
  const [data, setData] = useState(initialData);
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const counts = {
    released: data.cases.filter((item) => item.status === "released").length,
    ready: data.cases.filter((item) => item.status === "passed").length,
    reviewable: data.cases.filter((item) => item.status === "submitted").length,
  };
  const readOnlyMode = data.readOnlyMode === true;
  const proof = data.proof;
  const latestAgentEvent = [...data.agentLog].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
  const canonicalCase = data.cases.find((item) => item.status === "released") ?? data.cases[0];
  const latestVerdictReceipt = proof?.anchoredReceipts.find((receipt) => receipt.action === "verdict_posted");
  const latestDisputeReceipt = proof?.anchoredReceipts.find((receipt) => receipt.action === "disputed");
  const proofCount =
    (proof?.sepoliaEscrowSmoke?.transactions.length ?? 0) +
    (proof?.arkhaiLive?.transactions.length ?? 0) +
    (proof?.anchoredReceipts.length ?? 0);
  const proofSignals = [
    {
      label: "Blind review worker",
      detail: data.cases.some((item) => item.review?.execution?.strategy === "http_worker")
        ? readOnlyMode
          ? "operator runtime"
          : "running locally"
        : "deterministic fallback",
      tone: "local",
    },
    {
      label: "Ethereum Sepolia escrow",
      detail: proof?.sepoliaEscrowDeployment ? "deployed" : "pending",
      tone: proof?.sepoliaEscrowDeployment ? "live" : "muted",
    },
    {
      label: "Arkhai lifecycle",
      detail: proof?.arkhaiLive ? "settled live" : "pending",
      tone: proof?.arkhaiLive ? "live" : "muted",
    },
    {
      label: "Status receipts",
      detail: proof?.anchoredReceipts.length ? `${proof.anchoredReceipts.length} anchored` : "pending",
      tone: proof?.anchoredReceipts.length ? "live" : "muted",
    },
    {
      label: "Agent activity",
      detail: latestAgentEvent ? new Date(latestAgentEvent.createdAt).toLocaleString() : "no recent events",
      tone: latestAgentEvent ? "live" : "muted",
    },
  ] as const;
  const flowSteps = [
    {
      title: "Buyer funds escrow",
      detail: "A milestone is funded against a natural-language acceptance rubric instead of an informal chat agreement.",
    },
    {
      title: "Seller submits sealed evidence",
      detail: "The seller uploads a private artifact bundle and narrative without exposing the deliverable to the counterparty.",
    },
    {
      title: "Local agent evaluates rubric",
      detail: "A self-hosted OpenClaw agent running in a secure Ubuntu operator environment scores the sealed submission deterministically.",
    },
    {
      title: "Redacted verdict is posted",
      detail: "BlindArbiter writes a public verdict summary, report hash, and receipt trail without leaking the sensitive artifact.",
    },
    {
      title: "Onchain settlement",
      detail: "The milestone is released or disputed onchain, while Status receipts anchor the public consequences.",
    },
  ] as const;
  const canonicalDispute = {
    amountUsd: 500,
    settlementPath: "dispute",
    buyer: "Security Council",
    seller: "Private patch contributor",
    milestoneSummary:
      "Release only if the sealed patch bundle documents test execution evidence, rollback notes, and access-control coverage for the proposed fix.",
    sealedSubmission:
      "Seller submitted a sealed patch bundle for an authorization fix with a narrative summary, but omitted reproducible evidence for executed tests and did not document rollback verification.",
    redactedVerdict:
      "The private patch explains the code change, but the sealed submission failed to document test execution evidence and rollback verification. BlindArbiter therefore withheld release and triggered the dispute path.",
    criteria: [
      {
        id: "patch_scope",
        label: "Patch scope matches rubric",
        result: "pass",
        notes: "The sealed bundle appears to address the requested authorization boundary.",
      },
      {
        id: "test_evidence",
        label: "Test execution evidence",
        result: "fail",
        notes: "No reproducible proof of executed tests or attested command output was included in the sealed package.",
      },
      {
        id: "rollback_plan",
        label: "Rollback and recovery notes",
        result: "fail",
        notes: "The submission did not document how the private patch could be reverted safely if the milestone failed in production.",
      },
    ] as const,
  };

  const refreshData = async () => {
    const response = await fetch("/api/cases");
    const nextData = (await response.json()) as BlindArbiterDatabase;
    setData(nextData);
  };

  return (
    <div className="workbench">
      <section className="hero">
        <div className="heroMain">
          <p className="eyebrow">Private work. Public settlement.</p>
          <h1>BlindArbiter</h1>
          <p className="lede">
            BlindArbiter settles milestone escrow without exposing the deliverable.
          </p>
          <p className="heroBody">
            A buyer escrows funds against a natural-language rubric. A seller submits sealed evidence. BlindArbiter produces a redacted verdict,
            then either releases the escrow or opens a dispute with verifiable onchain receipts.
          </p>
          <div className="ctaRow">
            <a className="ctaButton" href={deployUrl} target="_blank" rel="noreferrer">
              Deploy Your Escrow
            </a>
            <a className="ctaButton ctaButtonSecondary" href={docsUrl} target="_blank" rel="noreferrer">
              View Documentation
            </a>
          </div>
          <div className="signalRow">
            {proofSignals.map((signal) => (
              <div key={signal.label} className={`signalPill signal-${signal.tone}`}>
                <strong>{signal.label}</strong>
                <span>{signal.detail}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="heroCard heroProofCard">
          <p className="eyebrow">What is live</p>
          <div className="heroStats">
            <div>
              <span className="metric">{proof?.summary.sepoliaTxCount ?? 0}</span>
              <span className="metricLabel">Ethereum Sepolia txs</span>
            </div>
            <div>
              <span className="metric">{proof?.summary.arkhaiTxCount ?? 0}</span>
              <span className="metricLabel">Arkhai txs</span>
            </div>
            <div>
              <span className="metric">{proof?.summary.statusReceiptCount ?? 0}</span>
              <span className="metricLabel">Status receipts</span>
            </div>
            <div>
              <span className="metric">{proofCount}</span>
              <span className="metricLabel">verifiable proof events</span>
            </div>
          </div>
          <div className="heroChecklist">
            <div>
              <strong>Problem</strong>
              <p>Teams need to settle private milestone work without exposing audits, patches, or due diligence files.</p>
            </div>
            <div>
              <strong>Mechanism</strong>
              <p>
                BlindArbiter reviews sealed evidence inside a self-hosted Ubuntu operator runtime, emits a redacted verdict, and drives release or
                dispute without leaking the underlying deliverable to external APIs.
              </p>
            </div>
            <div>
              <strong>Proof</strong>
              <p>Escrow settlement is live on Ethereum Sepolia, Arkhai is settled on Sepolia, and receipts are anchored on Status.</p>
            </div>
            <div>
              <strong>Agent runtime</strong>
              <p>
                The blind review worker is a self-hosted OpenClaw agent running in a secure Ubuntu operator environment. Sensitive deliverables stay
                inside that runtime and are evaluated deterministically without being sent to external APIs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {readOnlyMode ? <div className="errorBanner">{READ_ONLY_MESSAGE}</div> : null}
      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="storyGrid">
        <article className="storyCard">
          <span className="proofEyebrow">Why now</span>
          <h2>Private deliverables are hard to settle fairly</h2>
          <p>
            Smart contract audits, private patches, unreleased designs, diligence packets, and internal datasets often cannot be posted to a public chain
            or shared widely with a counterparty.
          </p>
        </article>
        <article className="storyCard">
          <span className="proofEyebrow">How it works</span>
          <h2>Blind review with public consequences</h2>
          <ol className="storyList">
            <li>Buyer funds a milestone escrow against a natural-language acceptance rubric.</li>
            <li>Seller submits sealed evidence for review without exposing the underlying work.</li>
            <li>The blind review worker evaluates the rubric inside a secure Ubuntu environment using the OpenClaw framework.</li>
            <li>BlindArbiter issues a redacted verdict and settles release or dispute with onchain receipts.</li>
          </ol>
          <div className="mechanismNote">
            <strong>Privacy guarantee</strong>
            <p>
              The blind review worker is a self-hosted autonomous AI agent running in a secure Ubuntu operator environment via OpenClaw. Sealed
              deliverables are evaluated deterministically inside that runtime, so sensitive artifacts never need to leave the operator environment or
              be shipped to third-party APIs.
            </p>
          </div>
        </article>
        <article className="storyCard">
          <span className="proofEyebrow">What to verify</span>
          <h2>The proof is onchain</h2>
          <ol className="storyList">
            <li>Ethereum Sepolia shows the escrow contract and the canonical release flow.</li>
            <li>Arkhai shows a live natural-language agreement lifecycle from creation to collection.</li>
            <li>Status shows receipt anchoring for verdict and settlement events.</li>
          </ol>
        </article>
      </section>

      <section id="settlement-flow" className="panel flowPanel">
        <div className="panelHeader">
          <div>
            <h2>Settlement flow</h2>
            <p>The buyer and seller see the same public consequences, while the sealed review stays inside the operator runtime.</p>
          </div>
        </div>
        <div className="flowTimeline" aria-label="BlindArbiter settlement flow">
          {flowSteps.map((step, index) => (
            <div key={step.title} className="flowNodeGroup">
              <article className="flowNode">
                <span className="flowIndex">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </article>
              {index < flowSteps.length - 1 ? (
                <div className="flowArrow" aria-hidden="true">
                  <span />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <ProofPanel proof={proof} />

      {readOnlyMode && canonicalCase ? (
        <>
          <section className="grid publicGrid">
            <section className="panel publicCasePanel">
              <div className="panelHeader">
                <div>
                  <h2>Canonical settlement</h2>
                  <p>This is the reference BlindArbiter flow shown in the demo and backed by the live proof above.</p>
                </div>
                <div className={`statusBadge status-${canonicalCase.status}`}>{formatStatus(canonicalCase.status)}</div>
              </div>

              <div className="detailGrid">
                <div>
                  <span className="label">Milestone value</span>
                  <p>${canonicalCase.amountUsd}</p>
                </div>
                <div>
                  <span className="label">Settlement path</span>
                  <p>{canonicalCase.review?.recommendedAction ?? "pending"}</p>
                </div>
                <div>
                  <span className="label">Buyer</span>
                  <p>{canonicalCase.buyer.displayName}</p>
                </div>
                <div>
                  <span className="label">Seller</span>
                  <p>{canonicalCase.seller?.displayName ?? "pending"}</p>
                </div>
              </div>

              <div className="publicNarrative">
                <div>
                  <span className="label">Milestone rubric</span>
                  <p>{canonicalCase.milestone.summary}</p>
                </div>
                <div>
                  <span className="label">Sealed submission</span>
                  <p>{canonicalCase.submission?.narrative}</p>
                </div>
                <div>
                  <span className="label">Redacted verdict</span>
                  <p>{canonicalCase.review?.redactedSummary}</p>
                </div>
              </div>

              <div className="criterionList">
                {(canonicalCase.review?.criteria ?? []).map((criterion) => (
                  <div key={criterion.id} className="criterionResult">
                    <strong>{criterion.label}</strong>
                    <span className={`miniVerdict miniVerdict-${criterion.result}`}>{criterion.result}</span>
                    <p>{criterion.notes}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panelHeader">
                <div>
                  <h2>Why the verdict is credible</h2>
                  <p>The public site cannot show the sealed work itself, so it shows the chain of consequences instead.</p>
                </div>
              </div>

              <div className="credibilityList">
                <div className="receiptItem">
                  <strong>Escrow release happened onchain</strong>
                  <p>The canonical case reached a released state on Ethereum Sepolia after the verdict was posted.</p>
                </div>
                <div className="receiptItem">
                  <strong>Status anchored the receipt trail</strong>
                  <p>Verdict and settlement actions are published as receipts instead of exposing the private deliverable.</p>
                </div>
                <div className="receiptItem">
                  <strong>Arkhai mirrored the dispute logic</strong>
                  <p>A live natural-language agreement was created, fulfilled, arbitrated, and collected on Sepolia.</p>
                </div>
                <div className="receiptItem">
                  <strong>Blind review stayed sealed</strong>
                  <p>The public proof shows hashes, verdicts, and txs while the deliverable remains private.</p>
                </div>
              </div>
            </section>
          </section>

          <section className="grid publicGrid">
            <section className="panel publicCasePanel">
              <div className="panelHeader">
                <div>
                  <h2>Canonical dispute</h2>
                  <p>Illustrative failed milestone: the sealed work stayed private, but the rubric was not satisfied and the dispute path was triggered.</p>
                </div>
                <div className="statusBadge status-disputed">disputed</div>
              </div>

              <div className="detailGrid">
                <div>
                  <span className="label">Milestone value</span>
                  <p>${canonicalDispute.amountUsd}</p>
                </div>
                <div>
                  <span className="label">Settlement path</span>
                  <p>{canonicalDispute.settlementPath}</p>
                </div>
                <div>
                  <span className="label">Buyer</span>
                  <p>{canonicalDispute.buyer}</p>
                </div>
                <div>
                  <span className="label">Seller</span>
                  <p>{canonicalDispute.seller}</p>
                </div>
              </div>

              <div className="publicNarrative">
                <div>
                  <span className="label">Milestone rubric</span>
                  <p>{canonicalDispute.milestoneSummary}</p>
                </div>
                <div>
                  <span className="label">Sealed submission</span>
                  <p>{canonicalDispute.sealedSubmission}</p>
                </div>
                <div>
                  <span className="label">Redacted verdict</span>
                  <p>{canonicalDispute.redactedVerdict}</p>
                </div>
              </div>

              <div className="criterionList">
                {canonicalDispute.criteria.map((criterion) => (
                  <div key={criterion.id} className="criterionResult">
                    <strong>{criterion.label}</strong>
                    <span className={`miniVerdict miniVerdict-${criterion.result}`}>{criterion.result}</span>
                    <p>{criterion.notes}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panelHeader">
                <div>
                  <h2>Why the dispute is verifiable</h2>
                  <p>The public proof still shows the consequence chain even though the failed milestone remains sealed.</p>
                </div>
              </div>

              <div className="credibilityList">
                <div className="receiptItem">
                  <strong>Failure reason was redacted, not leaked</strong>
                  <p>The failed milestone references missing test execution evidence, not the private patch contents themselves.</p>
                </div>
                <div className="receiptItem">
                  <strong>Dispute receipts anchor the branch onchain</strong>
                  <p>
                    BlindArbiter can post both a verdict receipt and a dispute receipt on Status, giving the failed path the same auditability as a
                    release.
                  </p>
                </div>
                <div className="receiptItem">
                  <strong>Operator runtime keeps review sealed</strong>
                  <p>The OpenClaw worker runs in the operator secure Ubuntu environment, so the failed submission never needs to leave that boundary.</p>
                </div>
                <div className="receiptCluster">
                  {latestVerdictReceipt ? (
                    <a className="receiptLink" href={latestVerdictReceipt.explorerUrl} target="_blank" rel="noreferrer">
                      Verdict receipt {shortHash(latestVerdictReceipt.txHash)}
                    </a>
                  ) : null}
                  {latestDisputeReceipt ? (
                    <a className="receiptLink" href={latestDisputeReceipt.explorerUrl} target="_blank" rel="noreferrer">
                      Dispute receipt {shortHash(latestDisputeReceipt.txHash)}
                    </a>
                  ) : null}
                </div>
              </div>
            </section>
          </section>
        </>
      ) : (
        <>
          <div className="grid">
            <section className="panel">
              <div className="panelHeader">
                <div>
                  <h2>Create milestone</h2>
                  <p>Seed a new escrow case with a rubric the arbiter can score.</p>
                </div>
              </div>

              <form
                className="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (readOnlyMode) {
                    setError(READ_ONLY_MESSAGE);
                    return;
                  }
                  setError(null);
                  startTransition(async () => {
                    try {
                      const payload = {
                        ...createForm,
                        amountUsd: Number(createForm.amountUsd),
                      };
                      await postJson("/api/cases", payload);
                      await refreshData();
                      setCreateForm(initialCreateForm);
                    } catch (submissionError) {
                      setError(submissionError instanceof Error ? submissionError.message : "Failed to create case.");
                    }
                  });
                }}
              >
                <label>
                  <span>Title</span>
                  <input value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} />
                </label>
                <div className="formRow">
                  <label>
                    <span>Amount (USD)</span>
                    <input value={createForm.amountUsd} onChange={(event) => setCreateForm({ ...createForm, amountUsd: event.target.value })} />
                  </label>
                  <label>
                    <span>Buyer</span>
                    <input value={createForm.buyerName} onChange={(event) => setCreateForm({ ...createForm, buyerName: event.target.value })} />
                  </label>
                </div>
                <div className="formRow">
                  <label>
                    <span>Buyer wallet</span>
                    <input value={createForm.buyerWallet} onChange={(event) => setCreateForm({ ...createForm, buyerWallet: event.target.value })} />
                  </label>
                  <label>
                    <span>Buyer Self ID</span>
                    <input value={createForm.buyerSelfId} onChange={(event) => setCreateForm({ ...createForm, buyerSelfId: event.target.value })} />
                  </label>
                </div>
                <label>
                  <span>Milestone summary</span>
                  <textarea rows={4} value={createForm.summary} onChange={(event) => setCreateForm({ ...createForm, summary: event.target.value })} />
                </label>
                <label>
                  <span>Criteria, one per line</span>
                  <textarea rows={5} value={createForm.criteria} onChange={(event) => setCreateForm({ ...createForm, criteria: event.target.value })} />
                </label>
                <button type="submit" disabled={isPending || readOnlyMode}>Create funded case</button>
              </form>
            </section>

            <section className="panel">
              <div className="panelHeader">
                <div>
                  <h2>Case board</h2>
                  <p>Accept, submit, review, release, or dispute each escrow milestone.</p>
                </div>
              </div>

              <div className="caseList">
                {data.cases.map((caseFile) => (
                  <CaseCard
                    key={caseFile.id}
                    caseFile={caseFile}
                    busy={isPending}
                    readOnlyMode={readOnlyMode}
                    onError={setError}
                    onRefresh={refreshData}
                  />
                ))}
              </div>
            </section>
          </div>

          <section className="panel logsPanel">
            <div className="panelHeader">
              <div>
                <h2>Agent log</h2>
                <p>Current runtime log entries written from the local store.</p>
              </div>
            </div>
            <div className="logList">
              {data.agentLog.slice(0, 8).map((entry) => (
                <div key={entry.id} className="logItem">
                  <div>
                    <strong>{entry.kind.replaceAll("_", " ")}</strong>
                    <p>{entry.message}</p>
                  </div>
                  <time>{new Date(entry.createdAt).toLocaleString()}</time>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="panel ctaPanel">
        <div>
          <span className="proofEyebrow">Next step</span>
          <h2>Run BlindArbiter in your own operator environment</h2>
          <p>
            Clone the repo, deploy the escrow contracts, and keep sealed review inside your own Ubuntu and OpenClaw runtime while preserving the same
            public receipt trail.
          </p>
        </div>
        <div className="ctaRow ctaRowBottom">
          <a className="ctaButton" href={deployUrl} target="_blank" rel="noreferrer">
            Deploy Your Escrow
          </a>
          <a className="ctaButton ctaButtonSecondary" href={docsUrl} target="_blank" rel="noreferrer">
            View Documentation
          </a>
        </div>
      </section>
    </div>
  );
}

function ProofPanel({ proof }: { proof?: LiveProofBundle }) {
  if (!proof) {
    return null;
  }

  const canonicalStatus = proof.sepoliaEscrowSmoke?.finalCase
    ? formatOnchainCaseStatus(proof.sepoliaEscrowSmoke.finalCase.status)
    : "pending";

  return (
    <section id="live-proof" className="panel proofPanel">
      <div className="panelHeader">
        <div>
          <h2>Live Proof</h2>
          <p>Real deployments and real transaction traces used by the current demo.</p>
        </div>
      </div>

      <div className="proofGrid">
        <div className="proofCard">
          <span className="proofEyebrow">Ethereum Sepolia</span>
          <h3>Escrow contract</h3>
          {proof.sepoliaEscrowDeployment ? (
            <>
              <p className="mono">{proof.sepoliaEscrowDeployment.contractAddress}</p>
              <div className="proofList">
                <div>
                  <span className="label">Operator wallet</span>
                  <p className="mono">{proof.sepoliaEscrowDeployment.deployer || "n/a"}</p>
                </div>
                <div>
                  <span className="label">Deploy tx</span>
                  <p>
                    <a href={proof.sepoliaEscrowDeployment.explorerUrl} target="_blank" rel="noreferrer">
                      {shortHash(proof.sepoliaEscrowDeployment.txHash)}
                    </a>
                  </p>
                </div>
                <div>
                  <span className="label">Deployed at</span>
                  <p>{new Date(proof.sepoliaEscrowDeployment.deployedAt).toLocaleString()}</p>
                </div>
              </div>
            </>
          ) : (
            <p>No live Ethereum Sepolia deployment recorded yet.</p>
          )}
        </div>

        <div className="proofCard">
          <span className="proofEyebrow">Canonical case</span>
          <h3>Case {proof.sepoliaEscrowSmoke?.caseId || "pending"}</h3>
          {proof.sepoliaEscrowSmoke ? (
            <>
              <div className="proofList">
                <div>
                  <span className="label">Escrow amount</span>
                  <p>{proof.sepoliaEscrowSmoke.amountEth} ETH</p>
                </div>
                <div>
                  <span className="label">Final status</span>
                  <p>{canonicalStatus}</p>
                </div>
                <div>
                  <span className="label">Completed at</span>
                  <p>{proof.sepoliaEscrowSmoke.completedAt ? new Date(proof.sepoliaEscrowSmoke.completedAt).toLocaleString() : "in progress"}</p>
                </div>
                <div>
                  <span className="label">Buyer</span>
                  <p className="mono">{proof.sepoliaEscrowSmoke.finalCase?.buyer || proof.sepoliaEscrowSmoke.roles?.buyer || "n/a"}</p>
                </div>
                <div>
                  <span className="label">Seller</span>
                  <p className="mono">{proof.sepoliaEscrowSmoke.finalCase?.seller || proof.sepoliaEscrowSmoke.roles?.seller || "n/a"}</p>
                </div>
                <div>
                  <span className="label">Arbiter</span>
                  <p className="mono">{proof.sepoliaEscrowSmoke.finalCase?.arbiter || proof.sepoliaEscrowSmoke.roles?.arbiter || "n/a"}</p>
                </div>
                <div>
                  <span className="label">Counterparty separation</span>
                  <p>{proof.sepoliaEscrowSmoke.roles?.distinctActors ? "buyer and seller are distinct wallets" : "single-wallet self-play"}</p>
                </div>
                {proof.sepoliaEscrowSmoke.roles?.sellerFundingExplorerUrl ? (
                  <div>
                    <span className="label">Seller funding tx</span>
                    <p>
                      <a href={proof.sepoliaEscrowSmoke.roles.sellerFundingExplorerUrl} target="_blank" rel="noreferrer">
                        {shortHash(proof.sepoliaEscrowSmoke.roles.sellerFundingTxHash || "")}
                      </a>
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="txList">
                {proof.sepoliaEscrowSmoke.transactions.map((transaction) => (
                  <div key={transaction.txHash} className="txItem">
                    <strong>{transaction.label.replaceAll("_", " ")}</strong>
                    <span>{transaction.status}</span>
                    <p>
                      <a href={transaction.explorerUrl} target="_blank" rel="noreferrer">
                        {shortHash(transaction.txHash)}
                      </a>
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>No live Sepolia case report recorded yet.</p>
          )}
        </div>

        <div className="proofCard">
          <span className="proofEyebrow">Arkhai / Alkahest</span>
          <h3>Live NLA lifecycle</h3>
          {proof.arkhaiLive ? (
            <>
              <div className="proofList">
                <div>
                  <span className="label">Escrow UID</span>
                  <p className="mono">{proof.arkhaiLive.escrowUid}</p>
                </div>
                <div>
                  <span className="label">Fulfillment UID</span>
                  <p className="mono">{proof.arkhaiLive.fulfillmentUid}</p>
                </div>
                <div>
                  <span className="label">Collection tx</span>
                  <p>
                    <a href={`https://sepolia.etherscan.io/tx/${proof.arkhaiLive.collectionTxHash}`} target="_blank" rel="noreferrer">
                      {shortHash(proof.arkhaiLive.collectionTxHash)}
                    </a>
                  </p>
                </div>
              </div>
              <div className="txList">
                {proof.arkhaiLive.transactions.map((transaction) => (
                  <div key={transaction.txHash} className="txItem">
                    <strong>{transaction.label.replaceAll("_", " ")}</strong>
                    <span>live</span>
                    <p>
                      <a href={transaction.explorerUrl} target="_blank" rel="noreferrer">
                        {shortHash(transaction.txHash)}
                      </a>
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>No live Arkhai Sepolia lifecycle recorded yet.</p>
          )}
        </div>

        <div className="proofCard">
          <span className="proofEyebrow">Status Sepolia</span>
          <h3>Receipt registry</h3>
          {proof.statusDeployment ? (
            <>
              <p className="mono">{proof.statusDeployment.contractAddress}</p>
              <div className="proofList">
                <div>
                  <span className="label">Registry deploy tx</span>
                  <p>
                    <a href={proof.statusDeployment.explorerUrl} target="_blank" rel="noreferrer">
                      {shortHash(proof.statusDeployment.txHash)}
                    </a>
                  </p>
                </div>
                <div>
                  <span className="label">Anchored receipts</span>
                  <p>{proof.anchoredReceipts.length}</p>
                </div>
              </div>
              <div className="txList">
                {proof.anchoredReceipts.slice(0, 4).map((receipt) => (
                  <div key={`${receipt.caseId}-${receipt.txHash}`} className="txItem">
                    <strong>{receipt.action.replaceAll("_", " ")}</strong>
                    <span>{receipt.caseId}</span>
                    <p>
                      <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                        {shortHash(receipt.txHash)}
                      </a>
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>No live Status deployment recorded yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function CaseCard({
  caseFile,
  busy,
  readOnlyMode,
  onRefresh,
  onError,
}: {
  caseFile: BlindArbiterCase;
  busy: boolean;
  readOnlyMode: boolean;
  onRefresh: () => Promise<void>;
  onError: (value: string | null) => void;
}) {
  const [sellerName, setSellerName] = useState("Sealed Contributor");
  const [sellerWallet, setSellerWallet] = useState("0xSeller000000000000000000000000000000000000");
  const [sellerSelfId, setSellerSelfId] = useState("self:seller-local");
  const [artifactName, setArtifactName] = useState("patch-bundle.zip");
  const [artifactType, setArtifactType] = useState("code_bundle");
  const [artifactHash, setArtifactHash] = useState("0xprivateartifacthash");
  const [storageUri, setStorageUri] = useState("sealed://bundle/access-control-fix");
  const [narrative, setNarrative] = useState(
    "The private patch updates privileged functions with role checks, explains how the access control fix works, documents the passing tests, and keeps secrets sealed while producing a verdict hash."
  );
  const [disputeReason, setDisputeReason] = useState("Manual dispute requested after reviewing the redacted output.");

  return (
    <article className="caseCard">
      <div className="caseHeader">
        <div>
          <h3>{caseFile.title}</h3>
          <p>{caseFile.milestone.summary}</p>
        </div>
        <div className={`statusBadge status-${caseFile.status}`}>
          {formatStatus(caseFile.status)}
        </div>
      </div>

      <div className="detailGrid">
        <div>
          <span className="label">Buyer</span>
          <p>{caseFile.buyer.displayName}</p>
        </div>
        <div>
          <span className="label">Amount</span>
          <p>${caseFile.amountUsd}</p>
        </div>
        <div>
          <span className="label">Privacy model</span>
          <p>{caseFile.milestone.privacyModel}</p>
        </div>
        <div>
          <span className="label">Case ID</span>
          <p className="mono">{caseFile.id}</p>
        </div>
      </div>

      <div className="criteriaBlock">
        {caseFile.milestone.criteria.map((criterion) => (
          <span key={criterion.id} className="criterionChip">
            {criterion.label}
          </span>
        ))}
      </div>

      {!caseFile.seller ? (
        <form
          className="miniForm"
          onSubmit={(event) => {
            event.preventDefault();
            if (readOnlyMode) {
              onError(READ_ONLY_MESSAGE);
              return;
            }
            onError(null);
            void postJson(`/api/cases/${caseFile.id}/accept`, {
              displayName: sellerName,
              wallet: sellerWallet,
              selfId: sellerSelfId,
            })
              .then(() => onRefresh())
              .catch((error) => onError(error instanceof Error ? error.message : "Failed to accept case."));
          }}
        >
          <h4>Accept milestone</h4>
          <div className="formRow">
            <input value={sellerName} onChange={(event) => setSellerName(event.target.value)} placeholder="Seller name" />
            <input value={sellerSelfId} onChange={(event) => setSellerSelfId(event.target.value)} placeholder="Self ID" />
          </div>
          <input value={sellerWallet} onChange={(event) => setSellerWallet(event.target.value)} placeholder="Seller wallet" />
          <button type="submit" disabled={busy || readOnlyMode}>Accept with identity</button>
        </form>
      ) : null}

      {caseFile.seller && !caseFile.submission ? (
        <form
          className="miniForm"
          onSubmit={(event) => {
            event.preventDefault();
            if (readOnlyMode) {
              onError(READ_ONLY_MESSAGE);
              return;
            }
            onError(null);
            void postJson(`/api/cases/${caseFile.id}/submit`, {
              artifactName,
              artifactType,
              artifactHash,
              storageUri,
              narrative,
            })
              .then(() => onRefresh())
              .catch((error) => onError(error instanceof Error ? error.message : "Failed to submit deliverable."));
          }}
        >
          <h4>Submit sealed deliverable</h4>
          <div className="formRow">
            <input value={artifactName} onChange={(event) => setArtifactName(event.target.value)} placeholder="Artifact name" />
            <input value={artifactType} onChange={(event) => setArtifactType(event.target.value)} placeholder="Artifact type" />
          </div>
          <div className="formRow">
            <input value={artifactHash} onChange={(event) => setArtifactHash(event.target.value)} placeholder="Artifact hash" />
            <input value={storageUri} onChange={(event) => setStorageUri(event.target.value)} placeholder="Storage URI" />
          </div>
          <textarea rows={4} value={narrative} onChange={(event) => setNarrative(event.target.value)} />
          <button type="submit" disabled={busy || readOnlyMode}>Seal deliverable</button>
        </form>
      ) : null}

      {caseFile.submission ? (
        <section className="submissionBlock">
          <h4>Sealed submission</h4>
          <p className="mono">{caseFile.submission.artifactName} • {caseFile.submission.storageUri}</p>
          <p>{caseFile.submission.narrative}</p>
        </section>
      ) : null}

      {caseFile.submission && !caseFile.review ? (
        <div className="actionRow">
          <button
            type="button"
            disabled={busy || readOnlyMode}
            onClick={() => {
            if (readOnlyMode) {
              onError(READ_ONLY_MESSAGE);
              return;
            }
            onError(null);
            void postJson(`/api/cases/${caseFile.id}/review`)
              .then(() => onRefresh())
              .catch((error) => onError(error instanceof Error ? error.message : "Failed to review case."));
          }}
        >
            Run BlindArbiter review
          </button>
        </div>
      ) : null}

      {caseFile.review ? (
        <section className="reviewBlock">
          <div className="reviewHeader">
            <h4>Review verdict</h4>
            <span className={`verdict verdict-${caseFile.review.verdict}`}>{caseFile.review.verdict}</span>
          </div>
          <p>{caseFile.review.redactedSummary}</p>
          <div className="detailGrid">
            <div>
              <span className="label">Confidence</span>
              <p>{caseFile.review.confidence}</p>
            </div>
            <div>
              <span className="label">Recommended action</span>
              <p>{caseFile.review.recommendedAction}</p>
            </div>
            <div>
              <span className="label">Report hash</span>
              <p className="mono">{caseFile.review.reportHash}</p>
            </div>
          </div>
          {caseFile.review.execution ? (
            <div className="detailGrid">
              <div>
                <span className="label">Compute mode</span>
                <p>{caseFile.review.execution.mode}</p>
              </div>
              <div>
                <span className="label">Strategy</span>
                <p>{caseFile.review.execution.strategy}</p>
              </div>
              <div>
                <span className="label">Worker image</span>
                <p className="mono">{caseFile.review.execution.image}</p>
              </div>
              <div>
                <span className="label">Attestation hash</span>
                <p className="mono">{caseFile.review.execution.attestationHash}</p>
              </div>
            </div>
          ) : null}
          {caseFile.review.execution?.fallbackReason ? <p>{caseFile.review.execution.fallbackReason}</p> : null}
          <div className="criterionList">
            {caseFile.review.criteria.map((criterion) => (
              <div key={criterion.id} className="criterionResult">
                <strong>{criterion.label}</strong>
                <span className={`miniVerdict miniVerdict-${criterion.result}`}>{criterion.result}</span>
                <p>{criterion.notes}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="receiptBlock">
        <h4>Receipts</h4>
        {caseFile.receipts.length === 0 ? <p>No receipt drafts yet.</p> : null}
        {caseFile.receipts.map((receipt, index) => (
          <div key={`${receipt.payloadHash}-${index}`} className="receiptItem">
            <strong>{receipt.action}</strong>
            <span>{receipt.network} • {receipt.mode}</span>
            <p className="mono">{receipt.payloadHash}</p>
            <p className="mono">{receipt.receiptHash}</p>
            <p>{receipt.note}</p>
            {receipt.txHash ? <p className="mono">{receipt.txHash}</p> : null}
            {receipt.explorerUrl ? (
              <p>
                <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">View Status transaction</a>
              </p>
            ) : null}
            {receipt.error ? <p>{receipt.error}</p> : null}
          </div>
        ))}
      </section>

      {caseFile.arkhaiAgreement ? (
        <section className="receiptBlock">
          <h4>Arkhai Agreement</h4>
          <div className="receiptItem">
            <strong>{caseFile.arkhaiAgreement.protocol}</strong>
            <span>{caseFile.arkhaiAgreement.network}</span>
            <p className="mono">{caseFile.arkhaiAgreement.oracleAddress}</p>
            <p className="mono">{caseFile.arkhaiAgreement.encodedDemand}</p>
            <p className="mono">{caseFile.arkhaiAgreement.createCommand}</p>
            {caseFile.arkhaiAgreement.fulfillCommand ? <p className="mono">{caseFile.arkhaiAgreement.fulfillCommand}</p> : null}
            <p>
              <a href={`/api/cases/${caseFile.id}/arkhai`} target="_blank" rel="noreferrer">Open Arkhai agreement JSON</a>
            </p>
          </div>
        </section>
      ) : null}

      <div className="actionRow">
        <button
          type="button"
          disabled={busy || readOnlyMode || caseFile.status !== "passed"}
          onClick={() => {
            if (readOnlyMode) {
              onError(READ_ONLY_MESSAGE);
              return;
            }
            onError(null);
            void postJson(`/api/cases/${caseFile.id}/release`)
              .then(() => onRefresh())
              .catch((error) => onError(error instanceof Error ? error.message : "Failed to release case."));
          }}
        >
          Release escrow
        </button>
        <input value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} placeholder="Dispute reason" />
        <button
          type="button"
          disabled={busy || readOnlyMode}
          className="secondary"
          onClick={() => {
            if (readOnlyMode) {
              onError(READ_ONLY_MESSAGE);
              return;
            }
            onError(null);
            void postJson(`/api/cases/${caseFile.id}/dispute`, { reason: disputeReason })
              .then(() => onRefresh())
              .catch((error) => onError(error instanceof Error ? error.message : "Failed to dispute case."));
          }}
        >
          Open dispute
        </button>
      </div>
    </article>
  );
}
