import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const payloadFile = new URL("../submission/blind-arbiter.project.json", import.meta.url);
const keyFile = "/home/qdee/keji-synthesis/runtime/synthesis-api-key.txt";
const execFileAsync = promisify(execFile);

async function main() {
  const apiKey = process.env.SYNTHESIS_API_KEY || (await readFile(keyFile, "utf8")).trim();
  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  const data = await createDraft(payload, apiKey);
  console.log(
    JSON.stringify(
      {
        uuid: data.uuid,
        name: data.name,
        status: data.status,
        teamUUID: data.team?.uuid,
        trackCount: Array.isArray(data.tracks) ? data.tracks.length : 0,
      },
      null,
      2,
    ),
  );
}

async function createDraft(payload, apiKey) {
  try {
    const response = await fetch("https://synthesis.devfolio.co/projects", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text);
    }

    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("fetch failed")) {
      throw error;
    }

    const { stdout } = await execFileAsync("curl", [
      "-sS",
      "-X",
      "POST",
      "https://synthesis.devfolio.co/projects",
      "-H",
      `Authorization: Bearer ${apiKey}`,
      "-H",
      "Content-Type: application/json",
      "--data",
      JSON.stringify(payload),
    ]);

    const data = JSON.parse(stdout);
    if (data?.success === false) {
      throw new Error(stdout);
    }

    return data;
  }
}

await main();
