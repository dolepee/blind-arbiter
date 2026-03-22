import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const submissionDir = path.join(root, "submission");
const outputFile = path.join(submissionDir, "blind-arbiter.project.json");
const registrationFile = "/home/qdee/keji-synthesis/runtime/synthesis-registration.json";

const trackUUIDs = [
  "fdb76d08812b43f6a5f454744b66f590",
  "877cd61516a14ad9a199bf48defec1c1",
  "88e91d848daf4d1bb0d40dec0074f59e",
  "d6c88674390b4150a9ead015443a1375",
];

async function readText(name) {
  return readFile(path.join(submissionDir, name), "utf8");
}

async function resolveTeamUUID() {
  if (process.env.SYNTHESIS_TEAM_UUID) {
    return process.env.SYNTHESIS_TEAM_UUID;
  }

  const raw = await readFile(registrationFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.teamId) {
    throw new Error("Missing teamId in synthesis registration file.");
  }

  return parsed.teamId;
}

function resolveSkills() {
  if (!process.env.SYNTHESIS_SKILLS) {
    return ["web-search"];
  }

  const value = JSON.parse(process.env.SYNTHESIS_SKILLS);
  if (!Array.isArray(value)) {
    throw new Error("SYNTHESIS_SKILLS must decode to a JSON array.");
  }

  return value;
}

const description = (await readText("blind-arbiter-description.md")).trim();
const problemStatement = (await readText("blind-arbiter-problem-statement.md")).trim();
const conversationLog = (await readText("blind-arbiter-conversation-log.md")).trim();
const skills = resolveSkills();

const payload = {
  teamUUID: await resolveTeamUUID(),
  name: "BlindArbiter",
  description,
  problemStatement,
  repoURL: "https://github.com/dolepee/blind-arbiter",
  trackUUIDs,
  conversationLog,
  submissionMetadata: {
    agentFramework: "other",
    agentFrameworkOther: "custom Next.js + viem + Solidity agent workflow",
    agentHarness: "codex-cli",
    model: "gpt-5",
    skills,
    tools: [
      "Next.js",
      "viem",
      "Solidity",
      "Vercel",
      "Arkhai Alkahest",
      "Status Network",
    ],
    helpfulResources: [
      "https://synthesis.devfolio.co/submission/skill.md",
      "https://synthesis.devfolio.co/catalog?page=1&limit=100",
      "https://raw.githubusercontent.com/arkhai-io/natural-language-agreements/main/README.md",
    ],
    helpfulSkills: [
      {
        name: "web-search",
        reason:
          "Confirmed the live Synthesis submission requirements, current track UUIDs, and official Arkhai integration surface instead of relying on stale cached assumptions.",
      },
    ],
    intention: "continuing",
    intentionNotes:
      "Continue from the live proof baseline: recover hosted confidential compute, wire real identity gating, and extend the sealed-settlement primitive beyond the hackathon demo.",
  },
  deployedURL: "https://blind-arbiter.vercel.app",
};

if (process.env.SYNTHESIS_VIDEO_URL) {
  payload.videoURL = process.env.SYNTHESIS_VIDEO_URL;
}

if (process.env.SYNTHESIS_PICTURES_URL) {
  payload.pictures = process.env.SYNTHESIS_PICTURES_URL;
}

if (process.env.SYNTHESIS_COVER_IMAGE_URL) {
  payload.coverImageURL = process.env.SYNTHESIS_COVER_IMAGE_URL;
}

await mkdir(submissionDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`);

console.log(`Wrote ${outputFile}`);
