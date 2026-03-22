import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { encodeAbiParameters, parseAbiParameters } from "viem";

import type { ArkhaiAgreementPacket, BlindArbiterCase } from "@/lib/types";

const ROOT = process.cwd();
const AGREEMENTS_DIR = path.join(ROOT, "runtime", "agreements");
const DEFAULT_NLA_NETWORK = "sepolia";
const DEFAULT_NLA_ORACLE_ADDRESS = "0xc5c132B69f57dAAAb75d9ebA86cab504b272Ccbc";
const DEFAULT_NLA_PROVIDER = "OpenAI";
const DEFAULT_NLA_MODEL = "gpt-4o-mini";
const DEMAND_ABI = parseAbiParameters(
  "(string arbitrationProvider, string arbitrationModel, string arbitrationPrompt, string demand)"
);

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function now() {
  return new Date().toISOString();
}

function getTokenAddress() {
  return process.env.NLA_TOKEN_ADDRESS?.trim() || "<set_NLA_TOKEN_ADDRESS>";
}

function getNetwork() {
  return process.env.NLA_NETWORK?.trim() || DEFAULT_NLA_NETWORK;
}

function getOracleAddress() {
  return process.env.NLA_ORACLE_ADDRESS?.trim() || DEFAULT_NLA_ORACLE_ADDRESS;
}

function getArbitrationProvider() {
  return process.env.NLA_ARBITRATION_PROVIDER?.trim() || DEFAULT_NLA_PROVIDER;
}

function getArbitrationModel() {
  return process.env.NLA_ARBITRATION_MODEL?.trim() || DEFAULT_NLA_MODEL;
}

function buildDemand(caseFile: BlindArbiterCase) {
  const criteria = caseFile.milestone.criteria.map((criterion) => criterion.label).join("; ");
  return [
    `BlindArbiter case ${caseFile.id}: release ${caseFile.amountUsd} units of escrowed value to ${caseFile.seller?.displayName || "the seller"} only if the fulfillment proves the following natural-language demand.`,
    caseFile.milestone.summary,
    `Acceptance criteria: ${criteria}.`,
    "If any criterion is missing, contradicted, or unclear, the escrow must remain disputed or uncollected.",
  ].join(" ");
}

function buildArbitrationPrompt() {
  return [
    "You are arbitrating a Natural Language Agreement escrow.",
    "Demand: {{demand}}",
    "Fulfillment: {{obligation}}",
    "Return true only if the fulfillment clearly satisfies every explicit criterion in the demand.",
    "Return false if any criterion is missing, contradicted, or uncertain.",
    "Do not assume private evidence that is not explicitly described in the fulfillment.",
  ].join("\n");
}

function buildFulfillmentStatement(caseFile: BlindArbiterCase) {
  if (!caseFile.submission) {
    return undefined;
  }

  const reviewSummary = caseFile.review
    ? `BlindArbiter redacted verdict: ${caseFile.review.redactedSummary}`
    : "BlindArbiter review has not run yet.";

  return [
    `Artifact ${caseFile.submission.artifactName} was submitted at ${caseFile.submission.submittedAt}.`,
    `Seller narrative: ${caseFile.submission.narrative}`,
    reviewSummary,
  ].join(" ");
}

function buildCreateCommand(packet: ArkhaiAgreementPacket) {
  return [
    "nla escrow:create",
    `--demand ${shellQuote(packet.llmDemand.demand)}`,
    `--amount ${packet.amount}`,
    `--token ${packet.tokenAddress}`,
    `--oracle ${packet.oracleAddress}`,
    `--arbitration-provider ${shellQuote(packet.llmDemand.arbitrationProvider)}`,
    `--arbitration-model ${shellQuote(packet.llmDemand.arbitrationModel)}`,
    `--arbitration-prompt ${shellQuote(packet.llmDemand.arbitrationPrompt)}`,
  ].join(" \\\n  ");
}

function buildFulfillCommand(packet: ArkhaiAgreementPacket) {
  if (!packet.fulfillmentStatement) {
    return undefined;
  }

  return [
    "nla escrow:fulfill",
    "--escrow-uid <escrow_uid>",
    `--fulfillment ${shellQuote(packet.fulfillmentStatement)}`,
    `--oracle ${packet.oracleAddress}`,
  ].join(" \\\n  ");
}

function renderMarkdown(caseFile: BlindArbiterCase, packet: ArkhaiAgreementPacket) {
  return [
    "# BlindArbiter x Arkhai Agreement",
    "",
    `Case: ${caseFile.id}`,
    `Status: ${caseFile.status}`,
    `Oracle: ${packet.oracleAddress}`,
    `Network: ${packet.network}`,
    "",
    "## Demand",
    packet.llmDemand.demand,
    "",
    "## Encoded Demand",
    `\`${packet.encodedDemand}\``,
    "",
    "## Create Command",
    "```bash",
    packet.createCommand,
    "```",
    "",
    "## Fulfill Command",
    "```bash",
    packet.fulfillCommand || "nla escrow:fulfill --escrow-uid <escrow_uid> --fulfillment <statement>",
    "```",
    "",
    "## Status Command",
    "```bash",
    packet.statusCommand,
    "```",
    "",
    "## Collect Command",
    "```bash",
    packet.collectCommand || "nla escrow:collect --escrow-uid <escrow_uid> --fulfillment-uid <fulfillment_uid>",
    "```",
    "",
  ].join("\n");
}

export function buildArkhaiAgreement(caseFile: BlindArbiterCase): ArkhaiAgreementPacket {
  const generatedAt = now();
  const llmDemand = {
    arbitrationProvider: getArbitrationProvider(),
    arbitrationModel: getArbitrationModel(),
    arbitrationPrompt: buildArbitrationPrompt(),
    demand: buildDemand(caseFile),
  };
  const encodedDemand = encodeAbiParameters(DEMAND_ABI, [llmDemand]);
  const fulfillmentStatement = buildFulfillmentStatement(caseFile);

  const packet: ArkhaiAgreementPacket = {
    protocol: "natural-language-agreements",
    network: getNetwork(),
    oracleAddress: getOracleAddress(),
    tokenAddress: getTokenAddress(),
    amount: String(caseFile.amountUsd),
    llmDemand,
    encodedDemand,
    fulfillmentStatement,
    createCommand: "",
    statusCommand: "nla escrow:status --escrow-uid <escrow_uid>",
    collectCommand: caseFile.review?.recommendedAction === "release"
      ? "nla escrow:collect --escrow-uid <escrow_uid> --fulfillment-uid <fulfillment_uid>"
      : undefined,
    generatedAt,
  };

  packet.createCommand = buildCreateCommand(packet);
  packet.fulfillCommand = buildFulfillCommand(packet);

  return packet;
}

export async function persistArkhaiAgreement(caseFile: BlindArbiterCase): Promise<ArkhaiAgreementPacket> {
  const packet = buildArkhaiAgreement(caseFile);
  const jsonPath = path.join(AGREEMENTS_DIR, `${caseFile.id}.json`);
  const markdownPath = path.join(AGREEMENTS_DIR, `${caseFile.id}.md`);
  const withPaths: ArkhaiAgreementPacket = {
    ...packet,
    artifactJsonPath: jsonPath,
    artifactMarkdownPath: markdownPath,
  };

  await mkdir(AGREEMENTS_DIR, { recursive: true });
  await writeFile(jsonPath, JSON.stringify(withPaths, null, 2));
  await writeFile(markdownPath, renderMarkdown(caseFile, withPaths));

  return withPaths;
}
