import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyComparison, comparisonPlan, createComparisonDirectory, governmentPageBlockReason, governmentTotalForMonths, parseComparisonArgs, publicReportRowsFromResponse, safeQuerySlug, validateAppHealth, validateAppQueryPayload, validateDeployedUrl } from "./final-vahan-comparison.mjs";

assert.equal(safeQuerySlug("Show BS VI diesel motor cars in Maharashtra / Feb 2026"), "show-bs-vi-diesel-motor-cars-in-maharashtra-feb-2026");
assert.equal(safeQuerySlug("..\\..//CON"), "query-con");
assert.equal(validateDeployedUrl("https://vahan-ey.example.org/"), "https://vahan-ey.example.org");
assert.throws(() => validateDeployedUrl("http://vahan-ey.example.org/"), /HTTPS/i);
assert.deepEqual(parseComparisonArgs(["--app-url", "https://vahan-ey.example.org/", "--query", "Show registrations", "--headless", "--allow-live-refresh"]), { deployedUrl: "https://vahan-ey.example.org", query: "Show registrations", headed: false, keepOpen: false, allowLiveRefresh: true, channel: "", help: false });
const compatible = comparisonPlan({ state: "Maharashtra", from: "2025-12", to: "2026-02", selectedFuelTypes: ["DIESEL"], selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"], selectedVehicleClasses: ["MOTOR CAR"], selectedNorms: ["BHARAT STAGE VI"] });
assert.equal(compatible.comparable, true); assert.deepEqual(compatible.months, ["2025-12", "2026-01", "2026-02"]); assert.deepEqual(compatible.fuels, ["DIESEL"]);
assert.equal(comparisonPlan({ state: "Maharashtra", from: "2026-01", to: "2026-01", selectedVehicleGroups: ["4W"] }).vehicleGroups[0], "Four Wheeler");
assert.equal(comparisonPlan({ state: "Maharashtra", from: "2026-01", to: "2026-01", excludedNorms: ["BHARAT STAGE IV"] }).comparable, false);
assert.equal(validateAppHealth({ status: "ok", liveRefreshDisabled: false }).accepted, false); assert.equal(validateAppHealth({ status: "ok", liveRefreshDisabled: false }, { allowLiveRefresh: true }).accepted, true);
assert.equal(validateAppQueryPayload({ filters: {}, summary: { total: 10 }, dataStatus: "complete", liveRefresh: null }).accepted, true); assert.equal(validateAppQueryPayload({ filters: {}, summary: { total: 10 }, dataStatus: "refreshing", liveRefresh: { status: "pending" } }, { allowLiveRefresh: true }).refreshPending, true);
const rows = publicReportRowsFromResponse([{ yearAsString: "2025-Dec", registeredVehicleCount: "10" }, { yearAsString: "2026-Jan", registeredVehicleCount: "20" }]);
assert.equal(governmentTotalForMonths(rows, ["2025-12", "2026-01"]), 30); assert.equal(classifyComparison(100000, 100061).status, "within_tolerance"); assert.equal(classifyComparison(1000, 1200).status, "mismatch"); assert.notEqual(governmentPageBlockReason({ status: 403, bodyText: "Forbidden" }), null);
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vahan-final-comparison-"));
try { const first = await createComparisonDirectory({ repoRoot: tempRoot, query: "Safe final check", now: new Date("2026-09-02T00:00:00.000Z") }); const second = await createComparisonDirectory({ repoRoot: tempRoot, query: "Safe final check", now: new Date("2026-09-02T00:00:00.000Z") }); assert.equal(path.basename(first.directory), "safe-final-check"); assert.equal(path.basename(second.directory), "safe-final-check-20260902T000000000Z"); } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
console.log("Final Vahan comparison unit checks passed.");
