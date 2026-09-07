import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const GOVERNMENT_VAHAN_URL = "https://analytics.parivahan.gov.in/analytics/publicdashboard/vahan?lang=en";
export const DEFAULT_OUTPUT_ROOT = path.join("output", "playwright", "final-check");

const APP_TIMEOUT_MS = 30_000;
const VAHAN_TIMEOUT_MS = 45_000;
const CONTROL_TIMEOUT_MS = 20_000;
const REFRESH_TIMEOUT_MS = 300_000;
const WINDOWS_RESERVED_NAMES = new Set(["con", "prn", "aux", "nul", ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`), ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)]);
const BLOCKED_GOVERNMENT_PATTERN = /captcha|sign in|login|unauthori[sz]ed|access denied|403\s+forbidden|just a moment/i;
const MONTH_NAMES = new Map([["JAN", 1], ["JANUARY", 1], ["FEB", 2], ["FEBRUARY", 2], ["MAR", 3], ["MARCH", 3], ["APR", 4], ["APRIL", 4], ["MAY", 5], ["JUN", 6], ["JUNE", 6], ["JUL", 7], ["JULY", 7], ["AUG", 8], ["AUGUST", 8], ["SEP", 9], ["SEPT", 9], ["SEPTEMBER", 9], ["OCT", 10], ["OCTOBER", 10], ["NOV", 11], ["NOVEMBER", 11], ["DEC", 12], ["DECEMBER", 12]]);
const PUBLIC_FUEL_ALIASES = new Map([["ELECTRIC", "ELECTRIC(BOV)"], ["ELECTRIC BOV", "ELECTRIC(BOV)"]]);
const PUBLIC_GROUP_ALIASES = new Map([["2W", "Two Wheeler"], ["TWO WHEELER", "Two Wheeler"], ["3W", "Three Wheeler"], ["THREE WHEELER", "Three Wheeler"], ["4W", "Four Wheeler"], ["FOUR WHEELER", "Four Wheeler"]]);

function text(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function lookup(value) { return text(value).toLowerCase(); }
function filterLabel(value) { return text(value).toUpperCase(); }
function list(values) { return Array.isArray(values) ? values : values === null || values === undefined ? [] : [values]; }
function uniqueLabels(values) { return [...new Set(list(values).map(text).filter((value) => value && !/^all$/i.test(value)))]; }
function valuesFor(filters, selectedKey, fallbackKey) { const selected = uniqueLabels(filters?.[selectedKey]); return selected.length ? selected : uniqueLabels(filters?.[fallbackKey]); }
function optionalLabel(value) { const label = text(value); return label && !/^(?:all|all loaded rtos|all rtos|all vahan4 running office)$/i.test(label) ? label : null; }
function numberFromText(value) { const cleaned = String(value ?? "").replace(/[^\d.-]/g, ""); const number = Number(cleaned); return cleaned && Number.isFinite(number) ? number : null; }
function publicStateLabel(state) { return state === "Jammu and Kashmir" ? "Jammu & Kashmir" : state; }

function parseMonthKey(value, name) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error(`${name} must be an exact YYYY-MM month from Vahan EY.`);
  const year = Number(match[1]); const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) throw new Error(`${name} is not a valid calendar month.`);
  return { year, month, key: `${year}-${String(month).padStart(2, "0")}` };
}

function monthRange(from, to) {
  const values = [];
  for (let year = from.year, month = from.month; year < to.year || (year === to.year && month <= to.month);) {
    values.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return values;
}

function compactTimestamp(date = new Date()) { return date.toISOString().replace(/[-:.]/g, ""); }

export function safeQuerySlug(query) {
  let slug = String(query ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!slug) slug = "query";
  return WINDOWS_RESERVED_NAMES.has(slug) ? `query-${slug}` : slug;
}

export function validateDeployedUrl(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); } catch { throw new Error("--deployed-url must be a valid HTTPS deployment URL."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") throw new Error("--deployed-url must use HTTPS.");
  if (url.username || url.password) throw new Error("--deployed-url must not contain credentials.");
  if (url.search || url.hash) throw new Error("--deployed-url must not contain a query string or hash.");
  if (url.pathname !== "/") throw new Error("--deployed-url must be the deployment origin, without a path.");
  if (["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(host)) throw new Error("--deployed-url must be a deployed origin, not a loopback URL.");
  if (host.endsWith(".invalid") || host === "example.com" || host.endsWith(".example.com")) throw new Error("--deployed-url must be a real deployment origin, not an example URL.");
  return url.origin;
}

export function parseComparisonArgs(argv) {
  const args = { deployedUrl: "", query: "", headed: true, keepOpen: false, allowLiveRefresh: false, channel: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--headless") args.headed = false;
    else if (token === "--headed") args.headed = true;
    else if (token === "--keep-open") args.keepOpen = true;
    else if (token === "--allow-live-refresh") args.allowLiveRefresh = true;
    else if (["--deployed-url", "--app-url", "--query", "--channel"].includes(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${token}.`);
      index += 1;
      if (token === "--deployed-url" || token === "--app-url") args.deployedUrl = value;
      else if (token === "--query") args.query = value;
      else args.channel = value;
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (args.help) return args;
  args.deployedUrl = validateDeployedUrl(args.deployedUrl);
  args.query = text(args.query);
  if (!args.query) throw new Error("Pass one Vahan EY query with --query.");
  if (args.query.length > 500) throw new Error("--query must be 500 characters or fewer.");
  args.channel = text(args.channel);
  return args;
}

