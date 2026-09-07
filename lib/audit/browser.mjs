import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { writeTextExclusive } from "./artifacts.mjs";
import { findFreePortRange, skippedResult } from "./command-runner.mjs";
import { safeAuditEnvironment } from "./policy.mjs";

export async function runControlledBrowser({ repoRoot, runDirectory, redactor }) {
  const startedAt = new Date();
  const startedNs = process.hrtime.bigint();
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return skippedResult("browser-controlled", "browser", "Playwright is unavailable; browser behavior was not verified.");
  }

  const port = await findFreePortRange(1);
  const baseUrl = `http://127.0.0.1:${port}`;
  const auditEnvironment = safeAuditEnvironment();
  const environment = {
    ...auditEnvironment,
    PORT: String(port),
    NODE_ENV: "test",
    APP_BASE_URL: baseUrl,
    CSRF_SECRET: "audit-only-csrf-secret-at-least-thirty-two-characters",
    SESSION_COOKIE_SECURE: "0",
    TRUST_PROXY_HOPS: "0",
    MAX_JSON_BODY_BYTES: "4096",
    EXPENSIVE_RATE_LIMIT_WINDOW_MS: "60000",
    EXPENSIVE_RATE_LIMIT_MAX: "20",
    BIND_HOST: "127.0.0.1",
  };
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  server.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  server.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

  const checks = [];
  let browser;
  let status = "passed";
  let reason = null;
  try {
    await waitForHealth(baseUrl, server);
    await apiChecks(baseUrl, checks);
    try {
      browser = await chromium.launch({ headless: true, env: auditEnvironment });
    } catch (error) {
      if (/executable.*doesn.t exist|browser.*not found|playwright install/i.test(error.message)) {
        status = "skipped";
        reason = "Playwright is installed but Chromium is unavailable; run npx playwright install chromium in the audit environment.";
        checks.push(check("chromium-prerequisite", "skipped", reason));
      } else {
        throw error;
      }
    }
    if (browser) await pageChecks({ browser, baseUrl, runDirectory, checks });
    const failureCount = checks.filter((item) => item.status === "failed").length;
    const skippedCount = checks.filter((item) => item.status === "skipped").length;
    if (failureCount) {
      status = "failed";
      reason = `${failureCount} controlled browser check(s) failed.`;
    } else if (status === "passed" && skippedCount) {
      status = "partial";
      reason = `${skippedCount} controlled browser check(s) were explicitly skipped.`;
    }
  } catch (error) {
    status = "failed";
    reason = error.message;
    checks.push(check("browser-harness", "failed", error.message));
  } finally {
    await browser?.close().catch(() => {});
    if (server.exitCode === null) server.kill();
    await Promise.race([
      new Promise((resolve) => server.once("close", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }

  const stdoutLog = "logs/browser-server.stdout.log";
  const stderrLog = "logs/browser-server.stderr.log";
  await Promise.all([
    writeTextExclusive(runDirectory, stdoutLog, Buffer.concat(stdout).toString("utf8"), redactor),
    writeTextExclusive(runDirectory, stderrLog, Buffer.concat(stderr).toString("utf8"), redactor),
  ]);
  return {
    id: "browser-controlled",
    domain: "browser",
    command: "isolated loopback server + Playwright Chromium; only the exact audit origin is allowed",
    deterministic: true,
    gate: true,
    status,
    exitCode: status === "failed" ? 1 : 0,
    signal: null,
    startedAt: startedAt.toISOString(),
    durationMs: Math.round(Number(process.hrtime.bigint() - startedNs) / 1_000_000),
    environmentMode: "fixture_no_database_no_credentials_no_live_vahan_exact_origin_only_service_workers_blocked",
    stdoutLog,
    stderrLog,
    stdoutTruncated: false,
    stderrTruncated: false,
    reason,
    affectedFiles: ["server.mjs", "public/index.html", "public/app.js", "public/rto-reports.html", "public/rto-reports.js"],
    checks,
  };
}

async function apiChecks(baseUrl, checks) {
  const health = await fetchJson(`${baseUrl}/health`);
  record(checks, "health", health.response.ok && health.body.status === "ok", `HTTP ${health.response.status}`);
  record(checks, "live-vahan-disabled", health.body.liveRefreshDisabled === true, `liveRefreshDisabled=${health.body.liveRefreshDisabled}`);

  const ready = await fetchJson(`${baseUrl}/ready`);
  record(checks, "readiness", ready.response.ok, `HTTP ${ready.response.status}`);
  record(checks, "security-headers", Boolean(ready.response.headers.get("content-security-policy")) && ready.response.headers.get("x-content-type-options") === "nosniff", "CSP and nosniff required");

  const me = await fetchJson(`${baseUrl}/api/me`);
  record(checks, "unauthenticated-session", me.response.ok && me.body.authenticated === false, `HTTP ${me.response.status}`);
  const protectedRoute = await fetchJson(`${baseUrl}/api/tracked-queries`);
  record(checks, "protected-route", protectedRoute.response.status === 401, `HTTP ${protectedRoute.response.status}`);

  const queryText = "EV registrations in Maharashtra in Jan 2024";
  const query = await fetchJson(`${baseUrl}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: queryText }),
  });
  record(checks, "deterministic-dashboard-query", query.response.ok && Number.isFinite(query.body.summary?.total), `HTTP ${query.response.status}; total present=${Number.isFinite(query.body.summary?.total)}`);
  record(checks, "no-live-query-refresh", query.body.liveRefresh == null, `liveRefresh=${query.body.liveRefresh == null ? "null" : "present"}`);
  checks.push(check("api-reference-total", "passed", "Reference total recorded in memory for dashboard/API reconciliation.", { total: query.body.summary?.total ?? null }));

  const invalid = await fetchJson(`${baseUrl}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "" }),
  });
  record(checks, "invalid-query-fails-closed", invalid.response.status >= 400 && invalid.response.status < 500, `HTTP ${invalid.response.status}`);
  checks.push(check("authenticated-csrf-rejection", "skipped", "No disposable authenticated session fixture exists; production-smoke and security unit checks cover the server-side CSRF contract."));
  checks.push(check("report-csv-database-consistency", "skipped", "No disposable report database fixture exists; database-backed browser checks are intentionally excluded because they load .env and can observe live data."));
}

