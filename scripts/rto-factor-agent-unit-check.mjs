import assert from "node:assert/strict";
import {
  runRtoFactorAgent,
  validationOptionsFromEnv,
  validationPersistenceInput,
} from "../lib/rto-factor-agent.mjs";
import { prepareRtoFactorValidation } from "../lib/rto-factor-events.mjs";
import {
  assertWriteEnabled,
  parseArgs,
} from "./run-rto-factor-agent.mjs";

const event = {
  id: 41,
  title: "State EV incentive",
  reviewStatus: "eligible",
  sourceReliabilityScore: 0.95,
  documents: [
    {
      documentId: 91,
      evidenceRole: "primary",
      document: {
        id: 91,
        title: "Official policy notice",
        publisher: "Transport Department",
        canonicalUrl: "https://transport.example.gov/policy",
        publishedAt: "2026-06-30T00:00:00.000Z",
        evidenceExcerpt: "The policy applies from 1 July 2026.",
        contentHash: "b".repeat(64),
        reviewStatus: "approved",
        source: {
          publisher: "Transport Department",
          sourceTier: "A",
          evidencePolicy: "report_evidence",
        },
      },
    },
  ],
};
const report = {
  id: 501,
  status: "ready",
  batchStatus: "ready",
  revision: 2,
  sourceChecksum: "a".repeat(64),
};
const validation = {
  status: "supported_association",
  eligible: true,
  reasonCodes: ["practical_effect_and_interval_excludes_zero"],
  interpretation: "The timing is consistent with an association and does not establish causation.",
  event: { id: "41" },
  windows: {
    preStart: "2026-06-03",
    preEnd: "2026-06-30",
    postStart: "2026-07-01",
    postEnd: "2026-07-14",
  },
  dataEligibility: { eligible: true },
  evidenceEligibility: { eligible: true, eligibleSourceIds: ["91"] },
  coverage: {
    focal: {
      pre: { ratio: 0.96 },
      post: { ratio: 0.93 },
    },
  },
  peerSelection: {
    selected: Array.from({ length: 5 }, (_, index) => ({
        state: "Gujarat",
        rto: `Control RTO ${index + 1}`,
        score: 0.25 + index * 0.05,
        features: { mean: 31 + index, trend: 0.2 + index * 0.01 },
      })),
  },
  estimate: {
    unit: "registrations_per_day",
    focalPreMean: 40,
    focalChange: 12,
    controlMedianChange: 2,
    effect: 10,
    effectThreshold: 5,
    interval: { lower: 4, upper: 16, level: 0.95 },
  },
  diagnostics: {},
  algorithm: {
    name: "robust_median_difference_in_differences",
    version: "1.0.0",
  },
};

const calls = [];
const dependencies = {
  getEvent: async () => event,
  getReport: async () => report,
  loadDecisionInput: async () => ({
    validationEvent: { id: 41 },
    focalRows: [],
    candidateRows: [],
    asOfDate: "2026-07-14",
    dataContext: { batchStatus: "ready", reportStatus: "ready" },
  }),
  validate: (input) => {
    calls.push({ type: "validate", input });
    return validation;
  },
  buildEvidencePack: (input) => ({ kind: "pack", ...input }),
  draftNarrative: async () => ({
    mode: "deterministic_fallback",
    provider: null,
    attempts: 0,
    narrative: {
      heading: "Possible driver - supported association",
      body: "The observed timing is a possible driver, but the evidence does not prove causation.",
      limitations: ["Short post-event window."],
      citations: [{ id: 91, title: "Official policy notice" }],
    },
  }),
  saveValidation: async (input) => {
    calls.push({ type: "saveValidation", input });
    return { id: 701, ...input };
  },
  saveExplanation: async (input) => {
    calls.push({ type: "saveExplanation", input });
    return { id: 801, ...input };
  },
};

const dryRun = await runRtoFactorAgent({
  eventId: 41,
  reportId: 501,
  dependencies,
  env: {},
});
assert.equal(dryRun.mode, "dry_run");
assert.equal(dryRun.validation.status, "supported_association");
assert.equal(dryRun.narrativeDraft.narrative.citations[0].id, 91);
assert.equal(calls.some((call) => call.type === "saveValidation"), false);