export function comparisonPlan(filters = {}) {
  const reasons = [];
  let from; let to;
  try { from = parseMonthKey(filters.from, "The Vahan EY from filter"); to = parseMonthKey(filters.to, "The Vahan EY to filter"); } catch (error) { reasons.push(error.message); }
  if (from && to && (to.year < from.year || (to.year === from.year && to.month < from.month))) reasons.push("The Vahan EY date range is reversed.");
  const excludedValues = ["excludedFuelTypes", "excludedVehicleGroups", "excludedVehicleClasses", "excludedVehicleCategories", "excludedNorms"].flatMap((key) => uniqueLabels(filters[key]));
  if (excludedValues.length) reasons.push("Excluded filters cannot be mapped safely to a Public Dashboard selection.");
  const fuels = valuesFor(filters, "selectedFuelTypes", "fuelFilters");
  const vehicleCategories = valuesFor(filters, "selectedVehicleCategories", "vehicleCategories");
  const norms = valuesFor(filters, "selectedNorms", "norms");
  const vehicleClasses = valuesFor(filters, "selectedVehicleClasses", "vehicleClasses");
  const vehicleGroups = uniqueLabels([...list(filters.selectedVehicleGroups), ...list(filters.vehicleGroups)]);
  if (vehicleGroups.length && (vehicleCategories.length || vehicleClasses.length)) reasons.push("Vehicle-group filters cannot be combined with class or sub-category filters for an exact Public Dashboard comparison.");
  if (text(filters.fuelSegment) && !/^all$/i.test(text(filters.fuelSegment)) && !fuels.length) reasons.push("The fuel segment has no exact Public Dashboard fuel labels to apply.");
  const state = optionalLabel(filters.state);
  if (!state) reasons.push("The query must resolve to one state or India total.");
  return {
    comparable: reasons.length === 0, reasons,
    state: /^india total$/i.test(state ?? "") ? null : publicStateLabel(state), stateLabel: state ?? null, rto: optionalLabel(filters.rto),
    from: from?.key ?? null, to: to?.key ?? null, yearRange: from && to ? { from: from.year, to: to.year } : null,
    months: from && to && !reasons.some((reason) => /date range/i.test(reason)) ? monthRange(from, to) : [],
    fuels: fuels.map((value) => PUBLIC_FUEL_ALIASES.get(filterLabel(value)) ?? filterLabel(value)),
    vehicleCategories: vehicleCategories.map(filterLabel), norms: norms.map(filterLabel), vehicleClasses: vehicleClasses.map(filterLabel),
    vehicleGroups: vehicleGroups.map((value) => PUBLIC_GROUP_ALIASES.get(filterLabel(value)) ?? text(value)),
  };
}