async function pageChecks({ browser, baseUrl, runDirectory, checks }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: false, serviceWorkers: "block" });
  await blockExternalRequests(context, baseUrl);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
  await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });

  await page.locator("#submitBtn").click();
  await page.locator("#warnings").waitFor({ state: "visible" });
  record(checks, "empty-query-ui-error", /enter a query/i.test(await page.locator("#warnings").innerText()), "Empty submission warning visible");

  await page.locator("#queryInput").fill("EV registrations in Maharashtra in Jan 2024");
  await page.locator("#submitBtn").click();
  await page.waitForFunction(() => {
    const heading = document.querySelector("#answerHeading")?.textContent ?? "";
    return !/loading/i.test(heading) && /EV registrations/i.test(heading);
  }, null, { timeout: 30_000 });
  const reference = checks.find((item) => item.id === "api-reference-total")?.details?.total;
  await page.waitForFunction((expected) => {
    const text = document.querySelector("#total")?.textContent ?? "";
    return Number(text.replace(/[^0-9.-]/g, "")) === expected;
  }, reference, { timeout: 5_000 });
  const settledTotal = Number((await page.locator("#total").innerText()).replace(/[^0-9.-]/g, ""));
  record(checks, "dashboard-api-total-consistency", settledTotal === reference, `dashboard=${settledTotal}; api=${reference}`);
  record(checks, "desktop-console", consoleErrors.length === 0, `${consoleErrors.length} console error(s)`);
  await page.screenshot({ path: path.join(runDirectory, "screenshots", "dashboard-desktop.png"), fullPage: true });

  await page.route("**/api/rto-reports/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/rto-reports/readiness") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ eligible: false, reason: "no_frozen_cohort", expectedRtos: 100, cohortSize: 0, completeRtos: 0, missingRtos: [], run: null }) });
    } else if (url.pathname === "/api/rto-reports/batches") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ batches: [] }) });
    } else {
      await route.abort("blockedbyclient");
    }
  });
  await page.goto(`${baseUrl}/rto-reports.html`, { waitUntil: "networkidle" });
  record(checks, "rto-report-shell", await page.getByRole("heading", { name: "RTO reports", exact: true }).isVisible(), "RTO reports heading visible");
  record(checks, "rto-report-empty-fixture", await page.getByRole("heading", { name: "No reports generated yet" }).isVisible(), "Controlled empty-report fixture rendered");
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: false, serviceWorkers: "block" });
  await blockExternalRequests(mobile, baseUrl);
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
  const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  record(checks, "mobile-horizontal-overflow", overflow <= 1, `overflow=${overflow}px`);
  await mobilePage.screenshot({ path: path.join(runDirectory, "screenshots", "dashboard-mobile.png"), fullPage: true });
  await mobile.close();
}

async function blockExternalRequests(context, baseUrl) {
  const allowedOrigin = new URL(baseUrl).origin;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === allowedOrigin || url.protocol === "data:") {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
  await context.routeWebSocket(/.*/, async (webSocket) => {
    const url = new URL(webSocket.url());
    if (url.origin === allowedOrigin) {
      webSocket.connectToServer();
    } else {
      await webSocket.close({ code: 1008, reason: "Blocked by the audit harness." });
    }
  });
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Controlled server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`Health returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error("Controlled server health check timed out.");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function record(checks, id, condition, message) {
  checks.push(check(id, condition ? "passed" : "failed", message));
}

function check(id, status, message, details = null) {
  return { id, status, message, details };
}
