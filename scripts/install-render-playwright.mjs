import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.RENDER === "true") {
  const cli = fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "install", "chromium"], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