export function validateAppHealth(health, { allowLiveRefresh = false } = {}) {
  if (!health || health.status !== "ok") return { accepted: false, reason: "The deployment health endpoint did not return status=ok." };
  if (health.liveRefreshDisabled !== true && !allowLiveRefresh) return { accepted: false, reason: "The deployment permits live VAHAN refreshes; comparison stopped before submitting a query. Pass --allow-live-refresh only when you intend to trigger a refresh." };
  return { accepted: true, reason: null };
}

export function validateAppQueryPayload(payload, { allowLiveRefresh = false } = {}) {
  if (!payload || typeof payload !== "object") return { accepted: false, reason: "The deployed app returned an invalid query payload." };
  if (payload.liveRefresh !== null && payload.liveRefresh !== undefined) {
    if (allowLiveRefresh && payload.liveRefresh.status === "pending") return { accepted: false, refreshPending: true, reason: null };
    return { accepted: false, reason: "The deployed app attempted a live refresh, so the comparison stopped without using a partial result." };
  }
  if (payload.dataStatus !== "complete") return { accepted: false, reason: `The deployed app returned data status ${JSON.stringify(payload.dataStatus ?? "unknown")}; only complete saved-data results are comparable.` };
  const total = payload.summary?.total;
  if (!payload.filters || !payload.summary || total === null || total === undefined || text(total) === "" || !Number.isFinite(Number(total))) return { accepted: false, reason: "The deployed app result lacks canonical filters or a numeric total." };
  return { accepted: true, reason: null };
}

export function governmentPageBlockReason({ status = null, bodyText = "" } = {}) {
  return status === 403 || BLOCKED_GOVERNMENT_PATTERN.test(bodyText) ? "The official Parivahan Public Dashboard requires CAPTCHA, login, or access approval from this browser session." : null;
}

function publicMonthKey(value) { const match = String(value ?? "").match(/(\d{4})[-\s]+([A-Za-z]+)/); const month = MONTH_NAMES.get(text(match?.[2]).toUpperCase()); return match && month ? `${match[1]}-${String(month).padStart(2, "0")}` : null; }
export function publicReportRowsFromResponse(response) {
  if (!Array.isArray(response)) throw new Error("Public Dashboard returned an invalid monthly response.");
  const counts = {};
  for (const row of response) { const month = publicMonthKey(row?.yearAsString); const count = numberFromText(row?.registeredVehicleCount); if (month && count !== null) counts[month] = count; }
  if (!Object.keys(counts).length) throw new Error("Public Dashboard returned no monthly registration values.");
  return [{ label: "TOTAL", counts }];
}
export function governmentTotalForMonths(rows, months) { return (rows ?? []).reduce((sum, row) => sum + (months ?? []).reduce((rowTotal, month) => rowTotal + Number(row.counts?.[month] ?? 0), 0), 0); }
export function classifyComparison(appTotal, governmentTotal) {
  if (governmentTotal === null || governmentTotal === undefined) return { status: "unavailable", appTotal, governmentTotal: null, difference: null, absoluteDifference: null, relativeDifference: null };
  const difference = Number(governmentTotal) - Number(appTotal); const absoluteDifference = Math.abs(difference); const relativeDifference = Number(appTotal) === 0 ? (absoluteDifference === 0 ? 0 : null) : absoluteDifference / Math.abs(Number(appTotal));
  const withinTolerance = absoluteDifference <= 100 && relativeDifference !== null && relativeDifference <= 0.001;
  return { status: difference === 0 ? "match" : withinTolerance ? "within_tolerance" : "mismatch", appTotal: Number(appTotal), governmentTotal: Number(governmentTotal), difference, absoluteDifference, relativeDifference };
}

async function fetchJson(url, timeoutMs = APP_TIMEOUT_MS) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal }); return { response, body: await response.json().catch(() => null) }; } finally { clearTimeout(timer); }
}
async function preflightDeployment(deployedUrl, args) { const { response, body } = await fetchJson(new URL("/health", deployedUrl)); if (!response.ok) throw new Error(`Deployment health check failed with HTTP ${response.status}.`); const validation = validateAppHealth(body, args); if (!validation.accepted) throw new Error(validation.reason); return body; }

