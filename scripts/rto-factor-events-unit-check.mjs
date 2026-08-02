import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareRtoFactorDocument,
  prepareRtoFactorEvent,
  prepareRtoFactorSource,
  prepareRtoFactorValidation,
  prepareRtoReportExplanation,
  prepareRtoReportExplanationReview,
} from "../lib/rto-factor-events.mjs";

const reportChecksum = "a".repeat(64);
const reviewedAt = "2026-07-25T12:00:00.000Z";

const source = prepareRtoFactorSource({
  sourceKey: "pib-gov-in",
  publisher: "Press Information Bureau",
  sourceTier: "A",
  sourceType: "government",
  canonicalHost: "www.pib.gov.in",
  createdByLabel: "unit-check",
});
assert.equal(source.evidencePolicy, "report_evidence");
assert.match(source.recordChecksum, /^[0-9a-f]{64}$/);
assert.equal(
  prepareRtoFactorSource({
    sourceKey: "pib-gov-in",
    publisher: "Press Information Bureau",
    sourceTier: "A",
    sourceType: "government",
    canonicalHost: "www.pib.gov.in",
    createdByLabel: "unit-check",
  }).idempotencyKey,
  source.idempotencyKey,
  "default idempotency must be deterministic",
);
assert.throws(
  () => prepareRtoFactorSource({
    sourceKey: "news-example",
    publisher: "Example News",
    sourceTier: "C",
    sourceType: "media",
    canonicalHost: "news.example.com",
    evidencePolicy: "report_evidence",
  }),
  /Tier C sources are lead-only/,
);

const documentInput = {
  sourceId: 1,
  canonicalUrl: "https://www.pib.gov.in/example-release#section",
  title: "Official EV incentive update",
  publishedAt: "2026-07-20T06:30:00.000Z",
  evidenceExcerpt: "The revised incentive becomes effective on 25 July 2026.",
  reviewStatus: "approved",
  reviewedAt,
  reviewedByLabel: "admin@example.com",
  createdByLabel: "admin@example.com",
};
const document = prepareRtoFactorDocument(documentInput);
assert.equal(document.canonicalUrl, "https://www.pib.gov.in/example-release");
assert.equal(document.canonicalHost, "www.pib.gov.in");
assert.equal(document.contentHashMethod, "evidence_snapshot_sha256");
assert.equal(document.retrievedAt, null);
assert.equal(
  prepareRtoFactorDocument(documentInput).idempotencyKey,
  document.idempotencyKey,
  "omitting retrievedAt must not break retry idempotency",
);
assert.throws(
  () => prepareRtoFactorDocument({
    ...documentInput,
    reviewStatus: "pending",
  }),
  /Pending documents cannot include review fields/,
);

const eventInput = {
  eventType: "incentive",
  title: "State EV incentive revision",
  claimSummary: "The state revised its EV purchase incentive.",
  hypothesis: "The incentive may lift EV two-wheeler registrations in the affected RTO.",
  expectedDirection: "increase",
  effectiveStart: "2026-07-25",
  reviewStatus: "eligible",
  sourceReliabilityScore: 0.95,
  reviewedAt,
  reviewedByLabel: "admin@example.com",
  documents: [{ documentId: 10, evidenceRole: "primary" }],
  targets: [{
    geographyScope: "rto",
    state: "Karnataka",
    rto: "Bengaluru Central RTO - KA01",
    fuelGroup: "EV",
    vehicleCategory: "2W",
  }],
  createdByLabel: "admin@example.com",
};
const event = prepareRtoFactorEvent(eventInput);
assert.equal(event.effectiveEnd, "2026-07-25");
assert.equal(event.targets[0].targetRole, "affected");
assert.equal(event.targets[0].fuelGroup, "EV");
assert.equal(
  prepareRtoFactorEvent(eventInput).eventChecksum,
  event.eventChecksum,
  "event checksums must be stable",
);
assert.throws(
  () => prepareRtoFactorEvent({
    ...eventInput,
    targets: [{ geographyScope: "national", state: "Karnataka" }],
  }),
  /National targets cannot include state/,
);

