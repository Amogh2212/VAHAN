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
      DATABASE_URL: "",
      NODE_ENV: "test",
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
    assert.match(await emptyPage.locator(".rto-report-empty p").innerText(), /six EV\/ICE and 2W\/3W\/4W monthly-registration observations/);
    await assertTabsContained(emptyPage);
    await assertReadinessPillAligned(emptyPage);
    await assertReadinessContentsContained(emptyPage);
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
    assert.equal(await page.getByRole("heading", { name: "OEM distribution unavailable" }).isVisible(), true);
    assert.equal(await page.getByRole("heading", { name: "Vehicle categories" }).isVisible(), true);
    assert.equal(await page.getByRole("heading", { name: "Possible drivers behind the numbers" }).isVisible(), true);
    assert.match(await page.locator(".rto-factor-card").innerText(), /associated with a higher daily EV run-rate/i);
    assert.equal(
      await page.getByRole("link", { name: "Maharashtra EV policy notice" }).getAttribute("href"),
      "https://transport.maharashtra.gov.in/notices/ev-policy-example",
    );
    assert.equal(await page.locator("#rtoReportBatchDate").inputValue(), "2026-07-24");
    assert.equal(await page.locator("#rtoReportPeriodStatus").innerText(), "READY WITH WARNINGS");
    const metricCards = page.locator(".rto-report-metrics article");
    await expectMetricCard(metricCards.nth(0), "Previous-day registrations", "+489", "2026-07-23 (IST) · Verified comparison");
    await expectMetricCard(metricCards.nth(1), "EV registrations", "+91", "2026-07-24 (IST) · Verified comparison");
    await expectMetricCard(metricCards.nth(2), "ICE registrations", "+422", "2026-07-24 (IST) · Verified comparison");
    assert.match(await page.locator(".rto-report-list-item").first().innerText(), /Daily EV \+91/);
    assert.match(await page.locator(".rto-report-detail").innerText(), /EV month to date\s+1,253/i);
    assert.match(await page.locator(".rto-report-detail").innerText(), /Maker chart lacks an exact target-month contract/);
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
    assert.equal(await page.getByRole("button", { name: "2W OEMs" }).count(), 0, "unverified monthly OEM evidence must not render a maker table");
    assert.equal(await page.locator(".rto-report-category-row").count(), 3);
    assert.equal(await page.locator("#rtoReportBatchCsv").getAttribute("href"), "/api/rto-reports/batches/901.csv");
    await assertTabsContained(page);
    await assertReadinessPillAligned(page);
    await assertReadinessContentsContained(page);
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
    await assertReadinessContentsContained(page);
    await assertNoPageOverflow(page);
    const metricColumns = await page.locator('.rto-report-metrics[aria-label="Headline metrics"]').evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").length);
    assert.equal(metricColumns, 1, "headline metrics must stack on narrow mobile screens");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "rto-reports-mobile.png"), fullPage: true });

    await page.locator("#rtoReportBatchDate").fill("2026-07-23");
    await page.locator("#rtoReportBatchDate").dispatchEvent("change");
    await page.getByText("Source evidence", { exact: true }).waitFor();
    assert.equal(await page.locator("#rtoReportPeriodLabel").innerText(), "SOURCE EVIDENCE DATE");
    assert.match(await page.locator("#rtoReportPeriodHelp").innerText(), /not a complete Daily registration report/i);
    assert.equal(await page.locator(".rto-report-list-item").count(), 1);
    assert.match(await page.locator(".rto-report-detail").innerText(), /6\/6 verified monthly-registration scopes/i);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "rto-reports-source-evidence.png"), fullPage: true });
    assert.match(await page.locator(".rto-report-detail").innerText(), /Daily total\s+\+489/i);
    assert.match(await page.locator(".rto-current-daily-change.is-up").first().innerText(), /↑ \+91/);
    await assertReadinessContentsContained(page);
    await assertNoPageOverflow(page);

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
      dailyRegistrationEligible: true,
      comparisonEligibleRtos: 100,
      dailyRegistrationReason: null,
      missingRtos: [],
      run: { id: 77, snapshotDate: "2026-07-24", reportCohortSize: 100 },
    });
    return;
  }
  if (url.pathname === "/api/rto-reports/batches") {
    await json(route, { batches: BATCHES });
    return;
  }
  if (url.pathname === "/api/rto-reports/evidence" && url.searchParams.get("date") === "2026-07-23") {
    await json(route, {
      eligible: false,
      reason: "collection_incomplete",
      expectedRtos: 100,
      cohortSize: 100,
      completeRtos: 1,
      dailyRegistrationEligible: false,
      comparisonEligibleRtos: 0,
      dailyRegistrationReason: "Collection is incomplete.",
      missingRtos: [],
      currentCycleEvidence: [{
        state: "Maharashtra",
        rto: "Pune Central RTO",
        verifiedScopes: 6,
        evMonthToDate: 1253,
        iceMonthToDate: 984,
        totalMonthToDate: 2237,
        daily: { ev: 91, ice: 398, total: 489, status: "available" },
        scopes: [],
      }],
      run: { id: 76, snapshotDate: "2026-07-23", reportCohortSize: 100 },
    });
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

async function assertReadinessContentsContained(page) {
  const geometry = await page.locator(".rto-report-readiness").evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect();
    const children = [...panel.children]
      .filter((child) => !child.hidden)
      .map((child) => {
        const rect = child.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
    return {
      panel: { left: panelRect.left, right: panelRect.right },
      children,
    };
  });
  for (const child of geometry.children) {
    assert.ok(child.left >= geometry.panel.left - 1, "readiness content must not extend past the left edge");
    assert.ok(child.right <= geometry.panel.right + 1, "readiness content must not extend past the right edge");
  }
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
  const periodEv = 90 + rank;
  const periodIce = 420 + rank * 2;
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
    evShare: periodEv / (periodEv + periodIce) * 100,
    summary: `${names[1]} recorded ${periodEv} EV and ${periodIce} ICE registrations on 2026-07-24.`,
    generatedAt: "2026-07-24T18:00:00.000Z",
  };
}