async function assertNoLinksBetween(root, target) {
  const resolvedRoot = path.resolve(root); const relative = path.relative(resolvedRoot, path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Artifact path escapes the project output root.");
  let cursor = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) { cursor = path.join(cursor, segment); const stat = await fs.lstat(cursor).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error)); if (!stat) return; if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic-link or junction artifact path: ${cursor}`); }
}
export async function createComparisonDirectory({ repoRoot = process.cwd(), query, now = new Date() }) {
  const resolvedRepo = path.resolve(repoRoot); const outputRoot = path.resolve(resolvedRepo, DEFAULT_OUTPUT_ROOT);
  if (path.relative(resolvedRepo, outputRoot).startsWith("..")) throw new Error("Comparison artifacts must stay in the project output directory.");
  await assertNoLinksBetween(resolvedRepo, path.join(resolvedRepo, "output")); await fs.mkdir(outputRoot, { recursive: true }); await assertNoLinksBetween(resolvedRepo, outputRoot);
  const slug = safeQuerySlug(query);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${compactTimestamp(now)}${attempt === 1 ? "" : `-${attempt}`}`; const directory = path.join(outputRoot, `${slug}${suffix}`);
    await assertNoLinksBetween(outputRoot, directory);
    try { await fs.mkdir(directory); await assertNoLinksBetween(outputRoot, directory); return { directory, outputRoot, slug: `${slug}${suffix}` }; } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  throw new Error("Could not create a unique evidence folder after 100 attempts.");
}
async function writeJsonExclusive(directory, name, value) { const destination = path.join(directory, name); const handle = await fs.open(destination, "wx"); try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); } finally { await handle.close(); } return destination; }
async function screenshotIfMissing(page, destination) { if (!page) return false; if (await fs.access(destination).then(() => true).catch(() => false)) return true; await page.screenshot({ path: destination, fullPage: true }).catch(() => {}); return fs.access(destination).then(() => true).catch(() => false); }

function exactOption(options, wanted, description) { const desired = lookup(wanted); const exact = options.find((option) => lookup(option.label) === desired); if (exact) return exact; const partials = options.filter((option) => lookup(option.label).includes(desired) || desired.includes(lookup(option.label))); if (partials.length === 1) return partials[0]; throw new Error(`Could not map ${JSON.stringify(wanted)} to the Public Dashboard ${description} control.`); }
async function optionFor(page, selector, wanted, description) { const options = await page.locator(selector).evaluate((select) => [...select.options].map((option) => ({ label: option.textContent.replace(/\s+/g, " ").trim(), value: option.value }))); return exactOption(options, wanted, description); }
async function selectPublicOption(page, selector, wanted, description) { const option = await optionFor(page, selector, wanted, description); await page.locator(selector).selectOption(option.value, { timeout: CONTROL_TIMEOUT_MS }); return option; }
async function selectPublicOptions(page, selector, wanted, description) { if (!wanted.length) return []; const options = await Promise.all(wanted.map((label) => optionFor(page, selector, label, description))); await page.locator(selector).selectOption(options.map((option) => option.value), { timeout: CONTROL_TIMEOUT_MS }); await page.locator(selector).evaluate((select) => { select.dispatchEvent(new Event("change", { bubbles: true })); select.loadOptions?.(); }); return options; }
async function setPublicYear(page, selector, value) { await page.locator(selector).evaluate((input, nextValue) => { input.value = nextValue; input.dispatchEvent(new Event("change", { bubbles: true })); }, value); }
async function assertSelectedLabels(page, selector, expected, description) { const actual = await page.locator(selector).evaluate((select) => [...select.selectedOptions].map((option) => option.textContent.replace(/\s+/g, " ").trim())); for (const label of expected) if (!actual.some((value) => lookup(value) === lookup(label))) throw new Error(`Public Dashboard did not keep ${description} ${JSON.stringify(label)} selected.`); }
async function waitForRtoOptions(page) { await page.waitForFunction(() => document.querySelector("#rtoCode")?.options.length > 1, undefined, { timeout: CONTROL_TIMEOUT_MS }); }

