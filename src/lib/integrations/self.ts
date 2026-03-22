import type { Participant } from "@/lib/types";

export function buildSelfSummary(participant: Participant) {
  return {
    displayName: participant.displayName,
    selfId: participant.selfId || "pending-self-attestation",
    verificationState: participant.verified ? "ready" : "local_stub",
    note: participant.verified
      ? "Participant is marked as identity-verified."
      : "Replace with Self Agent ID gating before submission.",
  };
}
