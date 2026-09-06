import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { closePool, hasDatabaseUrl } from "../lib/db.mjs";
import { replaceMakerRegistrationRows } from "../lib/maker-registrations.mjs";
import { replaceRegistrationRows } from "../lib/registrations.mjs";
import { upsertRtoDailyConfigs } from "../lib/rto-daily-snapshots.mjs";
import { toCatalogRto } from "../lib/rto-resolver.mjs";
import { acquireVahanScrapeLock } from "../lib/vahan-scrape-lock.mjs";

// The legacy Vahan4Dashboard was retired. The public dashboard exposes the
// aggregate registration data through a monthly filter contract.
const SOURCE_URL =
  "https://analytics.parivahan.gov.in/analytics/publicdashboard/vahan?lang=en";
const PUBLIC_MONTHLY_TABLE_ENDPOINT =
  "/analytics/publicdashboard/vahandashboard/durationWiseRegistrationTable";
const PUBLIC_FUEL_DISTRIBUTION_ENDPOINT =
  "/analytics/publicdashboard/vahandashboard/fueltypedonutchart";

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
  "Jammu and Kashmir",
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
  "FLEX-FUEL(BIO-DIESEL)",
  "FLEX-FUEL(ETHANOL)",
  "FUEL CELL HYDROGEN",
  "HCNG",
  "HYDROGEN(ICE)",
  "LNG",
  "LPG ONLY",
  "METHANOL",
  "NOT APPLICABLE",
  "PETROL",
  "PETROL/CNG",
  "PETROL(E20)",
  "PETROL(E20)/CNG",
  "PETROL(E20)/HYBRID",
  "PETROL(E20)/HYBRID/CNG",
  "PETROL(E20)/LPG",
  "PETROL/ETHANOL",
  "PETROL/HYBRID",
  "PETROL/HYBRID/CNG",
  "PETROL/LPG",
  "PETROL/METHANOL",
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
  ["ELECTRIC", "PURE EV"],
  ["ELECTRIC(BOV)", "PURE EV"],
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
    dimension: "fuel",
    outputDir: DEFAULT_OUTPUT_DIR,
    delayMs: DEFAULT_DELAY_MS,
    headed: false,
    resume: true,
    persist: true,
    emitRowsJson: false,
    emitFuelDistributionJson: false,
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
    } else if (token === "--emit-fuel-distribution-json") {
      args.emitFuelDistributionJson = true;
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
      else if (key === "dimension") args.dimension = value;
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
  if (!["discover", "scrape", "rto-catalog"].includes(args.mode)) {
    throw new Error(`Unsupported mode: ${args.mode}`);
  }
  if (!["fuel", "maker"].includes(args.dimension)) {
    throw new Error(`Unsupported dimension: ${args.dimension}. Use --dimension fuel or --dimension maker.`);
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

function csvHeadersForDimension(dimension) {
  if (dimension === "maker") {
    return [
      "year",
      "month",
      "state",
      "rto",
      "maker",
      ...FILTER_CONTEXT_KEYS,
      "vehicle_count",
      "scraped_at",
      "source_url",
    ];
  }
  return [
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
}

function toCsv(rows, dimension = "fuel") {
  const headers = csvHeadersForDimension(dimension);
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
  await page.locator("#stateCode").waitFor({ state: "attached", timeout: DEFAULT_TIMEOUT_MS });

  const status = response?.status();
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const dashboardControlCount = await page.locator("#stateCode, #rtoCode, #vehicleSubCategory").count();
  const hasCaptchaElement = (await page.locator('[id*="captcha" i], [class*="captcha" i], iframe[src*="captcha" i]').count()) > 0;

  if (status === 403 || /403\s+Forbidden/i.test(bodyText)) {
    throw new Error(
      "VAHAN dashboard returned 403 Forbidden from this machine. Retry with --headed, or use a network/browser session that can open the dashboard normally.",
    );
  }
  if (hasCaptchaElement || (dashboardControlCount < 3 && /captcha|unauthori[sz]ed|access denied/i.test(bodyText))) {
    throw new Error(
      "VAHAN dashboard appears to require CAPTCHA, login, or private access from this session. Stop and verify manually in a normal browser.",
    );
  }
  if (dashboardControlCount < 3) throw new Error("Public Dashboard loaded without the required registration controls.");

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
  const hasKnownOption = (config.knownOptions ?? []).some((value) => {
    const wanted = normalizeLookup(value);
    return options.some((option) => option === wanted || option.includes(wanted));
  });

  if (config.fastIds?.includes(control.id) && (!config.knownOptions?.length || hasKnownOption)) score += 100;
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
    const latestOptions = await page.locator(control.selector).evaluate((select) =>
      [...select.options].map((item) => item.textContent.replace(/\s+/g, " ").trim()).filter(Boolean),
    ).catch(() => control.options.map((item) => item.label));
    throw new Error(
      `Could not find option "${value}" in ${control.id || control.name}. Sample options: ${JSON.stringify(
        latestOptions.slice(0, 12),
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
  await page.locator(".ui-blockui.ui-widget-overlay:visible").first().waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return control;
}

async function readPrimeCheckboxGroup(page, tableId, wantedLabels) {
  const wanted = new Set(wantedLabels.map((label) => normalizeLookup(label)));
  return page.locator(`table[id="${tableId}"] tr`).evaluateAll(
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
}

async function assertPrimeCheckboxGroup(page, tableId, wantedLabels) {
  if (!wantedLabels.length) return;

  const matches = await readPrimeCheckboxGroup(page, tableId, wantedLabels);
  const selected = matches.filter((match) => match.wanted);
  if (!selected.length) {
    throw new Error(`Could not verify ${tableId} checkbox for ${wantedLabels.join(", ")}`);
  }

  const missingSelection = selected.filter((match) => !match.checked).map((match) => match.text);
  if (missingSelection.length) {
    throw new Error(`VAHAN did not keep ${tableId} checkbox selected for ${missingSelection.join(", ")}`);
  }
}

async function setPrimeCheckboxGroup(page, tableId, wantedLabels) {
  const matches = await readPrimeCheckboxGroup(page, tableId, wantedLabels);
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

  const afterMatches = await readPrimeCheckboxGroup(page, tableId, wantedLabels);
  const selected = afterMatches.filter((match) => match.wanted);
  if (wantedLabels.length && !selected.length) {
    throw new Error(`Could not find ${tableId} checkbox for ${wantedLabels.join(", ")}`);
  }
  const missingSelection = selected.filter((match) => !match.checked).map((match) => match.text);
  if (missingSelection.length) {
    throw new Error(`Could not select ${tableId} checkbox for ${missingSelection.join(", ")}`);
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

async function configureReport(page, { state, rto, year, dimension = "fuel" }) {
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
  const uiStateName = state === "INDIA TOTAL" ? "All Vahan4 Running States (36/36)" : state;
  await selectPrimeOption(
    page,
    {
      description: "state",
      fastIds: ["j_idt41_input"],
      labelPatterns: [/state/i],
      knownOptions: [uiStateName, state, "Assam", "Maharashtra", "Delhi", "All Vahan4 Running States (36/36)"],
      optionPatterns: [/andhra pradesh|assam|maharashtra|uttar pradesh/i, /All Vahan.* Running States/i],
      minOptions: 10,
    },
    uiStateName,
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
    dimension === "maker" ? "Maker" : "Fuel",
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

async function selectStateForCatalog(page, state) {
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
}

async function extractRtoOptions(page) {
  const control = await findSelectControl(page, {
    description: "RTO",
    fastIds: ["selectedRto_input"],
    labelPatterns: [/rto|office|running office/i],
    knownOptions: ["All Vahan4 Running Office"],
    minOptions: 2,
  });

  return page.locator(control.selector).evaluate((select) =>
    [...select.options]
      .map((option) => option.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
}

async function buildRtoCatalog(args) {
  await ensureDir(args.outputDir);
  const outputFile = path.join(args.outputDir, "rto_catalog.json");
  const requestedStates = args.states.length ? new Set(args.states.map((state) => normalizeLookup(publicStateLabel(state)))) : null;

  const browser = await launchBrowser(args);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await openDashboard(page);
    const stateOptions = (await publicSelectOptions(page, "#stateCode"))
      .filter((option) => option.value && option.label)
      .filter((option) => !/^select|^all india|^india total/i.test(option.label));
    const states = requestedStates
      ? stateOptions.filter((option) => requestedStates.has(normalizeLookup(option.label)))
      : stateOptions;
    if (!states.length) throw new Error("Public Dashboard returned no matching states for the RTO catalog.");
    const catalogStates = [];
    for (const [index, stateOption] of states.entries()) {
      console.log(`[${index + 1}/${states.length}] Reading RTOs for ${stateOption.label}`);
      await page.locator("#stateCode").selectOption(stateOption.value);
      await page.waitForTimeout(300);
      const labels = (await publicSelectOptions(page, "#rtoCode")).map((option) => option.label);
      const rtos = labels
        .filter((label) => !/^All Vahan4 Running Office/i.test(label))
        .map(toCatalogRto)
        .sort((a, b) => a.label.localeCompare(b.label));
      if (!rtos.length) throw new Error(`Public Dashboard returned no RTOs for ${stateOption.label}.`);
      catalogStates.push({ state: stateOption.label, rtos });
      await sleep(args.delayMs);
    }

    const totalRtos = catalogStates.reduce((count, group) => count + group.rtos.length, 0);
    if (catalogStates.length < 20 || totalRtos < 1000) {
      throw new Error(`Refusing to replace the RTO catalog with incomplete coverage: states=${catalogStates.length}, rtos=${totalRtos}.`);
    }
    const catalog = {
      source_url: SOURCE_URL,
      updated_at: new Date().toISOString(),
      states: catalogStates,
    };
    const configs = catalogStates.flatMap((group) => group.rtos.map((rto, index) => ({
      state: group.state,
      rto: rto.label ?? rto,
      enabled: true,
      priority: index + 100,
    })));
    const database = process.env.DATABASE_URL && process.env.RTO_CATALOG_SKIP_DATABASE !== "1"
      ? await upsertRtoDailyConfigs(configs, {
          refreshedAt: catalog.updated_at,
          reconcileMissing: args.states.length === 0,
        })
      : { skipped: true };
    await writeFileWithRetry(outputFile, JSON.stringify(catalog, null, 2));
    console.log(`Wrote ${outputFile}`);
    console.log(JSON.stringify({ rtoCatalog: { states: catalogStates.length, rtos: configs.length, database } }, null, 2));
  } finally {
    await browser.close();
  }
}

export function hasRequestedSideFilters({ fuels = [], vehicleCategories = [], norms = [], vehicleClasses = [] } = {}) {
  return [fuels, vehicleCategories, norms, vehicleClasses].some((labels) => labels.length > 0);
}

async function applyReportSideFilters(page, { fuels, vehicleCategories, norms, vehicleClasses }) {
  const expectedFuels = fuels.map(normalizeFuelName);
  const expectedVehicleCategories = vehicleCategories.map(normalizeFilterName);
  const expectedNorms = norms.map(normalizeFilterName);
  const expectedVehicleClasses = vehicleClasses.map(normalizeFilterName);
  const shouldRefreshSideFilters = hasRequestedSideFilters({
    fuels: expectedFuels,
    vehicleCategories: expectedVehicleCategories,
    norms: expectedNorms,
    vehicleClasses: expectedVehicleClasses,
  });

  [
    expectedFuels.length ? await setPrimeCheckboxGroup(page, "fuel", expectedFuels) : false,
    vehicleCategories.length
      ? await setPrimeCheckboxGroup(page, "VhCatg", expectedVehicleCategories)
      : false,
    expectedNorms.length ? await setPrimeCheckboxGroup(page, "norms", expectedNorms) : false,
    vehicleClasses.length
      ? await setPrimeCheckboxGroup(page, "VhClass", expectedVehicleClasses)
      : false,
  ];

  // configureReport() refreshes the main report before this function runs. A
  // checkbox can already be selected from a previous report while that refresh
  // has rendered unfiltered data, so refreshing only after a checkbox toggle
  // can store an unfiltered table under a filtered context label.
  if (shouldRefreshSideFilters) {
    await applySideFilters(page);
  }

  await assertPrimeCheckboxGroup(page, "fuel", expectedFuels);
  await assertPrimeCheckboxGroup(page, "VhCatg", expectedVehicleCategories);
  await assertPrimeCheckboxGroup(page, "norms", expectedNorms);
  await assertPrimeCheckboxGroup(page, "VhClass", expectedVehicleClasses);
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

async function extractVisibleReportRows(page, { dimension = "fuel" } = {}) {
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (/no data available|no records found|record not found|no data found|no information available/i.test(bodyText)) {
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
    .map((table) => {
      const headerIndex = table.findIndex((row) => row.some((cell) => monthFromHeader(cell)));
      const parentHeaders = headerIndex > 0 ? table[headerIndex - 1] : [];
      const labelPattern = dimension === "maker" ? /maker|manufacturer|oem/i : /fuel/i;
      const hasLabelColumn = table.some((row) => row.some((cell) => labelPattern.test(cell)));
      const hasMonthWiseParent = parentHeaders.some((cell) => /month wise/i.test(cell));
      return { table, headerIndex, hasLabelColumn, hasMonthWiseParent };
    })
    .filter((item) => item.headerIndex !== -1 && item.hasLabelColumn)
    .sort((a, b) => {
      if (a.hasMonthWiseParent !== b.hasMonthWiseParent) return a.hasMonthWiseParent ? -1 : 1;
      return b.table.length - a.table.length;
    });
  const report = candidates[0]?.table;

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

  const labelPattern = dimension === "maker" ? /maker|manufacturer|oem/i : /fuel/i;
  const parentLabelColumn = parentHeaders.findIndex((header) => labelPattern.test(header));
  const headerLabelColumn = headers.findIndex((header) => labelPattern.test(header));
  const labelColumn = parentLabelColumn !== -1 ? parentLabelColumn : headerLabelColumn;
  if (labelColumn === -1) {
    const expectedColumn = dimension === "maker" ? "maker/manufacturer/OEM" : "fuel";
    throw new Error(
      `Detected report table but could not find a ${expectedColumn} label column. Headers: ${JSON.stringify(headers)} Parent headers: ${JSON.stringify(parentHeaders)}`,
    );
  }

  return report.slice(headerIndex + 1).map((row) => ({
    label: normalizeText(row[labelColumn]),
    counts: Object.fromEntries(
      monthColumns.map(({ index, month }) => [month, normalizeCount(row[index]) ?? 0]),
    ),
  })).filter((row) => row.label);
}

function reportRowKey(row) {
  return [
    row.label,
    ...Object.entries(row.counts ?? {}).sort(([left], [right]) => Number(left) - Number(right)).map(([month, count]) => `${month}:${count}`),
  ].join("||");
}

async function clickNextReportPage(page) {
  const next = page.locator(".ui-paginator-next:not(.ui-state-disabled)").last();
  if (!(await next.count())) return false;
  await page.locator(".ui-blockui.ui-widget-overlay:visible").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
  await next.click({ timeout: 10_000 }).catch(async (error) => {
    await page.locator(".ui-blockui.ui-widget-overlay:visible").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
    await next.click({ timeout: 10_000 }).catch(() => {
      throw error;
    });
  });
  await page.waitForLoadState("networkidle", { timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  await page.locator(".ui-blockui.ui-widget-overlay:visible").first().waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return true;
}

async function extractReportRows(page, reportItem = {}) {
  const rowsByLabel = new Map();
  const seenPages = new Set();

  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const rows = await extractVisibleReportRows(page, reportItem);
    const pageKey = rows.map(reportRowKey).join("\n");
    if (pageKey && seenPages.has(pageKey)) break;
    if (pageKey) seenPages.add(pageKey);

    for (const row of rows) {
      rowsByLabel.set(row.label, row);
    }

    if (!(await clickNextReportPage(page))) break;
  }

  return [...rowsByLabel.values()];
}

function publicStateLabel(state) {
  return state === "Jammu and Kashmir" ? "Jammu & Kashmir" : state;
}

function publicMonthFromLabel(value) {
  const match = String(value ?? "").match(/(\d{4})[-\s]+([A-Za-z]+)/);
  if (!match) return null;
  return { year: Number(match[1]), month: monthFromHeader(match[2]) };
}

export function parsePublicMonthlyRows(rows, { year, label }) {
  if (!Array.isArray(rows)) throw new Error("Public dashboard returned an invalid monthly response.");
  if (rows.length === 0) return { label, counts: {}, explicitZero: true };
  const counts = {};
  for (const row of rows) {
    const period = publicMonthFromLabel(row?.yearAsString);
    const count = normalizeCount(row?.registeredVehicleCount);
    if (!period?.month || period.year !== Number(year) || count === null) continue;
    counts[period.month] = count;
  }
  if (!Object.keys(counts).length) {
    throw new Error(`Public dashboard returned no monthly values for ${label}.`);
  }
  return { label, counts };
}

export function parsePublicFuelDistribution(response) {
  const labels = Array.isArray(response?.labels) ? response.labels : [];
  const values = Array.isArray(response?.data) ? response.data : [];
  if (labels.length !== values.length || !labels.length) {
    throw new Error("Public dashboard returned an invalid fuel-distribution response.");
  }
  const distribution = labels.map((label, index) => ({
    fuelType: String(label ?? "").replace(/\s+/g, " ").trim(),
    count: normalizeCount(values[index]),
  })).filter((item) => item.fuelType && item.count !== null);
  if (!distribution.length) throw new Error("Public dashboard returned no fuel-distribution values.");
  return distribution;
}

async function publicSelectOptions(page, selector) {
  return page.locator(selector).evaluate((select) =>
    [...select.options].map((option) => ({
      label: option.textContent.replace(/\s+/g, " ").trim(),
      value: option.value,
    })),
  ).catch(() => []);
}

function matchingPublicOption(options, wanted) {
  const desired = normalizeLookup(wanted);
  return options.find((option) => normalizeLookup(option.label) === desired)
    ?? options.find((option) => normalizeLookup(option.label).includes(desired));
}

function rtoCodes(value) {
  return [...String(value ?? "").toUpperCase().matchAll(/\b([A-Z]{2})\s*-?\s*(\d{1,3})\b/g)]
    .map((match) => `${match[1]}${match[2]}`);
}

export function publicRtoOptionValue(options = [], wanted = "") {
  const direct = matchingPublicOption(options, wanted);
  if (direct) return direct.value;

  const wantedCodes = new Set(rtoCodes(wanted));
  if (!wantedCodes.size) return "";
  const byCode = options.find((option) =>
    rtoCodes(`${option.label} ${option.value}`).some((code) => wantedCodes.has(code)));
  return byCode?.value ?? "";
}

async function publicOptionValue(page, selector, wanted, { optional = false } = {}) {
  const options = await publicSelectOptions(page, selector);
  const match = matchingPublicOption(options, wanted);
  if (match) return match.value;
  if (optional) return "";
  throw new Error(`Could not find public-dashboard option "${wanted}" in ${selector}.`);
}

async function publicRtoValue(page, wanted) {
  await page.waitForFunction(
    () => (document.querySelector("#rtoCode")?.options.length ?? 0) > 1,
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  const value = publicRtoOptionValue(await publicSelectOptions(page, "#rtoCode"), wanted);
  if (value) return value;
  throw new Error(`Could not find public-dashboard option "${wanted}" in #rtoCode.`);
}

async function publicOptionValues(page, selector, wanted = []) {
  return Promise.all(wanted.map((label) => publicOptionValue(page, selector, label)));
}

export function publicMonthlyQueryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && item !== undefined && String(item) !== "") query.append(`${key}[]`, String(item));
      }
    } else if (value !== null && value !== undefined && String(value) !== "") {
      query.append(key, String(value));
    }
  }
  return query.toString();
}

