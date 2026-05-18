import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { closePool } from "../lib/db.mjs";
import { upsertRegistrationRows } from "../lib/registrations.mjs";

const SOURCE_URL =
  "https://vahan.parivahan.gov.in/vahan4dashboard/vahan/view/reportview.xhtml";

const DEFAULT_OUTPUT_DIR = "data/vahan";
const DEFAULT_DELAY_MS = 1200;
const DEFAULT_TIMEOUT_MS = 45_000;
const CONTROL_TIMEOUT_MS = 20_000;
const MAX_SCRAPE_ATTEMPTS = 3;

const STATE_NAMES = [
  "Andaman & Nicobar Island",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu & Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "UT of DNH and DD",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

const FUEL_NAMES = [
  "CNG ONLY",
  "DIESEL",
  "DIESEL/HYBRID",
  "DUAL DIESEL/BIO CNG",
  "DUAL DIESEL/CNG",
  "DUAL DIESEL/LNG",
  "ELECTRIC",
  "ETHANOL",
  "FUEL CELL HYDROGEN",
  "LNG",
  "LPG ONLY",
  "METHANOL",
  "NOT APPLICABLE",
  "PETROL",
  "PETROL/CNG",
  "PETROL/ETHANOL",
  "PETROL/HYBRID",
  "PETROL/LPG",
  "PLUG-IN HYBRID EV",
  "PURE EV",
  "SOLAR",
  "STRONG HYBRID EV",
];

const MONTH_LABELS = new Map([
  ["JAN", 1],
  ["JANUARY", 1],
  ["FEB", 2],
  ["FEBRUARY", 2],
  ["MAR", 3],
  ["MARCH", 3],
  ["APR", 4],
  ["APRIL", 4],
  ["MAY", 5],
  ["JUN", 6],
  ["JUNE", 6],
  ["JUL", 7],
  ["JULY", 7],
  ["AUG", 8],
  ["AUGUST", 8],
  ["SEP", 9],
  ["SEPT", 9],
  ["SEPTEMBER", 9],
  ["OCT", 10],
  ["OCTOBER", 10],
  ["NOV", 11],
  ["NOVEMBER", 11],
  ["DEC", 12],
  ["DECEMBER", 12],
]);

const FUEL_ALIASES = new Map([
  ["ELECTRIC", "ELECTRIC(BOV)"],
  ["PURE EV", "ELECTRIC(BOV)"],
]);

const FILTER_CONTEXT_KEYS = [
  "fuel_filter",
  "vehicle_category_filter",
  "norms_filter",
  "vehicle_class_filter",
];

function parseArgs(argv) {
  const args = {
    mode: "scrape",
    outputDir: DEFAULT_OUTPUT_DIR,
    delayMs: DEFAULT_DELAY_MS,
    headed: false,
    resume: true,
    persist: true,
    emitRowsJson: false,
    dryRun: false,
    limit: null,
    states: [],
    years: [],
    months: [],
    fuels: [],
    vehicleCategories: [],
    norms: [],
    vehicleClasses: [],
    rtos: [],
    channel: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--headed") {
      args.headed = true;
    } else if (token === "--no-resume") {
      args.resume = false;
    } else if (token === "--no-persist") {
      args.persist = false;
    } else if (token === "--emit-rows-json") {
      args.emitRowsJson = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[index + 1];
      index += 1;

      if (value === undefined) {
        throw new Error(`Missing value for ${token}`);
      }

      if (key === "mode") args.mode = value;
      else if (key === "output-dir") args.outputDir = value;
      else if (key === "delay-ms") args.delayMs = Number(value);
      else if (key === "limit") args.limit = Number(value);
      else if (key === "states") args.states = splitList(value);
      else if (key === "years") args.years = expandNumbers(value);
      else if (key === "months") args.months = expandNumbers(value);
      else if (key === "fuels") args.fuels = splitList(value);
      else if (key === "vehicle-categories") args.vehicleCategories = splitList(value);
      else if (key === "norms") args.norms = splitList(value);
      else if (key === "vehicle-classes") args.vehicleClasses = splitList(value);
      else if (key === "rtos") args.rtos = splitList(value);
      else if (key === "channel") args.channel = value;
      else throw new Error(`Unknown argument: ${token}`);
    }
  }

  validateArgs(args);
  return args;
}

