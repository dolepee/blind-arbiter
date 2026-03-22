import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const videoDir = path.join(root, "demo-videos");
const rawVideoPath = path.join(videoDir, "blind-arbiter-demo.webm");
const finalVideoPath = path.join(videoDir, "blind-arbiter-demo.mp4");
const assetVideoPath = path.join(root, "submission", "assets", "blind-arbiter-demo.mp4");

const siteUrl = "https://blind-arbiter.vercel.app";
const escrowTxUrl =
  "https://sepolia.etherscan.io/tx/0x8456115d3cc1f69063abaee385fc6837c804997aecfeb5c8f3e991fdd27b4f4a";
const statusTxUrl =
  "https://sepoliascan.status.network/tx/0x7bd8607df39090a914fcb0b08fdd0af691bafbf5d556d788b1ae05a4ad41f306";
const arkhaiTxUrl =
  "https://sepolia.etherscan.io/tx/0xc6d0a5bae417cb2d694d75c82ad2e28ffd308a3577f6734c610f576f0352f937";

function wait(page, ms) {
  return page.waitForTimeout(ms);
}

async function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}\n${stderr}`));
    });
  });
}

async function prepareDirs() {
  await rm(videoDir, { recursive: true, force: true });
  await mkdir(videoDir, { recursive: true });
  await mkdir(path.dirname(assetVideoPath), { recursive: true });
}

async function waitForStableLoad(page) {
  await page.waitForLoadState("domcontentloaded");
  await wait(page, 1800);
}

async function smoothScrollBy(page, distance, durationMs) {
  const steps = Math.max(1, Math.round(durationMs / 180));
  const stepDistance = distance / steps;
  const stepDelay = Math.max(40, Math.round(durationMs / steps));

  for (let index = 0; index < steps; index += 1) {
    await page.mouse.wheel(0, stepDistance);
    await wait(page, stepDelay);
  }
}

async function smoothScrollToSelector(page, selector, durationMs, fallbackRatio = 0.5) {
  let targetY;

  try {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout: 8000 });
    targetY = await locator.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return Math.max(0, window.scrollY + rect.top - 80);
    });
  } catch {
    targetY = await page.evaluate((ratio) => {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      return Math.round(maxScroll * ratio);
    }, fallbackRatio);
  }

  const currentY = await page.evaluate(() => window.scrollY);
  await smoothScrollBy(page, targetY - currentY, durationMs);
}

async function scrollToTop(page, durationMs = 2500) {
  const currentY = await page.evaluate(() => window.scrollY);
  await smoothScrollBy(page, -currentY, durationMs);
}

// Playwright records one video per page. To keep a single continuous demo file,
// proof pages are visited sequentially in the same page instead of separate tab videos.
async function visitProofPage(page, url, options = {}) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForStableLoad(page);

  await wait(page, options.initialPauseMs ?? 3500);

  if (options.scrollDistance) {
    await smoothScrollBy(page, options.scrollDistance, options.scrollDurationMs ?? 6000);
  }

  if (options.finalPauseMs) {
    await wait(page, options.finalPauseMs);
  }
}

async function convertToMp4() {
  await runProcess(ffmpegPath, [
    "-y",
    "-i",
    rawVideoPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    finalVideoPath,
  ]);
}

async function probeDurationSeconds(filePath) {
  const { stdout } = await runProcess(ffprobe.path, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);

  return Number.parseFloat(stdout.trim());
}

async function normalizeDurationIfNeeded(filePath, maxDurationSeconds, targetDurationSeconds) {
  const currentDuration = await probeDurationSeconds(filePath);
  if (currentDuration <= maxDurationSeconds) {
    return currentDuration;
  }

  const tempPath = filePath.replace(/\.mp4$/, ".trimmed.mp4");
  const speedFactor = Number((targetDurationSeconds / currentDuration).toFixed(6));

  await runProcess(ffmpegPath, [
    "-y",
    "-i",
    filePath,
    "-an",
    "-filter:v",
    `setpts=${speedFactor}*PTS`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    tempPath,
  ]);

  await rename(tempPath, filePath);
  return probeDurationSeconds(filePath);
}

async function main() {
  await prepareDirs();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    screen: { width: 1280, height: 720 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();
  const video = page.video();

  await page.goto(siteUrl, { waitUntil: "domcontentloaded" });
  await waitForStableLoad(page);
  await wait(page, 5000);

  await smoothScrollToSelector(page, "text=How it works", 9000, 0.22);
  await wait(page, 5000);

  await smoothScrollToSelector(page, "text=Live Proof", 7000, 0.58);
  await wait(page, 5000);

  await visitProofPage(page, escrowTxUrl, {
    initialPauseMs: 4000,
    scrollDistance: 2200,
    scrollDurationMs: 7000,
    finalPauseMs: 2500,
  });

  await page.goto(siteUrl, { waitUntil: "domcontentloaded" });
  await waitForStableLoad(page);
  await smoothScrollToSelector(page, "text=Live Proof", 3500, 0.58);
  await wait(page, 2000);

  await visitProofPage(page, statusTxUrl, {
    initialPauseMs: 3500,
    scrollDistance: 1200,
    scrollDurationMs: 4500,
    finalPauseMs: 1500,
  });

  await page.goto(siteUrl, { waitUntil: "domcontentloaded" });
  await waitForStableLoad(page);
  await smoothScrollToSelector(page, "text=Live Proof", 3000, 0.58);
  await wait(page, 1500);

  await visitProofPage(page, arkhaiTxUrl, {
    initialPauseMs: 3500,
    scrollDistance: 1600,
    scrollDurationMs: 5000,
    finalPauseMs: 1500,
  });

  await page.goto(siteUrl, { waitUntil: "domcontentloaded" });
  await waitForStableLoad(page);
  await smoothScrollToSelector(page, "text=Canonical settlement", 7500, 0.72);
  await wait(page, 5000);

  await smoothScrollToSelector(page, "text=Canonical dispute", 5000, 0.84);
  await wait(page, 3000);

  await smoothScrollBy(page, 2600, 12000);
  await wait(page, 5000);
  await scrollToTop(page, 2500);
  await wait(page, 1500);

  await page.close();
  const recordedPath = await video.path();
  await copyFile(recordedPath, rawVideoPath);
  await context.close();
  await browser.close();

  await convertToMp4();
  const normalizedDurationSeconds = await normalizeDurationIfNeeded(finalVideoPath, 120, 112);
  await copyFile(finalVideoPath, assetVideoPath);

  const [fileStats, durationSeconds] = await Promise.all([
    stat(finalVideoPath),
    Promise.resolve(normalizedDurationSeconds),
  ]);

  if (fileStats.size <= 1_000_000) {
    throw new Error(`Video is too small: ${fileStats.size} bytes`);
  }

  if (durationSeconds < 60) {
    throw new Error(`Video is too short: ${durationSeconds.toFixed(2)} seconds`);
  }

  console.log(
    JSON.stringify(
      {
        output: finalVideoPath,
        assetOutput: assetVideoPath,
        sizeBytes: fileStats.size,
        durationSeconds: Number(durationSeconds.toFixed(2)),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