async function openGovernmentPage(page, governmentUrl = GOVERNMENT_VAHAN_URL) {
  const response = await page.goto(governmentUrl, { waitUntil: "domcontentloaded", timeout: VAHAN_TIMEOUT_MS });
  await page.locator("#applyButton").waitFor({ state: "visible", timeout: VAHAN_TIMEOUT_MS });
  const blockReason = governmentPageBlockReason({ status: response?.status() ?? null, bodyText: await page.locator("body").innerText().catch(() => "") }); if (blockReason) throw new Error(blockReason);
  await page.waitForLoadState("networkidle", { timeout: VAHAN_TIMEOUT_MS }).catch(() => {});
}

async function configureGovernmentPage(page, plan) {
  await page.locator("#calendarYear").check({ force: true }); await setPublicYear(page, "#fromYear", String(plan.yearRange.from)); await setPublicYear(page, "#toYear", String(plan.yearRange.to));
  if (plan.state) { const rtoResponse = page.waitForResponse((entry) => new URL(entry.url()).pathname.endsWith("/analytics/json_rtos"), { timeout: CONTROL_TIMEOUT_MS }).catch(() => null); await selectPublicOption(page, "#stateCode", plan.state, "state"); await rtoResponse; if (plan.rto) { await waitForRtoOptions(page); await selectPublicOption(page, "#rtoCode", plan.rto, "RTO"); } }
  await selectPublicOptions(page, "#vehicleFuel", plan.fuels, "fuel"); await selectPublicOptions(page, "#vehicleSubCategory", plan.vehicleCategories, "sub-category"); await selectPublicOptions(page, "#vehicleClass", plan.vehicleClasses, "class"); await selectPublicOptions(page, "#vehicleEmission", plan.norms, "emission"); await selectPublicOptions(page, "#vehicleCategoryGroup", plan.vehicleGroups, "category group");
  if (plan.state && !(await page.locator("#stateCode").inputValue())) throw new Error("Public Dashboard did not keep the requested state selected.");
  await assertSelectedLabels(page, "#vehicleFuel", plan.fuels, "fuel"); await assertSelectedLabels(page, "#vehicleSubCategory", plan.vehicleCategories, "sub-category"); await assertSelectedLabels(page, "#vehicleClass", plan.vehicleClasses, "class"); await assertSelectedLabels(page, "#vehicleEmission", plan.norms, "emission"); await assertSelectedLabels(page, "#vehicleCategoryGroup", plan.vehicleGroups, "category group");
  const monthlyResponse = page.waitForResponse((entry) => { const url = new URL(entry.url()); return entry.request().method() === "GET" && url.pathname.endsWith("/analytics/publicdashboard/vahandashboard/durationWiseRegistrationTable"); }, { timeout: VAHAN_TIMEOUT_MS });
  await page.locator("#applyButton").click({ timeout: CONTROL_TIMEOUT_MS }); const monthly = await monthlyResponse;
  if (!monthly.ok()) throw new Error(`Public Dashboard monthly table returned HTTP ${monthly.status()}.`);
  const body = await monthly.json().catch(() => null); await page.waitForTimeout(750); return publicReportRowsFromResponse(body);
}