const written = await runRtoFactorAgent({
  eventId: 41,
  reportId: 501,
  write: true,
  dependencies,
  env: {},
});
assert.equal(written.mode, "write");
assert.equal(written.persistedValidation.id, 701);
assert.equal(written.persistedExplanation.id, 801);
const savedExplanation = calls.find((call) => call.type === "saveExplanation").input;
assert.equal(savedExplanation.generationMethod, "template");
assert.deepEqual(savedExplanation.citations, [
  { documentId: 91, citationLabel: "Official policy notice" },
]);

const ollamaExplanationCalls = [];
const ollamaWritten = await runRtoFactorAgent({
  eventId: 41,
  reportId: 501,
  write: true,
  dependencies: {
    ...dependencies,
    draftNarrative: async () => ({
      mode: "llm",
      provider: "Ollama",
      attempts: 1,
      warnings: [],
      narrative: {
        heading: "Possible driver - supported association",
        body: "The observed timing is a possible driver, but the evidence does not prove causation.",
        limitations: ["Short post-event window."],
        citations: [{ id: 91, title: "Official policy notice" }],
      },
    }),
    saveExplanation: async (input) => {
      ollamaExplanationCalls.push(input);
      return { id: 802, ...input };
    },
  },
  env: {
    FACTOR_AGENT_OLLAMA_MODEL: "fixture-ollama-model",
    OLLAMA_FACTOR_MODEL: "ignored-factor-model",
  },
});
assert.equal(ollamaWritten.persistedExplanation.id, 802);
assert.equal(ollamaExplanationCalls[0].generationMethod, "llm");
assert.equal(ollamaExplanationCalls[0].modelProvider, "Ollama");
assert.equal(ollamaExplanationCalls[0].modelName, "fixture-ollama-model");

const persistence = validationPersistenceInput({ event, report, validation });
assert.equal(persistence.preWindowStart, "2026-06-03");
assert.equal(persistence.postWindowEnd, "2026-07-14");
assert.equal(persistence.observedDateCoverage, 0.93);
assert.equal(persistence.controls[0].matchScore, 0.8);
assert.equal(persistence.controls[0].preBaseline, 31);
assert.equal(persistence.algorithmKey, "matched-rto-did");
assert.doesNotThrow(() => prepareRtoFactorValidation(persistence));

assert.deepEqual(
  validationOptionsFromEnv({
    FACTOR_AGENT_MIN_PRE_DAYS: "35",
    FACTOR_AGENT_MIN_POST_DAYS: "21",
    FACTOR_AGENT_MIN_CONTROLS: "7",
    FACTOR_AGENT_MIN_COVERAGE_PCT: "95",
  }),
  {
    preDays: 35,
    postDays: 21,
    minControls: 7,
    minCoverage: 0.95,
  },
);
assert.equal(parseArgs(["--event-id", "41", "--report-id", "501"]).write, false);
assert.equal(
  parseArgs(["--event-id", "41", "--report-id", "501", "--provider", "none", "--write"]).write,
  true,
);
assert.equal(
  parseArgs(["--event-id", "41", "--report-id", "501", "--provider", "ollama"]).provider,
  "ollama",
);
assert.throws(
  () => parseArgs(["--event-id", "41", "--report-id", "501", "--provider", "unknown"]),
  /--provider must be/,
);
assert.throws(
  () => parseArgs(["--event-id", "41", "--report-id", "501", "--write", "--dry-run"]),
  /cannot be combined/,
);
assert.throws(() => assertWriteEnabled({}), /FACTOR_AGENT_ENABLED=1/);
assert.throws(
  () => assertWriteEnabled({ FACTOR_AGENT_ENABLED: "1", FACTOR_AGENT_MODE: "publish" }),
  /FACTOR_AGENT_MODE=draft_only/,
);
assert.doesNotThrow(() => assertWriteEnabled({
  FACTOR_AGENT_ENABLED: "1",
  FACTOR_AGENT_MODE: "draft_only",
}));

await assert.rejects(
  runRtoFactorAgent({
    eventId: 41,
    reportId: 501,
    dependencies: {
      ...dependencies,
      getEvent: async () => ({ ...event, reviewStatus: "pending" }),
    },
  }),
  (error) => error.code === "event_not_eligible",
);

console.log("RTO factor agent orchestration checks passed.");