function fullReport(summary) {
  const categories = [
    { vehicleCategory: "2W", period: { ev: 64, ice: 290, total: 354 }, stock: { ev: 880, ice: 4_050, total: 4_930 } },
    { vehicleCategory: "3W", period: { ev: 18, ice: 42, total: 60 }, stock: { ev: 220, ice: 590, total: 810 } },
    { vehicleCategory: "4W", period: { ev: 9, ice: 90, total: 99 }, stock: { ev: 153, ice: 1_268, total: 1_421 } },
  ];
  const prior = { ev: 82, ice: 407, total: 489, evShare: 82 / 489 * 100 };
  const dateField = (value, date) => ({ value, date, timezone: "Asia/Kolkata", status: "available", reason: null });
  const oemReason = "Maker chart lacks an exact target-month contract; Daily headline registrations remain available from the six verified monthly totals.";
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
      kind: "rto-daily-registration-report",
      metricKind: "registration_month_to_date",
      cadence: "daily",
      period: { label: "24 July 2026", start: "2026-07-24", end: "2026-07-24", comparisonStart: "2026-07-23", comparisonEnd: "2026-07-23" },
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
        previousPeriod: prior,
        sourceMonthToDate: { ev: summary.mtdEv, ice: summary.mtdIce, total: summary.mtdEv + summary.mtdIce, evShare: summary.mtdEv / (summary.mtdEv + summary.mtdIce) * 100 },
        activeStock: { ev: null, ice: null, total: null, evShare: null, status: "not_collected_by_daily_registration_run" },
      },
      dailyRegistration: {
        status: "available",
        reason: null,
        date: "2026-07-24",
        timezone: "Asia/Kolkata",
        baselineEligible: true,
        previousDayEligible: true,
        previousDayRegistrations: dateField(prior.total, "2026-07-23"),
        evRegistrations: dateField(summary.periodEv, "2026-07-24"),
        iceRegistrations: dateField(summary.periodIce, "2026-07-24"),
        evShare: dateField(summary.evShare, "2026-07-24"),
        rank: dateField(summary.cohortRank, "2026-07-24"),
      },
      categories,
      oems: [],
      oemEvidence: { status: "unavailable", reason: oemReason, segments: [] },
      trend: Array.from({ length: 14 }, (_, index) => ({
        date: `2026-07-${String(11 + index).padStart(2, "0")}`,
        ev: 70 + index * 2 + (index % 3),
        ice: 360 + index * 5 - (index % 4) * 4,
        complete: true,
      })),
      quality: {
        status: summary.status,
        lateFill: false,
        currentCoverage: true,
        registrationCoverage: 6,
        comparisonEligible: true,
        previousDayEligible: true,
        warnings: [oemReason],
      },
      source: {
        validationContract: "public-registration-mtd-v1",
        registrationFlowAvailable: true,
        dailyBaselineEligible: true,
        limitation: null,
        totalsTable: "rto_registration_observations.month_to_date_total",
        oemTable: null,
        metricKind: "registration_month_to_date",
        sourceSystem: "vahan-public-dashboard",
        targetMonth: "2026-07",
        requestHashes: ["1".repeat(64)],
        responseHashes: ["2".repeat(64)],
        freshnessStatus: "comparison_verified",
        freshnessReason: "The source does not publish a refresh timestamp; distinct consecutive response hashes establish only comparison freshness.",
        oemContract: { status: "unavailable", reason: oemReason },
      },
    },
  };
}

function sumMetric(...values) {
  return values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;
}

async function expectMetricCard(locator, label, value, note) {
  const text = await locator.innerText();
  assert.match(text, new RegExp(`^${escapeRegExp(label)}\\s+${escapeRegExp(value)}\\s+${escapeRegExp(note)}$`, "i"));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
