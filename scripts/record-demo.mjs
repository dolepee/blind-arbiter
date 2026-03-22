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
  await wait(page, 3500);

  await smoothScrollToSelector(page, "text=How it works", 7000, 0.22);
  await wait(page, 3000);

  await smoothScrollToSelector(page, "text=Settlement flow", 6500, 0.38);
  await wait(page, 4000);

  await smoothScrollBy(page, 1400, 4500);
  await wait(page, 2500);

  await smoothScrollToSelector(page, "text=Live Proof", 6500, 0.58);
  await wait(page, 4000);

  await smoothScrollBy(page, 1600, 5000);
  await wait(page, 2500);

  await smoothScrollToSelector(page, "text=Canonical settlement", 6500, 0.74);
  await wait(page, 4500);

  await smoothScrollToSelector(page, "text=Canonical dispute", 5500, 0.87);
  await wait(page, 4500);

  await smoothScrollBy(page, 1800, 5500);
  await wait(page, 4500);

  await page.close();
  const recordedPath = await video.path();
  await copyFile(recordedPath, rawVideoPath);
  await context.close();
  await browser.close();

  await convertToMp4();
  const normalizedDurationSeconds = await normalizeDurationIfNeeded(finalVideoPath, 80, 68);
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