function validateArgs(args) {
  if (!["discover", "scrape"].includes(args.mode)) {
    throw new Error(`Unsupported mode: ${args.mode}`);
  }
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    throw new Error("--delay-ms must be a non-negative number");
  }
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  for (const month of args.months) {
    if (month < 1 || month > 12) throw new Error(`Invalid month: ${month}`);
  }
  for (const year of args.years) {
    if (year < 2000 || year > 2100) throw new Error(`Invalid year: ${year}`);
  }
}

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function expandNumbers(value) {
  const numbers = [];

  for (const part of splitList(value)) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((item) => Number(item.trim()));
      if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
        throw new Error(`Invalid range: ${part}`);
      }
      for (let current = start; current <= end; current += 1) {
        numbers.push(current);
      }
    } else {
      const number = Number(part);
      if (!Number.isInteger(number)) throw new Error(`Invalid number: ${part}`);
      numbers.push(number);
    }
  }

  return [...new Set(numbers)];
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function toCsv(rows) {
  const headers = [
    "year",
    "month",
    "state",
    "rto",
    "fuel_segment",
    "fuel_type",
    ...FILTER_CONTEXT_KEYS,
    "vehicle_count",
    "scraped_at",
    "source_url",
  ];
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function normalizeCount(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampStamp(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "_",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
}

function slugify(value) {
  return (
    normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "unknown"
  );
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeFileWithRetry(filePath, content, options) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await fs.writeFile(filePath, content, options);
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error.code) || attempt === 5) throw error;
      await sleep(250 * attempt);
    }
  }
}

async function appendFileWithRetry(filePath, content, options) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await fs.appendFile(filePath, content, options);
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error.code) || attempt === 5) throw error;
      await sleep(250 * attempt);
    }
  }
}

async function launchBrowser({ headed, channel }) {
  return chromium.launch({
    channel: channel || undefined,
    headless: !headed,
    slowMo: headed ? 75 : 0,
  });
}