export function publicChartQueryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = Array.isArray(value) ? value.filter(Boolean).join(",") : value;
    if (normalized !== null && normalized !== undefined && String(normalized) !== "") query.append(key, String(normalized));
  }
  return query.toString();
}

async function fetchPublicJson(page, endpoint, query, description) {
  const result = await page.evaluate(async ({ url }) => {
    const response = await fetch(url, { method: "GET", credentials: "same-origin" });
    return { status: response.status, text: await response.text() };
  }, { url: `${endpoint}?${query}` });
  if (result.status < 200 || result.status >= 300) throw new Error(`Public dashboard ${description} endpoint returned HTTP ${result.status}.`);
  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error(`Public dashboard ${description} endpoint did not return JSON.`);
  }
}

async function fetchPublicMonthlyTable(page, params) {
  return fetchPublicJson(page, PUBLIC_MONTHLY_TABLE_ENDPOINT, publicMonthlyQueryString(params), "monthly");
}

async function scrapePublicFuelReport(page, reportItem) {
  await openDashboard(page);
  const stateCode = reportItem.state === "INDIA TOTAL"
    ? ""
    : await publicOptionValue(page, "#stateCode", publicStateLabel(reportItem.state));
  let rtoCode = "0";
  if (reportItem.rto) {
    await page.locator("#stateCode").selectOption(stateCode);
    await page.waitForTimeout(300);
    rtoCode = await publicRtoValue(page, reportItem.rto);
  }
  const vehicleSubCategories = await publicOptionValues(page, "#vehicleSubCategory", reportItem.vehicleCategories ?? []);
  const vehicleClasses = await publicOptionValues(page, "#vehicleClass", reportItem.vehicleClasses ?? []);
  const vehicleEmissions = await publicOptionValues(page, "#vehicleEmission", reportItem.norms ?? []);
  const requestedFuels = reportItem.fuels?.length ? reportItem.fuels : ["ALL"];
  const rows = [];
  for (const fuel of requestedFuels) {
    const vehicleFuels = fuel === "ALL" ? "" : await publicOptionValue(page, "#vehicleFuel", normalizeFuelName(fuel), { optional: true });
    if (!vehicleFuels && fuel !== "ALL") {
      if (reportItem.fuels?.length) throw new Error(`Public dashboard does not expose the requested fuel filter "${fuel}".`);
      continue;
    }
    const response = await fetchPublicMonthlyTable(page, {
      stateCode,
      rtoCode,
      fromYear: String(reportItem.year),
      toYear: String(reportItem.year),
      vehicleClasses,
      vehicleMakers: [],
      vehicleSubCategories,
      vehicleEmissions,
      vehicleFuels: [vehicleFuels],
      timePeriod: "0",
      calendarType: "3",
      vehicleCategoryGroup: [],
      evType: [],
      vehicleStatus: [],
      vehicleOwnerType: [],
      fitnessCheck: "0",
      vehicleType: "",
      archiveTypeAC: "ACTIVE_COMPLIANT",
      archiveTypeANC: "ACTIVE_NON_COMPLIANT",
      archiveTypePA: "",
      archiveTypeTA: "",
      archiveTypeNA: "",
    });
    rows.push(parsePublicMonthlyRows(response, { year: reportItem.year, label: fuel }));
  }
  if (!rows.length) throw new Error("Public dashboard returned no matching fuel filters.");
  return rows;
}