async function waitForAppRender(page, payload) { await page.locator("#filters dt").first().waitFor({ timeout: APP_TIMEOUT_MS }); await page.waitForFunction((expectedTotal) => { const label = document.querySelector("#sourceStatusPill")?.textContent?.trim().toLowerCase(); const total = Number(document.querySelector("#total")?.textContent?.replace(/[^\d.-]/g, "")); return label === "complete" && total === Number(expectedTotal); }, Number(payload.summary.total), { timeout: APP_TIMEOUT_MS }); const detail = page.getByRole("button", { name: "Detail", exact: true }); if (await detail.count()) await detail.click().catch(() => {}); }
async function submitAppQuery(page, args) { await page.locator("#queryInput").fill(args.query); const applicationOrigin = new URL(page.url()).origin; const responsePromise = page.waitForResponse((response) => { const url = new URL(response.url()); return url.origin === applicationOrigin && url.pathname === "/api/query" && response.request().method() === "POST"; }, { timeout: APP_TIMEOUT_MS }); await page.locator("#queryForm").evaluate((form) => form.requestSubmit()); const response = await responsePromise; if (!response.ok()) throw new Error(`The deployed Vahan EY query failed with HTTP ${response.status()}.`); return response.json(); }
async function waitForLiveRefresh(deployedUrl, payload) { const jobId = payload.liveRefresh?.jobId; if (!jobId) throw new Error("The deployed app started a refresh without a refresh job id."); const deadline = Date.now() + REFRESH_TIMEOUT_MS; while (Date.now() < deadline) { const { response, body } = await fetchJson(new URL(`/api/query-refresh/${encodeURIComponent(jobId)}`, deployedUrl)); if (!response.ok) throw new Error(`Refresh job ${jobId} check failed with HTTP ${response.status}.`); if (body?.liveRefresh?.status === "pending") { await new Promise((resolve) => setTimeout(resolve, 1000)); continue; } if (body?.liveRefresh?.status === "failed") throw new Error(body.liveRefresh.error || `Refresh job ${jobId} failed.`); return body; } throw new Error(`Refresh job ${jobId} did not finish within five minutes.`); }
async function runAppQuery(page, args, { onInitialPayload = null } = {}) {
  await page.goto(args.deployedUrl, { waitUntil: "domcontentloaded", timeout: APP_TIMEOUT_MS });
  await page.locator("#queryInput").waitFor({ state: "visible", timeout: APP_TIMEOUT_MS });
  let payload = await submitAppQuery(page, args);
  if (onInitialPayload) await onInitialPayload(payload);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const validation = validateAppQueryPayload(payload, args);
    if (validation.accepted) {
      await waitForAppRender(page, payload);
      return payload;
    }
    if (!validation.refreshPending) throw new Error(validation.reason || "The deployed app returned an unusable refresh response.");
    await waitForLiveRefresh(args.deployedUrl, payload);
    payload = await submitAppQuery(page, args);
  }
  throw new Error("The deployed refresh remained pending after three completed wait cycles; no comparison was made from partial data.");
}

