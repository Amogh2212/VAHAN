import assert from "node:assert/strict";
import {
  decodeDashboardAiQuery,
  normalizeDashboardAiFilters,
} from "../server.mjs";

const vocabulary = Object.freeze({
  fuelTypes: ["DIESEL", "ELECTRIC(BOV)"],
  vehicleGroups: ["TWO WHEELER"],
  vehicleClasses: ["MOTOR CAR"],
  vehicleCategories: ["LIGHT MOTOR VEHICLE"],
  norms: ["BHARAT STAGE VI"],
});

const cloudKeys = {
  GEMINI_API_KEY: "cloud-key-must-not-be-used",
  GROQ_API_KEY: "cloud-key-must-not-be-used",
};

const validPlan = {
  supported: true,
  semanticIntent: "Electric vehicle registrations in Delhi",
  selectedFuelTypes: ["ELECTRIC(BOV)"],
  selectedVehicleGroups: [],
  selectedVehicleClasses: [],
  selectedVehicleCategories: [],
  selectedNorms: [],
  excludedFuelTypes: [],
  excludedVehicleGroups: [],
  excludedVehicleClasses: [],
  excludedVehicleCategories: [],
  excludedNorms: [],
  state: "Delhi",
  rtoText: null,
  locationText: "Delhi",
  locationType: "state",
  from: "2025-01",
  to: "2025-01",
  metric: "registrations",
  semanticConfidence: 0.94,
  semanticExplanation: "Matched the configured local semantic vocabulary.",
};

let disabledFetches = 0;
const disabled = await decodeDashboardAiQuery("electric registrations in Delhi", vocabulary, {
  env: cloudKeys,
  fetchImpl: async () => {
    disabledFetches += 1;
    throw new Error("A disabled provider must not fetch.");
  },
});
assert.deepEqual(disabled, { filters: null, warnings: [] });
assert.equal(disabledFetches, 0, "Cloud keys must not enable dashboard AI when AI_QUERY_PROVIDER is unset/none.");

const unsupportedProvider = await decodeDashboardAiQuery("electric registrations in Delhi", vocabulary, {
  env: { AI_QUERY_PROVIDER: "gemini", ...cloudKeys },
  fetchImpl: async () => {
    disabledFetches += 1;
    throw new Error("Only the explicit ollama provider may fetch.");
  },
});
assert.deepEqual(unsupportedProvider, { filters: null, warnings: [] });
assert.equal(disabledFetches, 0, "Gemini/Groq configuration must not re-enable cloud decoding.");

const requests = [];
let requestedTimeout = null;
const timeoutController = new AbortController();
const decoded = await decodeDashboardAiQuery("electric registrations in Delhi", vocabulary, {
  env: { AI_QUERY_PROVIDER: "ollama", ...cloudKeys },
  timeoutSignal: (timeoutMs) => {
    requestedTimeout = timeoutMs;
    return timeoutController.signal;
  },
  fetchImpl: async (url, request) => {
    requests.push({ url, request });
    return {
      ok: true,
      json: async () => ({ message: { content: JSON.stringify(validPlan) } }),
    };
  },
});
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "http://127.0.0.1:11434/api/chat");
assert.equal(requestedTimeout, 10_000);
assert.equal(requests[0].request.method, "POST");
assert.equal(requests[0].request.headers["content-type"], "application/json");
assert.equal(requests[0].request.signal, timeoutController.signal);
const requestBody = JSON.parse(requests[0].request.body);
assert.equal(requestBody.model, "qwen3:4b");
assert.equal(requestBody.stream, false);
assert.equal(requestBody.format, "json");
assert.equal(requestBody.think, false);
assert.deepEqual(requestBody.options, { temperature: 0, num_predict: 500 });
assert.equal(requestBody.messages[0].role, "system");
assert.match(requestBody.messages[1].content, /Query: electric registrations in Delhi/);
assert.equal(decoded.filters?.aiProvider, "Ollama");
assert.deepEqual(decoded.warnings, []);

const normalized = normalizeDashboardAiFilters({
  ...decoded.filters,
  selectedFuelTypes: ["ELECTRIC(BOV)", "MADE UP FUEL"],
  selectedVehicleGroups: "not an array",
}, vocabulary);
assert.deepEqual(normalized?.selectedFuelTypes, ["ELECTRIC(BOV)"]);
assert.deepEqual(normalized?.selectedVehicleGroups, []);
assert.equal(normalized?.aiProvider, "Ollama");

let remoteFetches = 0;
const remoteEndpoint = await decodeDashboardAiQuery("electric registrations in Delhi", vocabulary, {
  env: { AI_QUERY_PROVIDER: "ollama", OLLAMA_BASE_URL: "https://example.com", ...cloudKeys },
  fetchImpl: async () => {
    remoteFetches += 1;
    throw new Error("A remote endpoint must not be fetched.");
  },
});
assert.equal(remoteFetches, 0);
assert.equal(remoteEndpoint.filters, null);
assert.match(remoteEndpoint.warnings.join(" "), /local HTTP endpoint/i);

const httpsLoopback = await decodeDashboardAiQuery("electric registrations in Delhi", vocabulary, {
  env: { AI_QUERY_PROVIDER: "ollama", OLLAMA_BASE_URL: "https://localhost:11434", ...cloudKeys },
  fetchImpl: async () => {
    remoteFetches += 1;
    throw new Error("An HTTPS loopback endpoint must not be fetched.");
  },
});
assert.equal(remoteFetches, 0);
assert.equal(httpsLoopback.filters, null);
assert.match(httpsLoopback.warnings.join(" "), /local HTTP endpoint/i);

let unavailableFetches = 0;
let boundedTimeout = null;
const unavailable = await decodeDashboardAiQuery("electric registrations in Delhi", vocabulary, {
  env: { AI_QUERY_PROVIDER: "ollama", OLLAMA_TIMEOUT_MS: "60000", ...cloudKeys },
  timeoutSignal: (timeoutMs) => {
    boundedTimeout = timeoutMs;
    return new AbortController().signal;
  },
  fetchImpl: async (url) => {
    unavailableFetches += 1;
    assert.equal(url, "http://127.0.0.1:11434/api/chat");
    throw new Error("Ollama is unavailable.");
  },
});
assert.equal(unavailableFetches, 1, "An Ollama failure must not attempt Gemini or Groq fallback.");
assert.equal(boundedTimeout, 15_000);
assert.equal(unavailable.filters, null);
assert.match(unavailable.warnings.join(" "), /local rules were used/i);

const malformed = await decodeDashboardAiQuery("electric registrations in Delhi", vocabulary, {
  env: { AI_QUERY_PROVIDER: "ollama", ...cloudKeys },
  fetchImpl: async () => ({
    ok: true,
    json: async () => ({ message: { content: "not valid JSON" } }),
  }),
});
assert.equal(malformed.filters, null);
assert.match(malformed.warnings.join(" "), /local rules were used/i);

console.log("Ollama dashboard query provider unit checks passed.");