async function scrapePublicFuelDistribution(page, reportItem) {
  const stateCode = reportItem.state === "INDIA TOTAL" ? "" : await publicOptionValue(page, "#stateCode", publicStateLabel(reportItem.state));
  let rtoCode = "0";
  if (reportItem.rto) {
    rtoCode = await publicRtoValue(page, reportItem.rto);
  }
  const vehicleSubCategories = await publicOptionValues(page, "#vehicleSubCategory", reportItem.vehicleCategories ?? []);
  const vehicleClasses = await publicOptionValues(page, "#vehicleClass", reportItem.vehicleClasses ?? []);
  const vehicleEmissions = await publicOptionValues(page, "#vehicleEmission", reportItem.norms ?? []);
  const response = await fetchPublicJson(page, PUBLIC_FUEL_DISTRIBUTION_ENDPOINT, publicChartQueryString({
    stateCode, rtoCode, fromYear: String(reportItem.year), toYear: String(reportItem.year),
    vehicleClasses, vehicleMakers: [], vehicleSubCategories, vehicleEmissions, vehicleFuels: [],
    timePeriod: "0", vehicleCategoryGroup: [], evType: [], vehicleStatus: [], vehicleOwnerType: [],
    fitnessCheck: "0", vehicleType: "", archiveTypeAC: "ACTIVE_COMPLIANT", archiveTypeANC: "ACTIVE_NON_COMPLIANT",
    archiveTypePA: "", archiveTypeTA: "", archiveTypeNA: "",
  }), "fuel-distribution");
  return parsePublicFuelDistribution(response);
}