function browserOptions(args) { return { headless: !args.headed, channel: args.channel || undefined, slowMo: args.headed ? 50 : 0 }; }
async function pageForBrowser(browser) { const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" }); return context.newPage(); }
function comparisonSummary({ args, health, payload, plan, government, outcome, error = null, artifacts, governmentUrl = GOVERNMENT_VAHAN_URL }) { return { schemaVersion: 2, generatedAt: new Date().toISOString(), outcome, query: args.query, deployedUrl: args.deployedUrl, governmentUrl, deploymentHealth: health ?? null, vahanEy: payload ? { dataStatus: payload.dataStatus, total: Number(payload.summary?.total ?? 0), filters: payload.filters } : null, government: government ?? null, plan: plan ?? null, error: error ? text(error.message ?? error) : null, artifacts }; }
async function waitForManualClose() { if (!process.stdin.isTTY) return; console.log("Both browser windows remain open. Press Enter here when you are finished reviewing them."); await new Promise((resolve) => process.stdin.once("data", resolve)); }

export async function runFinalComparison(args, { repoRoot = process.cwd(), governmentUrl = GOVERNMENT_VAHAN_URL, launchBrowser = (options) => chromium.launch(options) } = {}) {
  const health = await preflightDeployment(args.deployedUrl, args); const artifact = await createComparisonDirectory({ repoRoot, query: args.query });
  const artifacts = { directory: artifact.directory, vahanEy: path.join(artifact.directory, "vahan-ey.png"), government: path.join(artifact.directory, "vahan-public-dashboard.png"), summary: path.join(artifact.directory, "comparison.json") };
  let appBrowser; let governmentBrowser; let appPage; let governmentPage; let payload = null; let plan = null; let governmentRowsPromise = null; let summaryWritten = false;
  try {
    appBrowser = await launchBrowser(browserOptions(args)); governmentBrowser = await launchBrowser(browserOptions(args)); [appPage, governmentPage] = await Promise.all([pageForBrowser(appBrowser), pageForBrowser(governmentBrowser)]);
    const governmentReady = openGovernmentPage(governmentPage, governmentUrl).then(() => null, (error) => error);
    payload = await runAppQuery(appPage, args, {
      onInitialPayload: async (initialPayload) => {
        plan = comparisonPlan(initialPayload?.filters);
        if (!plan.comparable) return;
        governmentRowsPromise = (async () => {
          const governmentOpenError = await governmentReady;
          if (governmentOpenError) throw governmentOpenError;
          const rows = await configureGovernmentPage(governmentPage, plan);
          if (!(await screenshotIfMissing(governmentPage, artifacts.government))) throw new Error("Could not save the official Public Dashboard evidence screenshot.");
          return rows;
        })();
        await governmentRowsPromise;
      },
    });
    if (!(await screenshotIfMissing(appPage, artifacts.vahanEy))) throw new Error("Could not save the Vahan EY evidence screenshot.");
    plan ??= comparisonPlan(payload.filters);
    if (!plan.comparable) { const summary = comparisonSummary({ args, health, payload, plan, government: null, outcome: "not_comparable", error: plan.reasons.join(" "), artifacts, governmentUrl }); await writeJsonExclusive(artifact.directory, "comparison.json", summary); summaryWritten = true; return summary; }
    const rows = governmentRowsPromise
      ? await governmentRowsPromise
      : await (async () => {
          const governmentOpenError = await governmentReady;
          if (governmentOpenError) throw governmentOpenError;
          const result = await configureGovernmentPage(governmentPage, plan);
          if (!(await screenshotIfMissing(governmentPage, artifacts.government))) throw new Error("Could not save the official Public Dashboard evidence screenshot.");
          return result;
        })();
    const appTotal = Number(payload.summary.total); const governmentTotal = governmentTotalForMonths(rows, plan.months); const government = { status: "captured", selectedFilters: plan, rowsRead: rows.length, total: governmentTotal, numericReason: null, comparison: classifyComparison(appTotal, governmentTotal) };
    const summary = comparisonSummary({ args, health, payload, plan, government, outcome: "captured", artifacts, governmentUrl }); await writeJsonExclusive(artifact.directory, "comparison.json", summary); summaryWritten = true; return summary;
  } catch (error) {
    await screenshotIfMissing(appPage, artifacts.vahanEy); await screenshotIfMissing(governmentPage, artifacts.government);
    if (!summaryWritten) { const summary = comparisonSummary({ args, health, payload, plan, government: null, outcome: "blocked", error, artifacts, governmentUrl }); await writeJsonExclusive(artifact.directory, "comparison.json", summary).catch(() => {}); }
    throw error;
  } finally { if (args.keepOpen && summaryWritten) await waitForManualClose(); await Promise.all([appBrowser?.close(), governmentBrowser?.close()].filter(Boolean)); }
}

export function helpText() { return `Final Vahan EY versus Parivahan Public Dashboard comparison\n\nUsage:\n  npm.cmd run compare:vahan:final -- --deployed-url https://your-deployment.example --query "Show registrations in Maharashtra for January 2025"\n\nOptions:\n  --deployed-url URL    Required deployed Vahan EY HTTPS origin (alias: --app-url)\n  --query TEXT          Required Vahan EY query\n  --headed              Show two browser windows (default)\n  --headless            Run without visible browser windows\n  --channel NAME        Optional Playwright channel, e.g. msedge or chrome\n  --keep-open           Keep both windows open after capture until Enter is pressed\n  --allow-live-refresh  Explicitly allow an uncached query to start and await a Render refresh\n\nArtifacts:\n  output/playwright/final-check/<safe-query-slug>/vahan-ey.png\n  output/playwright/final-check/<safe-query-slug>/vahan-public-dashboard.png\n  output/playwright/final-check/<safe-query-slug>/comparison.json\n\nSafety: by default the command stops before submitting a query unless /health reports liveRefreshDisabled=true.`; }
async function main() { const args = parseComparisonArgs(process.argv.slice(2)); if (args.help) { console.log(helpText()); return; } const summary = await runFinalComparison(args); console.log(JSON.stringify({ outcome: summary.outcome, comparison: summary.government?.comparison ?? null, artifacts: summary.artifacts }, null, 2)); if (summary.outcome !== "captured") process.exitCode = 2; }
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) main().catch((error) => { console.error(`Final comparison failed: ${error.message}`); process.exitCode = 1; });