const controls = Array.from({ length: 5 }, (_, index) => ({
  state: "Karnataka",
  rto: `Control RTO ${index + 1}`,
  matchScore: 0.9 - index * 0.02,
  preBaseline: 100 + index,
  preTrend: 0.1,
  exposureStatus: "unexposed",
}));
const validationInput = {
  eventId: 20,
  reportId: 30,
  reportRevision: 2,
  reportSourceChecksum: reportChecksum,
  decisionStatus: "supported_association",
  algorithmKey: "matched-rto-did",
  algorithmVersion: "1.0.0",
  preWindowStart: "2026-06-27",
  preWindowEnd: "2026-07-24",
  postWindowStart: "2026-07-25",
  postWindowEnd: "2026-08-07",
  baselineValue: 100,
  focalChange: 40,
  controlChange: 3,
  effectSize: 37,
  effectUnit: "registrations_per_day",
  confidenceIntervalLow: 12,
  confidenceIntervalHigh: 54,
  materialityThreshold: 10,
  observedDateCoverage: 0.95,
  sourceReliabilityScore: 0.95,
  hypothesisConfidenceScore: 0.7,
  empiricalSupportScore: 0.9,
  qualityGates: { reportReady: true, noLateFill: true },
  evidencePack: { focalDailyAverageBefore: 100, focalDailyAverageAfter: 140 },
  limitations: ["Association does not establish causation."],
  controls,
  documents: [{ documentId: 10, evidenceRole: "primary" }],
};
const validation = prepareRtoFactorValidation(validationInput);
assert.equal(validation.controlCount, 5);
assert.match(validation.inputChecksum, /^[0-9a-f]{64}$/);
assert.equal(
  prepareRtoFactorValidation(validationInput).validationChecksum,
  validation.validationChecksum,
);
assert.throws(
  () => prepareRtoFactorValidation({ ...validationInput, controls: controls.slice(0, 4) }),
  /at least five unexposed controls/,
);
assert.throws(
  () => prepareRtoFactorValidation({
    ...validationInput,
    confidenceIntervalLow: -2,
  }),
  /confidence interval must exclude zero/,
);

const explanationInput = {
  validationId: 40,
  heading: "Possible driver: revised EV incentive",
  body: "Registrations increased above the matched-RTO trend after the cited incentive revision. This is an association, not proof of causation.",
  confidenceLabel: "supported",
  limitations: ["A concurrent local campaign may also have contributed."],
  generationMethod: "template",
  promptVersion: "factor-narrative-v1",
  citations: [{ documentId: 10, citationLabel: "Official incentive notice" }],
  createdByLabel: "factor-agent",
};
const explanation = prepareRtoReportExplanation(explanationInput);
assert.equal(explanation.publicationMode, "draft_only");
assert.equal(explanation.citations[0].citationOrder, 1);
assert.equal(
  prepareRtoReportExplanation(explanationInput).explanationChecksum,
  explanation.explanationChecksum,
);
assert.throws(
  () => prepareRtoReportExplanation({
    ...explanationInput,
    generationMethod: "llm",
  }),
  /require modelProvider and modelName/,
);

const approvedReview = prepareRtoReportExplanationReview({
  explanationId: 50,
  decision: "approved",
  reviewerLabel: "admin@example.com",
});
assert.equal(approvedReview.decision, "approved");
assert.notEqual(
  approvedReview.idempotencyKey,
  prepareRtoReportExplanationReview({
    explanationId: 51,
    decision: "approved",
    reviewerLabel: "admin@example.com",
  }).idempotencyKey,
  "review idempotency must be scoped to one explanation",
);
assert.throws(
  () => prepareRtoReportExplanationReview({
    explanationId: 50,
    decision: "rejected",
    reviewerLabel: "admin@example.com",
  }),
  /requires a reason/,
);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.resolve(scriptDirectory, "../db/schema.sql"), "utf8");
const expectedTables = [
  "rto_factor_sources",
  "rto_factor_documents",
  "rto_factor_events",
  "rto_factor_event_documents",
  "rto_factor_event_targets",
  "rto_factor_validations",
  "rto_factor_validation_controls",
  "rto_factor_validation_documents",
  "rto_report_explanations",
  "rto_report_explanation_documents",
  "rto_report_explanation_reviews",
];
for (const table of expectedTables) {
  assert.match(schema, new RegExp(`create table if not exists ${table}\\b`));
  assert.match(schema, new RegExp(`${table.replace(/^rto_/, "rto_")}.*append_only`, "s"));
}
assert.match(schema, /publication_mode = 'draft_only'/);
assert.match(schema, /unique \(id, report_id, report_revision, report_source_checksum\)/);
assert.match(schema, /references rto_factor_validations \(id, report_id, report_revision, report_source_checksum\)/);
assert.match(schema, /decision_status <> 'supported_association'[\s\S]*control_count >= 5/);
assert.match(schema, /prevent_rto_factor_record_mutation/);

console.log("RTO factor persistence checks passed.");
