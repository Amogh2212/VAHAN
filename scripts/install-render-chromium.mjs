import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.env.RENDER === "true") {
  const cli = fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url));
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
  const env = process.env;
  console.log("Installing Chromium for Render's Playwright runtime...");
  execFileSync(process.execPath, [cli, "install", "chromium"], { env, stdio: "inherit" });
  const { chromium } = await import("playwright");
  const browserPath = chromium.executablePath();
  if (!existsSync(browserPath)) {
    throw new Error(`Chromium installation finished, but the runtime executable is missing: ${browserPath}`);
  }
  console.log(`Chromium ready: ${browserPath}`);
}