async function scrapeReport(page, reportItem) {
  if (reportItem.dimension !== "fuel") {
    throw new Error("The public dashboard adapter currently supports fuel-month ingestion only; maker collection remains disabled until a complete monthly maker contract is verified.");
  }
  return scrapePublicFuelReport(page, reportItem);
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

export function resolveMakerReportTotal({ metricTotal = null, rows = [], explicitZero = false } = {}) {
  if (explicitZero) return 0;
  const rowTotal = rows.reduce((sum, row) => sum + Number(row.vehicle_count ?? row.vehicleCount ?? 0), 0);
  if (Number.isFinite(metricTotal) && metricTotal >= rowTotal) return metricTotal;
  return rowTotal;
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
            dimension: args.dimension,
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
      item.dimension,
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
        dimension: item.dimension,
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
    item.dimension ?? (item.maker !== undefined ? "maker" : "fuel"),
    item.year,
    item.month,
    item.state,
    item.rto || "All Vahan4 Running Office",
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
  const outputBase = args.dimension === "maker" ? "vahan_maker_monthly" : "vahan_fuel_monthly";
  const outputFile = path.join(args.outputDir, `${outputBase}.csv`);
  const errorFile = path.join(args.outputDir, `${outputBase}_errors.jsonl`);
  const summaryFile = path.join(args.outputDir, `${outputBase}_summary.json`);
  const rows = args.resume && args.persist ? await readExistingRows(outputFile) : [];
  const scrapedRows = [];
  const fuelDistributions = [];
  const done = new Set(
    rows.map((row) =>
      keyForItem({
        dimension: args.dimension,
        year: row.year,
        month: row.month,
        state: row.state,
        rto: row.rto,
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
    await writeFileWithRetry(outputFile, toCsv(rows, args.dimension));
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
        if (args.emitFuelDistributionJson) {
          fuelDistributions.push({ year: reportItem.year, distribution: await scrapePublicFuelDistribution(page, reportItem) });
        }
        const newRows = [];

        for (const item of reportItem.items) {
          for (const reportRow of reportRows) {
            if (!reportRow.label || /total/i.test(reportRow.label)) continue;
            const vehicleCount = reportRow.counts[item.month];
            if ((vehicleCount === undefined || vehicleCount === null) && !reportRow.explicitZero) {
              throw new Error(`Could not find month ${item.month} for ${args.dimension} "${reportRow.label}"`);
            }
            const common = {
              year: item.year,
              month: item.month,
              state: item.state,
              rto: item.rto || "All Vahan4 Running Office",
              fuel_filter: reportItem.fuel_filter,
              vehicle_category_filter: reportItem.vehicle_category_filter,
              norms_filter: reportItem.norms_filter,
              vehicle_class_filter: reportItem.vehicle_class_filter,
              vehicle_count: reportRow.explicitZero ? 0 : vehicleCount,
              scraped_at: new Date().toISOString(),
              source_url: SOURCE_URL,
            };
            newRows.push(args.dimension === "maker"
              ? { ...common, maker: reportRow.label }
              : { ...common, fuel_segment: fuelSegment(reportRow.label), fuel_type: reportRow.label });
          }
        }
        scrapedRows.push(...newRows);
        const replacementKeys = new Set(newRows.map((row) => keyForItem(row)));
        const replacementContexts = new Set(reportItem.items.map((item) => keyForItem(item)));
        for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
          const existingKey = keyForItem(rows[rowIndex]);
          if (replacementKeys.has(existingKey) || replacementContexts.has(existingKey)) rows.splice(rowIndex, 1);
        }
        rows.push(...newRows);
        succeeded += newRows.length;
        if (args.persist) {
          const upsertResult = args.dimension === "maker"
            ? await replaceMakerRegistrationRows(newRows)
            : await replaceRegistrationRows(newRows);
          neonSkipped = neonSkipped || upsertResult.skipped;
          neonUpserted += upsertResult.count;
          await writeFileWithRetry(outputFile, toCsv(rows, args.dimension));
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
            dimension: args.dimension,
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
    if (args.emitFuelDistributionJson) {
      console.log(`VAHAN_FUEL_DISTRIBUTION_JSON:${JSON.stringify(fuelDistributions)}`);
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

export async function createVahanMakerSession(options = {}) {
  const args = {
    mode: "scrape",
    dimension: "maker",
    outputDir: options.outputDir ?? DEFAULT_OUTPUT_DIR,
    delayMs: Number(options.delayMs ?? DEFAULT_DELAY_MS),
    headed: Boolean(options.headed),
    channel: options.channel ?? "",
  };
  await ensureDir(args.outputDir);
  const browser = await launchBrowser(args);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  });
  let page = await context.newPage();
  let closed = false;

  return {
    async scrapeReport(input) {
      if (closed) throw new Error("VAHAN maker session is closed.");
      const reportItem = {
        year: Number(input.year),
        state: input.state,
        rto: input.rto,
        dimension: "maker",
        fuels: input.fuels ?? [],
        vehicleCategories: input.vehicleCategories ?? [],
        norms: input.norms ?? [],
        vehicleClasses: input.vehicleClasses ?? [],
        fuel_filter: (input.fuels ?? []).join("|") || "ALL",
        vehicle_category_filter: (input.vehicleCategories ?? []).join("|") || "ALL",
        norms_filter: (input.norms ?? []).join("|") || "ALL",
        vehicle_class_filter: (input.vehicleClasses ?? []).join("|") || "ALL",
        items: [{ month: Number(input.month) }],
      };
      const result = await scrapeReportWithRetries(context, page, args.outputDir, reportItem);
      page = result.page;
      const reportRows = result.reportRows.filter((row) => row.label && !/total/i.test(row.label));
      const rows = reportRows.map((row) => ({
        maker: row.label,
        vehicle_count: Number(row.counts?.[Number(input.month)] ?? 0),
      }));
      let reportTotal = await extractVehicleCount(page);
      const bodyText = rows.length ? "" : await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      const emptyTableEvidence = rows.length ? null : await page.evaluate((expectedRto) => {
        const table = document.querySelector("#groupingTable");
        const panelText = document.querySelector("#tablePnl")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const normalized = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
        const expected = normalized(expectedRto).split(" ").slice(0, 4).join(" ");
        return {
          tablePresent: Boolean(table),
          dataRows: table?.querySelectorAll("tbody tr[data-ri]").length ?? 0,
          titleMatches: panelText.includes("Maker Month Wise Data") && normalized(panelText).includes(expected),
        };
      }, input.rto).catch(() => null);
      const explicitZero = rows.length === 0 && (
        reportTotal === 0
        || /no records?|no data|nothing found/i.test(bodyText)
        || (emptyTableEvidence?.tablePresent && emptyTableEvidence.dataRows === 0 && emptyTableEvidence.titleMatches)
      );
      if (!rows.length && !explicitZero) {
        throw new Error("VAHAN returned no maker rows without an explicit zero-result signal.");
      }
      reportTotal = resolveMakerReportTotal({ metricTotal: reportTotal, rows, explicitZero });
      return {
        status: "success",
        state: input.state,
        rto: input.rto,
        fuelGroup: input.fuelGroup,
        vehicleCategory: input.vehicleCategory,
        filtersConfirmed: true,
        reportTotal: reportTotal ?? rows.reduce((sum, row) => sum + row.vehicle_count, 0),
        rows,
        explicitZero,
        attempts: result.attempts,
        scrapedAt: new Date().toISOString(),
        evidence: {
          sourceUrl: SOURCE_URL,
          year: Number(input.year),
          month: Number(input.month),
          fuels: reportItem.fuels,
          vehicleCategories: reportItem.vehicleCategories,
          vehicleClasses: reportItem.vehicleClasses,
          emptyTableEvidence,
        },
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      await browser.close();
    },
  };
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
      const releaseLock = hasDatabaseUrl()
        ? await acquireVahanScrapeLock("public-dashboard-scrape", {
            waitMs: Number(process.env.PUBLIC_DASHBOARD_LOCK_WAIT_MS ?? 30 * 60_000),
          })
        : null;
      try {
        await scrape(args);
      } finally {
        await releaseLock?.();
      }
    } else if (args.mode === "rto-catalog") {
      const releaseLock = process.env.RTO_CATALOG_SKIP_DATABASE === "1" ? null : await acquireVahanScrapeLock("rto-catalog", {
        waitMs: Number(process.env.RTO_CATALOG_LOCK_WAIT_MS ?? 30 * 60_000),
      });
      try {
        await buildRtoCatalog(args);
      } finally {
        await releaseLock?.();
      }
    } else {
      throw new Error(`Unsupported mode: ${args.mode}`);
    }
  } finally {
    if (browser) await browser.close();
    await closePool();
  }
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