async function openDashboard(page) {
  const response = await page.goto(SOURCE_URL, {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await page.waitForLoadState("networkidle", { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});

  const status = response?.status();
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");

  if (status === 403 || /403\s+Forbidden/i.test(bodyText)) {
    throw new Error(
      "VAHAN dashboard returned 403 Forbidden from this machine. Retry with --headed, or use a network/browser session that can open the dashboard normally.",
    );
  }
  if (/captcha|sign in|login|unauthori[sz]ed|access denied/i.test(bodyText)) {
    throw new Error(
      "VAHAN dashboard appears to require CAPTCHA, login, or private access from this session. Stop and verify manually in a normal browser.",
    );
  }

  return response;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeFuelName(value) {
  const normalized = normalizeText(value).toUpperCase();
  return FUEL_ALIASES.get(normalized) ?? normalized;
}

function normalizeFilterName(value) {
  return normalizeText(value).toUpperCase();
}

function contextValue(values) {
  return values.length ? values.map(normalizeFilterName).sort().join("|") : "ALL";
}

function filterContext(args) {
  return {
    fuel_filter: contextValue(args.fuels.map(normalizeFuelName)),
    vehicle_category_filter: contextValue(args.vehicleCategories),
    norms_filter: contextValue(args.norms),
    vehicle_class_filter: contextValue(args.vehicleClasses),
  };
}

function fuelSegment(value) {
  return /electric|ev|bov/i.test(value) ? "EV" : "NON_EV";
}

async function inspectSelectControls(page) {
  return page.locator("select").evaluateAll((selects) =>
    selects.map((select) => {
      const compact = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
      const name = select.getAttribute("name") ?? "";
      const labelText = select.closest("label")?.textContent ?? "";
      const nearbyText = [
        select.id,
        name,
        select.getAttribute("aria-label"),
        select.getAttribute("placeholder"),
        labelText,
        select.parentElement?.textContent?.slice(0, 300),
        select.previousElementSibling?.textContent,
      ]
        .map(compact)
        .filter(Boolean)
        .join(" ");

      return {
        id: select.id,
        name,
        selector: select.id ? `[id="${select.id}"]` : `select[name="${name.replaceAll('"', '\\"')}"]`,
        nearbyText,
        optionCount: select.options.length,
        options: [...select.options].map((option) => ({
          label: compact(option.textContent),
          value: option.value,
        })),
      };
    }),
  );
}

function scoreSelectControl(control, config) {
  let score = 0;
  const text = normalizeLookup(`${control.id} ${control.name} ${control.nearbyText}`);
  const options = control.options.map((option) => normalizeLookup(option.label));

  if (config.fastIds?.includes(control.id)) score += 100;
  for (const pattern of config.labelPatterns ?? []) {
    if (pattern.test(text)) score += 20;
  }
  for (const value of config.knownOptions ?? []) {
    const wanted = normalizeLookup(value);
    if (options.some((option) => option === wanted)) score += 20;
    else if (options.some((option) => option.includes(wanted))) score += 10;
  }
  for (const pattern of config.optionPatterns ?? []) {
    if (options.some((option) => pattern.test(option))) score += 10;
  }
  if (config.minOptions && control.optionCount >= config.minOptions) score += 2;
  return score;
}

async function findSelectControl(page, config) {
  await page.waitForSelector("select", { state: "attached", timeout: CONTROL_TIMEOUT_MS });
  const controls = await inspectSelectControls(page);
  const ranked = controls
    .map((control) => ({ control, score: scoreSelectControl(control, config) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    throw new Error(`Could not find VAHAN control: ${config.description}`);
  }
  return ranked[0].control;
}

async function selectPrimeOption(page, controlConfig, value) {
  const control =
    typeof controlConfig === "string"
      ? await findSelectControl(page, {
          description: controlConfig,
          fastIds: [controlConfig],
          knownOptions: [value],
        })
      : await findSelectControl(page, controlConfig);
  const desired = normalizeLookup(value);
  await page
    .waitForFunction(
      ({ selector, wanted }) => {
        const select = document.querySelector(selector);
        if (!select) return false;
        return [...select.options].some((option) => {
          const label = (option.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          return label === wanted || label.startsWith(wanted) || label.includes(wanted);
        });
      },
      { selector: control.selector, wanted: desired },
      { timeout: CONTROL_TIMEOUT_MS },
    )
    .catch(() => {});
  const option = await page.locator(control.selector).evaluate(
    (select, wanted) => {
      const options = [...select.options].map((item) => ({
        label: item.textContent.replace(/\s+/g, " ").trim(),
        value: item.value,
      }));
      return (
        options.find((item) => item.label.toLowerCase() === wanted) ??
        options.find((item) => item.label.toLowerCase().startsWith(wanted)) ??
        options.find((item) => item.label.toLowerCase().includes(wanted)) ??
        null
      );
    },
    desired,
  );

  if (!option) {
    throw new Error(
      `Could not find option "${value}" in ${control.id || control.name}. Sample options: ${JSON.stringify(
        control.options.slice(0, 12).map((item) => item.label),
      )}`,
    );
  }

  await page.locator(control.selector).evaluate(
    (select, selectedValue) => {
      select.value = selectedValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    option.value,
  );
  await page.waitForLoadState("networkidle", { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(1500);
  return control;
}

async function setPrimeCheckboxGroup(page, tableId, wantedLabels) {
  const wanted = new Set(wantedLabels.map((label) => normalizeLookup(label)));
  const matches = await page.locator(`table[id="${tableId}"] tr`).evaluateAll(
    (rows, wantedValues) => {
      const wantedSet = new Set(wantedValues);
      return rows.map((row) => {
        const text = row.textContent.replace(/\s+/g, " ").trim();
        const input = row.querySelector("input[type='checkbox']");
        const normalized = text.toLowerCase();
        return {
          id: input?.id ?? "",
          text,
          checked: input?.checked ?? false,
          wanted: wantedSet.has(normalized),
        };
      });
    },
    [...wanted],
  );

  let changed = false;
  for (const match of matches) {
    if (!match.id) continue;
    if (match.checked !== match.wanted) {
      await page.locator(`[id="${match.id}"]`).evaluate((input) => {
        const checkboxRoot = input.closest(".ui-chkbox");
        const visibleBox = checkboxRoot?.querySelector(".ui-chkbox-box");
        visibleBox?.click();
      });
      await page.waitForTimeout(200);
      changed = true;
    }
  }

  const selected = matches.filter((match) => match.wanted);
  if (wantedLabels.length && !selected.length) {
    throw new Error(`Could not find ${tableId} checkbox for ${wantedLabels.join(", ")}`);
  }
  return changed;
}

async function applySideFilters(page) {
  const filterRefresh = page.locator("#filterLayout button").filter({ hasText: /refresh/i }).first();
  if (await filterRefresh.count()) {
    await filterRefresh.evaluate((button) => button.click());
  } else {
    const refreshButtons = page.getByRole("button", { name: "Refresh" });
    if ((await refreshButtons.count()) < 2) return;
    await refreshButtons.nth(1).click();
  }
  await page.waitForLoadState("networkidle", { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function configureReport(page, { state, rto, year }) {
  await openDashboard(page);
  await selectPrimeOption(
    page,
    {
      description: "report type",
      fastIds: ["j_idt32_input"],
      labelPatterns: [/report|type|actual|value/i],
      knownOptions: ["Actual Value"],
    },
    "Actual Value",
  );
  await selectPrimeOption(
    page,
    {
      description: "state",
      fastIds: ["j_idt41_input"],
      labelPatterns: [/state/i],
      knownOptions: [state, "Assam", "Maharashtra", "Delhi"],
      optionPatterns: [/andhra pradesh|assam|maharashtra|uttar pradesh/i],
      minOptions: 10,
    },
    state,
  );
  if (rto) {
    await selectPrimeOption(
      page,
      {
        description: "RTO",
        fastIds: ["selectedRto_input"],
        labelPatterns: [/rto|office|running office/i],
        knownOptions: [rto, "All Vahan4 Running Office"],
        minOptions: 2,
      },
      rto,
    );
  }
  await selectPrimeOption(
    page,
    {
      description: "y-axis",
      fastIds: ["yaxisVar_input"],
      labelPatterns: [/y.?axis/i],
      knownOptions: ["Fuel", "Maker"],
    },
    "Fuel",
  );
  await selectPrimeOption(
    page,
    {
      description: "x-axis",
      fastIds: ["xaxisVar_input"],
      labelPatterns: [/x.?axis/i],
      knownOptions: ["Month Wise", "Month"],
    },
    "Month Wise",
  );
  await selectPrimeOption(
    page,
    {
      description: "year type",
      fastIds: ["selectedYearType_input"],
      labelPatterns: [/year type|calendar|financial/i],
      knownOptions: ["Calendar Year", "Financial Year"],
    },
    "Calendar Year",
  );
  await selectPrimeOption(
    page,
    {
      description: "year",
      fastIds: ["selectedYear_input"],
      labelPatterns: [/year/i],
      knownOptions: [String(year)],
    },
    String(year),
  );
}

async function applyReportSideFilters(page, { fuels, vehicleCategories, norms, vehicleClasses }) {
  const sideFiltersChanged = [
    fuels.length ? await setPrimeCheckboxGroup(page, "fuel", fuels.map(normalizeFuelName)) : false,
    vehicleCategories.length
      ? await setPrimeCheckboxGroup(page, "VhCatg", vehicleCategories.map(normalizeFilterName))
      : false,
    norms.length ? await setPrimeCheckboxGroup(page, "norms", norms.map(normalizeFilterName)) : false,
    vehicleClasses.length
      ? await setPrimeCheckboxGroup(page, "VhClass", vehicleClasses.map(normalizeFilterName))
      : false,
  ].some(Boolean);

  if (sideFiltersChanged) {
    await applySideFilters(page);
  }
}

async function refreshReport(page) {
  await page.getByRole("button", { name: "Refresh" }).first().click();
  await page.waitForLoadState("networkidle", { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(3000);
}

function monthFromHeader(value) {
  const cleaned = normalizeText(value).replace(/[^a-z]/gi, "").toUpperCase();
  return MONTH_LABELS.get(cleaned) ?? null;
}

async function extractReportRows(page) {
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (/no data available|no records found|record not found|no data found/i.test(bodyText)) {
    return [];
  }

  const tables = await page.locator("table").evaluateAll((items) =>
    items.map((table) =>
      [...table.querySelectorAll("tr")].map((row) =>
        [...row.querySelectorAll("th,td")]
          .map((cell) => cell.textContent.replace(/\s+/g, " ").trim())
          .filter(Boolean),
      ),
    ),
  );

  const candidates = tables
    .map((table) => table.filter((row) => row.length >= 3))
    .filter((table) =>
      table.some((row) => row.some((cell) => /fuel|month|jan|feb|mar/i.test(cell))),
    )
    .sort((a, b) => b.length - a.length);
  const report = candidates[0];

  if (!report) {
    const tableSamples = tables
      .map((table) => table.slice(0, 3))
      .filter((sample) => sample.length)
      .slice(0, 5);
    throw new Error(
      `Could not find VAHAN report table after refresh. Table samples: ${JSON.stringify(tableSamples)}`,
    );
  }

  const headerIndex = report.findIndex((row) => row.some((cell) => monthFromHeader(cell)));
  if (headerIndex === -1) {
    throw new Error(
      `Could not find month columns in VAHAN report table. Sample rows: ${JSON.stringify(report.slice(0, 5))}`,
    );
  }

  const headers = report[headerIndex];
  const parentHeaders = report[headerIndex - 1] ?? [];
  const monthOffset = parentHeaders.findIndex((header) => /month wise/i.test(header));
  const monthColumns = headers
    .map((header, index) => ({
      index: monthOffset >= 0 ? index + monthOffset : index,
      month: monthFromHeader(header),
    }))
    .filter((item) => item.month !== null);

  if (!monthColumns.length) {
    throw new Error(
      `Detected report table but extracted no month columns. Headers: ${JSON.stringify(headers)} Parent headers: ${JSON.stringify(parentHeaders)}`,
    );
  }

  const labelColumn =
    parentHeaders.findIndex((header) => /fuel/i.test(header)) !== -1
      ? parentHeaders.findIndex((header) => /fuel/i.test(header))
      : 1;

  return report.slice(headerIndex + 1).map((row) => ({
    label: normalizeText(row[labelColumn]),
    counts: Object.fromEntries(
      monthColumns.map(({ index, month }) => [month, normalizeCount(row[index]) ?? 0]),
    ),
  }));
}

async function scrapeReport(page, reportItem) {
  await configureReport(page, reportItem);
  await refreshReport(page);
  await applyReportSideFilters(page, reportItem);
  return extractReportRows(page);
}

async function captureFailureArtifacts(page, outputDir, reportItem, attempt, error) {
  const failureDir = path.join(outputDir, "failures");
  await ensureDir(failureDir);

  const fileBase = [
    timestampStamp(),
    slugify(reportItem.state),
    String(reportItem.year),
    reportItem.rto ? slugify(reportItem.rto) : "all-rtos",
    `attempt${attempt}`,
  ].join("_");
  const screenshotPath = path.join(failureDir, `${fileBase}.png`);
  const htmlPath = path.join(failureDir, `${fileBase}.html`);
  const jsonPath = path.join(failureDir, `${fileBase}.json`);

  const controls = await inspectSelectControls(page).catch(() => []);
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const html = await page.content().catch(() => "");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await writeFileWithRetry(htmlPath, html).catch(() => {});
  await writeFileWithRetry(
    jsonPath,
    JSON.stringify(
      {
        source_url: SOURCE_URL,
        failed_at: new Date().toISOString(),
        attempt,
        error: error.message,
        report: {
          year: reportItem.year,
          months: reportItem.items.map((item) => item.month),
          state: reportItem.state,
          rto: reportItem.rto || "All RTOs",
          fuels: reportItem.fuels,
        },
        title: await page.title().catch(() => ""),
        bodyTextSample: bodyText.slice(0, 4000),
        controls,
        artifacts: {
          screenshot: screenshotPath,
          html: htmlPath,
        },
      },
      null,
      2,
    ),
  ).catch(() => {});

  return { screenshotPath, htmlPath, jsonPath };
}

async function recoverPage(context, page, attempt) {
  if (attempt === 2) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
    return page;
  }

  await page.close().catch(() => {});
  return context.newPage();
}

async function scrapeReportWithRetries(context, page, outputDir, reportItem) {
  let activePage = page;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_SCRAPE_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      activePage = await recoverPage(context, activePage, attempt);
    }

    try {
      const reportRows = await scrapeReport(activePage, reportItem);
      return { page: activePage, reportRows, attempts: attempt };
    } catch (error) {
      lastError = error;
      const artifacts = await captureFailureArtifacts(activePage, outputDir, reportItem, attempt, error);
      console.error(
        `[scraper] attempt ${attempt}/${MAX_SCRAPE_ATTEMPTS} failed for ${reportItem.year} ${reportItem.state} ${reportItem.rto || "All RTOs"}: ${error.message}. Artifact: ${artifacts.jsonPath}`,
      );
      if (attempt < MAX_SCRAPE_ATTEMPTS) await sleep(1000);
    }
  }

  throw lastError;
}

async function discoverDashboard(page, outputDir) {
  const responses = [];

  page.on("response", async (response) => {
    const url = response.url();
    const contentType = response.headers()["content-type"] ?? "";

    if (!/json|xml|csv|text|html/i.test(contentType)) return;
    if (!/analytics|vahan|parivahan/i.test(url)) return;

    responses.push({
      status: response.status(),
      method: response.request().method(),
      url,
      contentType,
    });
  });

  try {
    await openDashboard(page);
  } catch (error) {
    await ensureDir(outputDir);
    await writeFileWithRetry(
      path.join(outputDir, "discover-error.json"),
      JSON.stringify(
        {
          source_url: SOURCE_URL,
          error: error.message,
          checked_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    throw error;
  }

  const controls = await page.evaluate(() => {
    const compact = (value) => value.replace(/\s+/g, " ").trim();

    return {
      title: document.title,
      selects: [...document.querySelectorAll("select")].map((select) => ({
        id: select.id,
        name: select.getAttribute("name"),
        label: compact(select.closest("label")?.innerText ?? ""),
        options: [...select.options].slice(0, 25).map((option) => compact(option.textContent ?? "")),
        optionCount: select.options.length,
      })),
      buttons: [...document.querySelectorAll("button,input[type=button],input[type=submit]")]
        .slice(0, 80)
        .map((button) => ({
          id: button.id,
          name: button.getAttribute("name"),
          text: compact(button.innerText || button.value || ""),
          type: button.getAttribute("type"),
        })),
      textInputs: [...document.querySelectorAll("input")]
        .filter((input) => !["button", "submit", "hidden"].includes(input.type))
        .slice(0, 80)
        .map((input) => ({
          id: input.id,
          name: input.getAttribute("name"),
          type: input.type,
          placeholder: input.getAttribute("placeholder"),
          value: input.value,
        })),
      headings: [...document.querySelectorAll("h1,h2,h3,h4")]
        .slice(0, 40)
        .map((heading) => compact(heading.textContent ?? "")),
    };
  });

  await ensureDir(outputDir);
  await writeFileWithRetry(
    path.join(outputDir, "discover-controls.json"),
    JSON.stringify(controls, null, 2),
  );
  await writeFileWithRetry(
    path.join(outputDir, "discover-responses.json"),
    JSON.stringify(responses, null, 2),
  );

  console.log(`Wrote ${path.join(outputDir, "discover-controls.json")}`);
  console.log(`Wrote ${path.join(outputDir, "discover-responses.json")}`);
}

async function selectByLabel(page, labelPattern, value) {
  const selectors = await page.locator("select").evaluateAll((selects) =>
    selects.map((select) => ({
      id: select.id,
      name: select.getAttribute("name"),
      text: select.outerHTML.slice(0, 500),
      options: [...select.options].map((option) => option.textContent?.replace(/\s+/g, " ").trim() ?? ""),
    })),
  );

  const needle = String(value).toLowerCase();
  const labelRegex = new RegExp(labelPattern, "i");
  const match =
    selectors.find((select) => labelRegex.test(`${select.id} ${select.name} ${select.text}`)) ??
    selectors.find((select) => select.options.some((option) => option.toLowerCase() === needle));

  if (!match) {
    throw new Error(`Could not find select control for ${labelPattern}=${value}`);
  }

  const selector = match.id ? `#${cssEscape(match.id)}` : `select[name="${match.name}"]`;
  await page.selectOption(selector, { label: value }).catch(async () => {
    await page.selectOption(selector, { value });
  });
}

function cssEscape(value) {
  return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, "\\$1");
}

async function fillDateFilters(page, year, month) {
  const monthText = String(month).padStart(2, "0");
  const candidates = [
    { pattern: "year", value: String(year) },
    { pattern: "month", value: String(month) },
    { pattern: "month", value: monthText },
  ];

  for (const candidate of candidates) {
    await selectByLabel(page, candidate.pattern, candidate.value).catch(() => {});
  }

  const dateValue = `${year}-${monthText}-01`;
  await page
    .locator("input[type=date], input[placeholder*=date i], input[id*=date i], input[name*=date i]")
    .first()
    .fill(dateValue, { timeout: 1000 })
    .catch(() => {});
}

async function applyFilters(page) {
  const button = page
    .locator("button,input[type=button],input[type=submit]")
    .filter({ hasText: /view|search|submit|apply|refresh|show/i })
    .first();

  if ((await button.count()) > 0) {
    await button.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  } else {
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  }
}

async function extractVehicleCount(page) {
  const countFromMetric = await page.evaluate(() => {
    const compact = (value) => value.replace(/\s+/g, " ").trim();
    const allText = [...document.querySelectorAll("body *")]
      .map((node) => compact(node.textContent ?? ""))
      .filter(Boolean);

    for (let index = 0; index < allText.length; index += 1) {
      if (/total registration/i.test(allText[index])) {
        for (let offset = 1; offset <= 4; offset += 1) {
          const candidate = allText[index + offset];
          if (candidate && /[\d,]+/.test(candidate)) return candidate;
        }
      }
    }

    return "";
  });

  const metricCount = normalizeCount(countFromMetric);
  if (metricCount !== null) return metricCount;

  const tableCount = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("table td, table th")]
      .map((cell) => cell.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean);
    const numeric = cells
      .map((cell) => Number(cell.replace(/[^\d.-]/g, "")))
      .filter((value) => Number.isFinite(value));
    return numeric.length ? Math.max(...numeric) : null;
  });

  return tableCount;
}

function buildWorkItems(args) {
  const states = args.states.length ? args.states : STATE_NAMES;
  const fuels = args.fuels;
  const rtos = args.rtos.length ? args.rtos : [""];
  const context = filterContext(args);

  if (!args.years.length) {
    throw new Error("Pass --years, for example --years 2019-2026");
  }
  if (!args.months.length) {
    throw new Error("Pass --months, for example --months 1-12");
  }

  const items = [];
  for (const year of args.years) {
    for (const month of args.months) {
      for (const state of states) {
        for (const rto of rtos) {
          items.push({
            year,
            month,
            state,
            rto,
            fuels,
            vehicleCategories: args.vehicleCategories,
            norms: args.norms,
            vehicleClasses: args.vehicleClasses,
            ...context,
          });
        }
      }
    }
  }
  return items;
}

function buildReportItems(workItems) {
  const reports = new Map();
  for (const item of workItems) {
    const key = [
      item.year,
      item.state,
      item.rto,
      item.fuel_filter,
      item.vehicle_category_filter,
      item.norms_filter,
      item.vehicle_class_filter,
    ].join("||");
    if (!reports.has(key)) {
      reports.set(key, {
        year: item.year,
        state: item.state,
        rto: item.rto,
        fuels: item.fuels,
        vehicleCategories: item.vehicleCategories,
        norms: item.norms,
        vehicleClasses: item.vehicleClasses,
        fuel_filter: item.fuel_filter,
        vehicle_category_filter: item.vehicle_category_filter,
        norms_filter: item.norms_filter,
        vehicle_class_filter: item.vehicle_class_filter,
        items: [],
      });
    }
    reports.get(key).items.push(item);
  }
  return [...reports.values()];
}

function keyForItem(item) {
  return [
    item.year,
    item.month,
    item.state,
    item.rto || "All Vahan4 Running Office",
    item.fuel_type ?? "",
    item.fuel_filter ?? "ALL",
    item.vehicle_category_filter ?? "ALL",
    item.norms_filter ?? "ALL",
    item.vehicle_class_filter ?? "ALL",
  ].join("||");
}

async function readExistingRows(filePath) {
  if (!(await exists(filePath))) return [];

  const content = await fs.readFile(filePath, "utf8");
  const [headerLine, ...lines] = content.trim().split(/\r?\n/);
  if (!headerLine || !lines.length) return [];

  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

async function scrape(args) {
  await ensureDir(args.outputDir);
  const outputFile = path.join(args.outputDir, "vahan_fuel_monthly.csv");
  const errorFile = path.join(args.outputDir, "vahan_fuel_monthly_errors.jsonl");
  const summaryFile = path.join(args.outputDir, "vahan_fuel_monthly_summary.json");
  const rows = args.resume && args.persist ? await readExistingRows(outputFile) : [];
  const scrapedRows = [];
  const done = new Set(
    rows.map((row) =>
      keyForItem({
        year: row.year,
        month: row.month,
        state: row.state,
        rto: row.rto,
        fuel_type: row.fuel_type,
        fuel_filter: row.fuel_filter,
        vehicle_category_filter: row.vehicle_category_filter,
        norms_filter: row.norms_filter,
        vehicle_class_filter: row.vehicle_class_filter,
      }),
    ),
  );
  let workItems = buildWorkItems(args).filter((item) => !done.has(keyForItem(item)));
  if (args.limit !== null) workItems = workItems.slice(0, args.limit);

  console.log(`Rows already present: ${rows.length}`);
  console.log(`Work items remaining: ${workItems.length}`);

  if (args.dryRun) {
    console.log("Dry run only. No browser launched and no files written.");
    console.log(JSON.stringify(workItems.slice(0, 20), null, 2));
    return;
  }

  if (args.persist && (!rows.length || !(await exists(outputFile)))) {
    await writeFileWithRetry(outputFile, toCsv(rows));
  }

  const browser = await launchBrowser(args);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  });
  let page = await context.newPage();

  try {
    let succeeded = 0;
    let failed = 0;
    let neonUpserted = 0;
    let neonSkipped = false;
    const reportItems = buildReportItems(workItems);
    for (const [index, reportItem] of reportItems.entries()) {
      const label = `${reportItem.year} ${reportItem.state} ${reportItem.rto || "All RTOs"}`;
      try {
        console.log(`[${index + 1}/${reportItems.length}] ${label}`);
        const scrapeResult = await scrapeReportWithRetries(context, page, args.outputDir, reportItem);
        page = scrapeResult.page;
        const reportRows = scrapeResult.reportRows;
        const newRows = [];

        for (const item of reportItem.items) {
          for (const reportRow of reportRows) {
            if (!reportRow.label || /total/i.test(reportRow.label)) continue;
            const vehicleCount = reportRow.counts[item.month];
            if (vehicleCount === undefined || vehicleCount === null) {
              throw new Error(`Could not find month ${item.month} for fuel "${reportRow.label}"`);
            }
            newRows.push({
              year: item.year,
              month: item.month,
              state: item.state,
              rto: item.rto || "All Vahan4 Running Office",
              fuel_segment: fuelSegment(reportRow.label),
              fuel_type: reportRow.label,
              fuel_filter: reportItem.fuel_filter,
              vehicle_category_filter: reportItem.vehicle_category_filter,
              norms_filter: reportItem.norms_filter,
              vehicle_class_filter: reportItem.vehicle_class_filter,
              vehicle_count: vehicleCount,
              scraped_at: new Date().toISOString(),
              source_url: SOURCE_URL,
            });
          }
        }
        scrapedRows.push(...newRows);
        rows.push(...newRows);
        succeeded += newRows.length;
        if (args.persist) {
          const upsertResult = await upsertRegistrationRows(newRows);
          neonSkipped = neonSkipped || upsertResult.skipped;
          neonUpserted += upsertResult.count;
          await writeFileWithRetry(outputFile, toCsv(rows));
        }
      } catch (error) {
        failed += reportItem.items.length;
        for (const item of reportItem.items) {
          await appendFileWithRetry(
            errorFile,
            `${JSON.stringify({
              item,
              error: error.message,
              state: "failed",
              scraped_at: new Date().toISOString(),
              source_url: SOURCE_URL,
            })}\n`,
          );
        }
        console.error(`Failed: ${label}: ${error.message}`);
      }

      await sleep(args.delayMs);
    }
    if (args.persist) {
      await writeFileWithRetry(
        summaryFile,
        JSON.stringify(
          {
            source_url: SOURCE_URL,
            output_file: outputFile,
            error_file: errorFile,
            total_rows: rows.length,
            attempted_this_run: workItems.length,
            succeeded_this_run: succeeded,
            failed_this_run: failed,
            neon_upserted_this_run: neonUpserted,
            neon_skipped_this_run: neonSkipped,
            completed_at: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    }
    if (args.emitRowsJson) {
      console.log(`VAHAN_SCRAPED_ROWS_JSON:${JSON.stringify(scrapedRows)}`);
    }
    if (failed > 0) {
      throw new Error(`${failed} scrape item(s) failed. See ${errorFile}`);
    }
  } finally {
    await browser.close();
    await closePool();
  }

  if (args.persist) {
    console.log(`Wrote ${rows.length} rows to ${outputFile}`);
    console.log(`Wrote run summary to ${summaryFile}`);
  } else {
    console.log(`Scraped ${scrapedRows.length} rows without persistence`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const browser = args.mode === "discover" ? await launchBrowser(args) : null;
  try {
    if (args.mode === "discover") {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      });
      const page = await context.newPage();
      await discoverDashboard(page, args.outputDir);
    } else if (args.mode === "scrape") {
      await scrape(args);
    } else {
      throw new Error(`Unsupported mode: ${args.mode}`);
    }
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
