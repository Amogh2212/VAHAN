import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = Number(process.env.RTO_DAILY_BROWSER_CHECK_PORT ?? 32_000 + (process.pid % 1_000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUTPUT_DIR = path.resolve("output", "playwright");

async function waitForHealth(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`RTO browser-check server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the RTO browser-check server.");
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const server = spawn(process.execPath, ["--env-file=.env", "server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      AI_QUERY_PROVIDER: "none",
      FACTOR_AGENT_PROVIDER: "none",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_QUERY_MODEL: "qwen3:4b",
      OLLAMA_FACTOR_MODEL: "qwen3:4b",
      OLLAMA_TIMEOUT_MS: "10000",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      VAHAN_DISABLE_LIVE_REFRESH: "1",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_ENABLE_POLLING: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => { serverError += chunk.toString(); });
  let browser;
  try {
    await waitForHealth(server);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.route("**/api/rto-daily/trend?**", async (route) => {
      const url = new URL(route.request().url());
      const filters = {
        state: url.searchParams.get("state"),
        rto: url.searchParams.get("rto"),
        fuelGroup: url.searchParams.get("fuelGroup"),
        category: url.searchParams.get("category"),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          filters,
          rows: [
            registrationObservation({ ...filters, snapshotDate: "2026-07-23", monthToDateTotal: 1_200 }),
            registrationObservation({
              ...filters,
              snapshotDate: "2026-07-24",
              monthToDateTotal: 1_195,
              dailyRegistration: -5,
              status: "correction",
            }),
          ],
        }),
      });
    });
    await page.goto(`${BASE_URL}/rto-trends.html`, { waitUntil: "networkidle" });

    const lookup = page.getByRole("combobox", { name: "Search official RTO" });
    await lookup.fill("hari");
    await page.waitForFunction(() => /haridwar/i.test(document.querySelector('[role="option"]')?.textContent ?? ""));
    assert.equal(await page.locator("#rtoRequestBtn").isHidden(), true, "queue action must stay hidden until an RTO is selected");
    assert.equal(await page.locator("#rtoPinBtn").isHidden(), true, "pin action must stay hidden until an RTO is selected");
    assert.match(await page.getByRole("option").first().innerText(), /haridwar/i, "canonical Haridwar labels should outrank partial city aliases");
    const menuIsTopLayer = await page.evaluate(() => {
      const menu = document.querySelector("#rtoLookupSuggestions");
      const rect = menu.getBoundingClientRect();
      const top = document.elementsFromPoint(rect.left + 20, Math.min(rect.bottom - 12, window.innerHeight - 12))[0];
      return Boolean(top && menu.contains(top));
    });
    assert.equal(menuIsTopLayer, true, "RTO suggestions must render above the snapshot panel");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "rto-dropdown-layering.png"), fullPage: true });
    await page.getByRole("option").first().click();
    await page.getByRole("heading", { name: /Haridwar.*registration trend/i }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("button", { name: "Sign in to pin" }).isVisible(), true);
    assert.match(await page.locator("#rtoTrendMeta").innerText(), /Calendar Year \/ Monthly/i);
    assert.match(await page.locator("#rtoTrendSummary").innerText(), /Source month to date\s*1,195\s*2026-07-24/i);
    assert.match(await page.locator("#rtoTrendSummary").innerText(), /Daily registrations\s*-5\s*Consecutive compatible comparison/i);
    assert.match(await page.locator("#rtoTrendRows tr").first().innerText(), /Unavailable No previous accepted observation/i);
    const correctionRow = page.locator("#rtoTrendRows tr").last();
    assert.match(await correctionRow.innerText(), /2026-07-24\s+2026-07\s+1,195\s+-5 correction preserved\s+correction/i);
    assert.equal(await page.locator("#rtoOem").count(), 0, "the obsolete fixed-maker selector must not return");

    const optionTheme = await page.locator("#rtoFuelGroup option").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color };
    });
    assert.notEqual(optionTheme.backgroundColor, optionTheme.color, "native option text needs visible contrast against its background");

    await lookup.fill("noida");
    await page.getByRole("option").first().waitFor({ state: "visible" });
    await lookup.press("ArrowDown");
    await lookup.press("Enter");
    await page.getByRole("heading", { name: /Noida.*registration trend/i }).waitFor({ state: "visible" });
    assert.equal(await lookup.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#rtoRequestBtn").isHidden(), true, "queue action is admin-only and must stay hidden for signed-out users");

    await page.screenshot({ path: path.join(OUTPUT_DIR, "rto-dual-system.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoPageOverflow(page);
    assert.equal(
      await page.locator("#rtoTrendSummary").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
      1,
      "trend metrics must stack on 390px mobile",
    );
    await page.screenshot({ path: path.join(OUTPUT_DIR, "rto-registration-trend-mobile.png"), fullPage: true });
    assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);
    console.log("RTO daily browser checks passed.");
  } finally {
    await browser?.close().catch(() => {});
    if (server.exitCode === null) server.kill();
    if (serverError.trim()) process.stderr.write(serverError);
  }
}

async function assertNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.page <= dimensions.viewport + 1, `page width ${dimensions.page}px exceeds viewport ${dimensions.viewport}px`);
}

function registrationObservation({ state, rto, fuelGroup, category, snapshotDate, monthToDateTotal, dailyRegistration = null, status = "unavailable" }) {
  return {
    snapshotDate,
    targetMonth: "2026-07",
    state,
    rto,
    fuelGroup,
    vehicleCategory: category,
    metricKind: "registration_month_to_date",
    monthToDateTotal,
    dailyRegistration,
    correction: Number(dailyRegistration) < 0,
    status,
    unavailableReason: dailyRegistration === null ? "No previous accepted observation." : null,
    observedAt: `${snapshotDate}T12:30:00.000Z`,
    requestHash: "1".repeat(64),
    responseHash: snapshotDate.endsWith("23") ? "2".repeat(64) : "3".repeat(64),
    freshness: { status: dailyRegistration === null ? "baseline_only" : "comparison_verified" },
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
