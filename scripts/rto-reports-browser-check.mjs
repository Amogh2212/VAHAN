import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = Number(process.env.RTO_REPORT_BROWSER_CHECK_PORT ?? 33_000 + (process.pid % 1_000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUTPUT_DIR = path.resolve("output", "playwright");

const BATCHES = [
  batch(901, "daily", "2026-07-24", "2026-07-24"),
  batch(902, "weekly", "2026-07-20", "2026-07-26"),
  batch(903, "monthly", "2026-07-01", "2026-07-31"),
];
const REPORTS = Array.from({ length: 100 }, (_, index) => reportSummary(index + 1));

async function waitForHealth(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`RTO report browser-check server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the RTO report browser-check server.");
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
      FACTOR_AGENT_ENABLED: "0",
      FACTOR_AGENT_MODE: "draft_only",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => { serverError += chunk.toString(); });
  let browser;
  try {
    await waitForHealth(server);
    const disabledFactorResponse = await fetch(`${BASE_URL}/api/admin/rto-factor-sources`);
    assert.equal(disabledFactorResponse.status, 503, "factor admin APIs must fail closed when disabled");
    browser = await chromium.launch({ headless: true });
    const emptyPage = await browser.newPage({ viewport: { width: 1920, height: 825 } });
    await emptyPage.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await emptyPage.route("**/api/rto-reports/**", fulfillEmptyReportApi);
    await emptyPage.goto(`${BASE_URL}/rto-reports.html`, { waitUntil: "networkidle" });
    assert.equal(await emptyPage.getByRole("tab", { name: "Daily" }).isVisible(), true);
    assert.equal(await emptyPage.locator("#rtoReportBatchDate").isHidden(), true);
    assert.equal(await emptyPage.locator("#rtoReportSearch").isHidden(), true);
    assert.equal(await emptyPage.locator("#rtoReportStatusFilter").isHidden(), true);
    assert.equal(await emptyPage.locator("#rtoReportBatchCsv").isHidden(), true);
    assert.equal(await emptyPage.locator("#rtoReportBatchStrip").isHidden(), true);
    assert.equal(await emptyPage.locator(".rto-report-list-panel").isHidden(), true);
    assert.equal(await emptyPage.getByRole("heading", { name: "No reports generated yet" }).isVisible(), true);
    assert.match(await emptyPage.locator(".rto-report-empty p").innerText(), /9,000 per top-100 cycle/);
    await assertTabsContained(emptyPage);
    await assertReadinessPillAligned(emptyPage);
    await assertNoPageOverflow(emptyPage);
    await emptyPage.screenshot({ path: path.join(OUTPUT_DIR, "rto-reports-empty.png"), fullPage: true });
    await emptyPage.close();

    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.route("**/api/rto-reports/**", fulfillReportApi);

    await page.goto(`${BASE_URL}/rto-reports.html`, { waitUntil: "networkidle" });
    assert.equal(await page.getByRole("heading", { name: "RTO reports", exact: true }).isVisible(), true);
    assert.equal(await page.locator("#rtoReportReadinessStatus").innerText(), "100 / 100");
    assert.equal(await page.locator(".rto-report-list-item").count(), 100);
    assert.equal(await page.getByRole("heading", { name: "Pune Central RTO" }).isVisible(), true);
    assert.equal(await page.getByRole("heading", { name: "OEM performance" }).isVisible(), true);
    assert.equal(await page.getByRole("heading", { name: "Possible drivers behind the numbers" }).isVisible(), true);
    assert.match(await page.locator(".rto-factor-card").innerText(), /associated with a higher daily EV run-rate/i);
    assert.equal(
      await page.getByRole("link", { name: "Maharashtra EV policy notice" }).getAttribute("href"),
      "https://transport.maharashtra.gov.in/notices/ev-policy-example",
    );
    assert.equal(await page.locator("#rtoReportBatchDate").inputValue(), "2026-07-24");
    assert.equal(await page.locator("#rtoReportPeriodStatus").innerText(), "READY WITH WARNINGS");
    const metricCards = page.locator(".rto-report-metrics article");
    await expectMetricCard(metricCards.nth(0), "EV registrations", "1,253", "Fetched MTD; daily N/A");
    await expectMetricCard(metricCards.nth(1), "ICE registrations", "5,908", "Fetched MTD; daily N/A");
    await expectMetricCard(metricCards.nth(2), "EV share", "17.5%", "Fetched MTD; daily N/A");
    assert.match(await page.locator(".rto-report-list-item").first().innerText(), /EV MTD 1,253/);
    await page.evaluate(() => {
      window.__rtoDatePickerOpened = 0;
      HTMLInputElement.prototype.__rtoOriginalShowPicker = HTMLInputElement.prototype.showPicker;
      HTMLInputElement.prototype.showPicker = function showPickerSpy() {
        if (this.id === "rtoReportBatchDate") window.__rtoDatePickerOpened += 1;
      };
    });
    await page.locator("#rtoReportBatchDate").click();
    assert.equal(await page.evaluate(() => window.__rtoDatePickerOpened), 1);
    await page.evaluate(() => {
      HTMLInputElement.prototype.showPicker = HTMLInputElement.prototype.__rtoOriginalShowPicker;
      delete HTMLInputElement.prototype.__rtoOriginalShowPicker;
      delete window.__rtoDatePickerOpened;
    });
    assert.equal(await page.getByRole("button", { name: "2W OEMs" }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "All categories" }).count(), 0);
    assert.equal(await page.locator(".rto-report-table tbody tr").count(), 5);
    const twoWText = await page.locator(".rto-report-table tbody").innerText();
    assert.match(twoWText, /Hero MotoCorp/);
    assert.match(twoWText, /Bajaj Auto \(2W\)/);
    assert.doesNotMatch(twoWText, /Maruti Suzuki/);
    await page.getByRole("button", { name: "4W OEMs" }).click();
    assert.equal(await page.getByRole("button", { name: "4W OEMs" }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".rto-report-table tbody tr").count(), 5);
    const fourWText = await page.locator(".rto-report-table tbody").innerText();
    assert.match(fourWText, /Maruti Suzuki/);
    assert.match(fourWText, /JSW MG Motor India/);
    assert.doesNotMatch(fourWText, /Bajaj Auto \(2W\)/);
    assert.equal(await page.locator("#rtoReportBatchCsv").getAttribute("href"), "/api/rto-reports/batches/901.csv");
    await assertTabsContained(page);
    await assertReadinessPillAligned(page);
    await assertNoPageOverflow(page);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "rto-reports-desktop.png"), fullPage: true });

    await page.getByRole("tab", { name: "Weekly" }).click();
    await page.waitForFunction(() => document.querySelector("#rtoReportBatchDate")?.value === "2026-07-26");
    assert.match(await page.locator("#rtoReportListMeta").innerText(), /20 Jul - 26 Jul/);

    await page.getByRole("tab", { name: "Daily" }).click();
    await page.locator("#rtoReportBatchDate").fill("2026-07-24");
    await page.locator("#rtoReportBatchDate").dispatchEvent("change");
    await page.waitForFunction(() => document.querySelector("#rtoReportBatchCsv")?.getAttribute("href") === "/api/rto-reports/batches/901.csv");
    const search = page.getByPlaceholder("Search RTO or state");
    await search.fill("Mumbai");
    await page.waitForFunction(() => document.querySelectorAll(".rto-report-list-item").length === 1);
    await page.getByRole("heading", { name: "Mumbai Central RTO" }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("heading", { name: "Mumbai Central RTO" }).isVisible(), true);
    await search.fill("");
    await page.locator("#rtoReportStatusFilter").selectOption("needs_review");
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll(".rto-report-list-status")];
      return rows.length > 0 && rows.every((row) => row.textContent.trim() === "Review");
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#rtoReportStatusFilter").selectOption("");
    await page.waitForFunction(() => document.querySelectorAll(".rto-report-list-item").length === 100);
    await assertNoPageOverflow(page);
    const metricColumns = await page.locator(".rto-report-metrics").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").length);
    assert.equal(metricColumns, 1, "headline metrics must stack on narrow mobile screens");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "rto-reports-mobile.png"), fullPage: true });

    assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);
    console.log("RTO report browser checks passed.");
  } finally {
    await browser?.close().catch(() => {});
    if (server.exitCode === null) server.kill();
    if (serverError.trim()) process.stderr.write(serverError);
  }
}

async function fulfillReportApi(route) {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/rto-reports/readiness") {
    await json(route, {
      eligible: true,
      reason: null,
      expectedRtos: 100,
      cohortSize: 100,
      completeRtos: 100,
      missingRtos: [],
      run: { id: 77, snapshotDate: "2026-07-24", reportCohortSize: 100 },
    });
    return;
  }
  if (url.pathname === "/api/rto-reports/batches") {
    await json(route, { batches: BATCHES });
    return;
  }
  const reportsMatch = url.pathname.match(/^\/api\/rto-reports\/batches\/(\d+)\/reports$/);
  if (reportsMatch) {
    const batchId = Number(reportsMatch[1]);
    const query = url.searchParams.get("q")?.toLowerCase() ?? "";
    const status = url.searchParams.get("status") ?? "";
    const reports = REPORTS
      .map((report) => ({ ...report, batchId }))
      .filter((report) => !query || `${report.state} ${report.rto}`.toLowerCase().includes(query))
      .filter((report) => !status || report.status === status);
    await json(route, { batch: BATCHES.find((entry) => entry.id === batchId), reports });
    return;
  }
  const reportMatch = url.pathname.match(/^\/api\/rto-reports\/(\d+)$/);
  if (reportMatch) {
    const id = Number(reportMatch[1]);
    const summary = REPORTS.find((entry) => entry.id === id) ?? REPORTS[0];
    await json(route, { report: fullReport(summary) });
    return;
  }
  await route.continue();
}

async function fulfillEmptyReportApi(route) {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/rto-reports/readiness") {
    await json(route, {
      eligible: false,
      reason: "no_frozen_cohort",
      expectedRtos: 100,
      cohortSize: 0,
      completeRtos: 0,
      missingRtos: [],
      run: null,
    });
    return;
  }
  if (url.pathname === "/api/rto-reports/batches") {
    await json(route, { batches: [] });
    return;
  }
  await route.continue();
}

async function json(route, body) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function assertNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.page <= dimensions.viewport + 1,
    `page width ${dimensions.page}px exceeds viewport ${dimensions.viewport}px`,
  );
}

async function assertTabsContained(page) {
  const geometry = await page.locator(".rto-report-tabs").evaluate((container) => {
    const track = container.getBoundingClientRect();
    const tabs = [...container.querySelectorAll(".rto-report-tab")].map((tab) => {
      const rect = tab.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    });
    return {
      track: { top: track.top, right: track.right, bottom: track.bottom, left: track.left },
      tabs,
    };
  });
  for (const tab of geometry.tabs) {
    assert.ok(tab.top >= geometry.track.top, "report tab must not overflow above its track");
    assert.ok(tab.right <= geometry.track.right, "report tab must not overflow past the track's right edge");
    assert.ok(tab.bottom <= geometry.track.bottom, "report tab must not overflow below its track");
    assert.ok(tab.left >= geometry.track.left, "report tab must not overflow past the track's left edge");
  }
}

async function assertReadinessPillAligned(page) {
  const style = await page.locator("#rtoReportReadinessStatus").evaluate((pill) => {
    const computed = getComputedStyle(pill);
    return {
      display: computed.display,
      alignItems: computed.alignItems,
      justifyItems: computed.justifyItems,
      alignSelf: computed.alignSelf,
      justifySelf: computed.justifySelf,
      lineHeight: computed.lineHeight,
    };
  });
  assert.ok(["grid", "inline-grid"].includes(style.display));
  assert.equal(style.alignItems, "center");
  assert.equal(style.justifyItems, "center");
  assert.equal(style.alignSelf, "center");
  assert.equal(style.justifySelf, "end");
  assert.notEqual(style.lineHeight, "normal");
}

function batch(id, cadence, periodStart, periodEnd) {
  return {
    id,
    cadence,
    periodStart,
    periodEnd,
    sourceSnapshotDate: periodEnd,
    sourceRunId: 77,
    cohortHash: "100-rto-browser-fixture",
    cohortSize: 100,
    status: "ready_with_warnings",
    revision: 2,
    coverageCount: 100,
    reportCount: 100,
    warningCount: 7,
    reviewCount: 2,
    lateFill: false,
    generatedAt: "2026-07-24T18:00:00.000Z",
  };
}

function reportSummary(rank) {
  const names = rank === 1
    ? ["Maharashtra", "Pune Central RTO"]
    : rank === 2
      ? ["Maharashtra", "Mumbai Central RTO"]
      : [`State ${String(Math.ceil(rank / 4)).padStart(2, "0")}`, `Regional RTO ${String(rank).padStart(3, "0")}`];
  const status = rank % 37 === 0 ? "needs_review" : rank % 13 === 0 ? "ready_with_warnings" : "ready";
  const missingDailyBoundary = rank === 1;
  const periodEv = missingDailyBoundary ? null : 90 + rank;
  const periodIce = missingDailyBoundary ? null : 420 + rank * 2;
  const mtdEv = 1_250 + rank * 3;
  const mtdIce = 5_900 + rank * 8;
  return {
    id: 10_000 + rank,
    batchId: 901,
    state: names[0],
    rto: names[1],
    selectionRank: rank,
    cohortRank: rank,
    previousRank: rank === 1 ? 2 : rank - 1,
    status,
    periodEv,
    periodIce,
    mtdEv,
    mtdIce,
    evShare: missingDailyBoundary ? null : 17.8,
    summary: missingDailyBoundary
      ? `${names[1]} has unavailable daily additions because the previous-day boundary is incomplete. Month-to-date totals are ${mtdEv} EV and ${mtdIce} ICE registrations.`
      : `${names[1]} recorded ${periodEv} EV and ${periodIce} ICE registrations in this period.`,
    generatedAt: "2026-07-24T18:00:00.000Z",
  };
}

function fullReport(summary) {
  const categories = [
    { vehicleCategory: "2W", period: { ev: 64, ice: 290, total: 354 }, mtd: { ev: 880, ice: 4_050, total: 4_930 } },
    { vehicleCategory: "3W", period: { ev: 18, ice: 42, total: 60 }, mtd: { ev: 220, ice: 590, total: 810 } },
    { vehicleCategory: "4W", period: { ev: 9, ice: 90, total: 99 }, mtd: { ev: 153, ice: 1_268, total: 1_421 } },
  ];
  const oemNames = [
    "Hero MotoCorp",
    "Honda Motorcycle",
    "TVS Motor (2W)",
    "Bajaj Auto (2W)",
    "Suzuki Motorcycle",
    "Bajaj Auto (3W)",
    "Mahindra Last Mile Mobility",
    "TVS Motor (3W)",
    "Piaggio Vehicles",
    "Atul Auto",
    "Maruti Suzuki",
    "Tata Motors",
    "Mahindra & Mahindra",
    "Hyundai Motor India",
    "JSW MG Motor India",
  ];
  return {
    ...summary,
    cadence: "daily",
    periodStart: "2026-07-24",
    periodEnd: "2026-07-24",
    sourceSnapshotDate: "2026-07-24",
    sourceRunId: 77,
    cohortHash: "100-rto-browser-fixture",
    cohortSize: 100,
    revision: 2,
    explanations: [
      {
        id: 8001,
        status: "approved",
        heading: "State EV incentive timing",
        body: "The policy window was associated with a higher daily EV run-rate after comparison with five frozen-cohort controls. This is an association, not proof of causation.",
        confidenceLabel: "supported",
        limitations: ["The post-event window is short and other local influences may remain."],
        citations: [
          {
            documentId: 91,
            citationLabel: "Maharashtra EV policy notice",
            document: {
              id: 91,
              title: "Maharashtra EV policy notice",
              canonicalUrl: "https://transport.maharashtra.gov.in/notices/ev-policy-example",
              source: {
                publisher: "Maharashtra Transport Department",
                sourceTier: "A",
              },
            },
          },
        ],
      },
    ],
    payload: {
      schemaVersion: 1,
      cadence: "daily",
      period: { label: "24 July 2026", periodStart: "2026-07-24", periodEnd: "2026-07-24" },
      rto: {
        state: summary.state,
        name: summary.rto,
        selectionRank: summary.selectionRank,
        cohortRank: summary.cohortRank,
        previousRank: summary.previousRank,
      },
      metrics: {
        period: {
          ev: summary.periodEv,
          ice: summary.periodIce,
          total: sumMetric(summary.periodEv, summary.periodIce),
          evShare: summary.evShare,
        },
        previousPeriod: { ev: 82, ice: 407, total: 489, evShare: 16.8 },
        mtd: { ev: summary.mtdEv, ice: summary.mtdIce, total: summary.mtdEv + summary.mtdIce, evShare: 17.5 },
        change: {
          ev: { absolute: 9, percent: 11.0 },
          ice: { absolute: 15, percent: 3.7 },
          total: { absolute: 24, percent: 4.9 },
        },
      },
      categories,
      oems: oemNames.map((oem, index) => ({
        oem,
        categories: ["2W", "3W", "4W"].map((vehicleCategory, categoryIndex) => {
          const categoryStart = categoryIndex * 5;
          const outsideConfiguredCategory = index < categoryStart || index >= categoryStart + 5;
          return {
          vehicleCategory,
          period: { ev: outsideConfiguredCategory ? 0 : Math.max(0, 12 - index - categoryIndex), ice: outsideConfiguredCategory ? 0 : Math.max(1, 36 - index * 2 - categoryIndex), total: outsideConfiguredCategory ? 0 : Math.max(1, 48 - index * 3 - categoryIndex * 2) },
          previousPeriod: { ev: outsideConfiguredCategory ? 0 : Math.max(0, 10 - index - categoryIndex), ice: outsideConfiguredCategory ? 0 : Math.max(1, 33 - index * 2 - categoryIndex), total: outsideConfiguredCategory ? 0 : Math.max(1, 43 - index * 3 - categoryIndex * 2) },
          change: { total: { absolute: index % 3 === 0 ? -2 : 7 } },
        }; }),
      })),
      trend: Array.from({ length: 14 }, (_, index) => ({
        date: `2026-07-${String(11 + index).padStart(2, "0")}`,
        ev: 70 + index * 2 + (index % 3),
        ice: 360 + index * 5 - (index % 4) * 4,
        complete: true,
      })),
      quality: {
        status: summary.status,
        lateFill: false,
        warnings: summary.status === "ready" ? [] : ["One supporting comparison should be reviewed before publication."],
      },
    },
  };
}

function sumMetric(...values) {
  return values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;
}

async function expectMetricCard(locator, label, value, note) {
  const text = await locator.innerText();
  assert.match(text, new RegExp(`^${label}\\s+${value}\\s+${note}$`, "i"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
