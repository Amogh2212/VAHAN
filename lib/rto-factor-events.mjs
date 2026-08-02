import crypto from "node:crypto";
import { query, transaction } from "./db.mjs";

export const RTO_FACTOR_SOURCE_TIERS = ["A", "B", "C", "D"];
export const RTO_FACTOR_EVENT_REVIEW_STATUSES = ["pending", "eligible", "context_only", "rejected"];
export const RTO_FACTOR_VALIDATION_STATUSES = [
  "too_early",
  "blocked_data",
  "blocked_evidence",
  "confounded",
  "no_effect",
  "mixed_evidence",
  "supported_association",
];
export const RTO_REPORT_EXPLANATION_DECISIONS = [
  "approved",
  "edited_and_approved",
  "rejected",
  "needs_more_data",
  "revoked",
];

const SOURCE_TYPES = new Set([
  "government",
  "regulator",
  "weather_authority",
  "transport_authority",
  "stock_exchange",
  "oem",
  "industry_body",
  "media",
  "other",
]);
const SOURCE_POLICIES = new Set(["report_evidence", "lead_only", "prohibited"]);
const DOCUMENT_REVIEW_STATUSES = new Set(["pending", "approved", "rejected"]);
const EVENT_TYPES = new Set([
  "policy",
  "tax_or_fee",
  "incentive",
  "oem_launch",
  "oem_price_change",
  "oem_promotion",
  "weather_disruption",
  "transport_restriction",
  "other_official",
]);
const EVENT_REVIEW_STATUSES = new Set(RTO_FACTOR_EVENT_REVIEW_STATUSES);
const EVIDENCE_ROLES = new Set(["primary", "corroborating", "confounder"]);
const VALIDATION_STATUSES = new Set(RTO_FACTOR_VALIDATION_STATUSES);
const EXPLANATION_CONFIDENCE_LABELS = new Set([
  "supported",
  "mixed_evidence",
  "weak",
  "too_early",
  "contradicted_by_data",
  "blocked",
]);
const EXPLANATION_DECISIONS = new Set(RTO_REPORT_EXPLANATION_DECISIONS);
const APPROVAL_DECISIONS = new Set(["approved", "edited_and_approved"]);
const EVIDENCE_DECISIONS = new Set(["mixed_evidence", "supported_association"]);
const CONFIDENCE_BY_VALIDATION = new Map([
  ["too_early", "too_early"],
  ["blocked_data", "blocked"],
  ["blocked_evidence", "blocked"],
  ["confounded", "weak"],
  ["no_effect", "contradicted_by_data"],
  ["mixed_evidence", "mixed_evidence"],
  ["supported_association", "supported"],
]);

export function prepareRtoFactorSource(input = {}) {
  const sourceTier = enumValue(input.sourceTier, RTO_FACTOR_SOURCE_TIERS, "sourceTier");
  const evidencePolicy = input.evidencePolicy ?? defaultEvidencePolicy(sourceTier);
  if (!SOURCE_POLICIES.has(evidencePolicy)) throw inputError("evidencePolicy is invalid");
  if (sourceTier === "C" && evidencePolicy !== "lead_only") {
    throw inputError("Tier C sources are lead-only");
  }
  if (sourceTier === "D" && evidencePolicy !== "prohibited") {
    throw inputError("Tier D sources are prohibited as report evidence");
  }
  if (["A", "B"].includes(sourceTier) && evidencePolicy === "prohibited") {
    throw inputError("Tier A/B sources must be report evidence or lead-only");
  }

  const source = {
    sourceKey: requiredPattern(
      input.sourceKey,
      "sourceKey",
      /^[a-z0-9][a-z0-9._-]{2,127}$/,
      "lowercase letters, numbers, dot, underscore, and hyphen only",
    ),
    publisher: boundedText(input.publisher, "publisher", 2, 300),
    sourceTier,
    sourceType: enumValue(input.sourceType, SOURCE_TYPES, "sourceType"),
    canonicalHost: canonicalHost(input.canonicalHost),
    evidencePolicy,
    intakeMethod: enumValue(input.intakeMethod ?? "manual", ["manual", "curated_import"], "intakeMethod"),
    notes: optionalText(input.notes, 4000),
    supersedesSourceId: optionalId(input.supersedesSourceId, "supersedesSourceId"),
    createdByUserId: optionalId(input.createdByUserId, "createdByUserId"),
    createdByLabel: boundedText(input.createdByLabel ?? "system", "createdByLabel", 1, 200),
  };
  source.recordChecksum = checksum(source);
  source.idempotencyKey = idempotencyKey(
    input.idempotencyKey,
    `rto-factor-source:${source.recordChecksum}`,
  );
  return source;
}

export function prepareRtoFactorDocument(input = {}) {
  const reviewStatus = enumValue(
    input.reviewStatus ?? "pending",
    DOCUMENT_REVIEW_STATUSES,
    "reviewStatus",
  );
  const canonical = canonicalHttpsUrl(input.canonicalUrl);
  const document = {
    sourceId: requiredId(input.sourceId, "sourceId"),
    canonicalUrl: canonical.url,
    canonicalHost: canonical.host,
    title: boundedText(input.title, "title", 2, 500),
    publishedAt: requiredIsoTimestamp(input.publishedAt, "publishedAt"),
    retrievedAt: input.retrievedAt
      ? requiredIsoTimestamp(input.retrievedAt, "retrievedAt")
      : null,
    evidenceExcerpt: boundedText(input.evidenceExcerpt, "evidenceExcerpt", 1, 4000),
    contentHashMethod: enumValue(
      input.contentHashMethod ?? (input.contentHash ? "full_content_sha256" : "evidence_snapshot_sha256"),
      ["full_content_sha256", "evidence_snapshot_sha256"],
      "contentHashMethod",
    ),
    reviewStatus,
    reviewReason: optionalText(input.reviewReason, 2000),
    reviewedAt: input.reviewedAt ? requiredIsoTimestamp(input.reviewedAt, "reviewedAt") : null,
    reviewedByUserId: optionalId(input.reviewedByUserId, "reviewedByUserId"),
    reviewedByLabel: optionalText(input.reviewedByLabel, 200),
    metadata: objectValue(input.metadata, "metadata"),
    supersedesDocumentId: optionalId(input.supersedesDocumentId, "supersedesDocumentId"),
    createdByUserId: optionalId(input.createdByUserId, "createdByUserId"),
    createdByLabel: boundedText(input.createdByLabel ?? "system", "createdByLabel", 1, 200),
  };
  assertImmutableReviewFields(document, "document");
  document.contentHash = hashValue(
    input.contentHash,
    {
      canonicalUrl: document.canonicalUrl,
      title: document.title,
      publishedAt: document.publishedAt,
      evidenceExcerpt: document.evidenceExcerpt,
    },
    "contentHash",
  );
  document.recordChecksum = checksum(document);
  document.idempotencyKey = idempotencyKey(
    input.idempotencyKey,
    `rto-factor-document:${document.recordChecksum}`,
  );
  return document;
}

export function prepareRtoFactorEvent(input = {}) {
  const reviewStatus = enumValue(
    input.reviewStatus ?? "pending",
    EVENT_REVIEW_STATUSES,
    "reviewStatus",
  );
  const documents = normalizeEvidenceDocuments(input.documents);
  if (!documents.some((item) => item.evidenceRole === "primary")) {
    throw inputError("At least one primary source document is required");
  }
  const targets = normalizeEventTargets(input.targets);
  if (!targets.some((target) => target.targetRole === "affected")) {
    throw inputError("At least one affected target is required");
  }

  const event = {
    eventType: enumValue(input.eventType, EVENT_TYPES, "eventType"),
    title: boundedText(input.title, "title", 2, 500),
    claimSummary: boundedText(input.claimSummary, "claimSummary", 5, 4000),
    hypothesis: boundedText(input.hypothesis, "hypothesis", 5, 4000),
    expectedDirection: enumValue(
      input.expectedDirection ?? "unknown",
      ["increase", "decrease", "unknown"],
      "expectedDirection",
    ),
    effectiveStart: dateOnly(input.effectiveStart, "effectiveStart"),
    effectiveEnd: dateOnly(input.effectiveEnd ?? input.effectiveStart, "effectiveEnd"),
    eventTimezone: input.eventTimezone ?? "Asia/Kolkata",
    reviewStatus,
    sourceReliabilityScore: score(input.sourceReliabilityScore, "sourceReliabilityScore"),
    reviewReason: optionalText(input.reviewReason, 2000),
    reviewedAt: input.reviewedAt ? requiredIsoTimestamp(input.reviewedAt, "reviewedAt") : null,
    reviewedByUserId: optionalId(input.reviewedByUserId, "reviewedByUserId"),
    reviewedByLabel: optionalText(input.reviewedByLabel, 200),
    intakeMethod: enumValue(input.intakeMethod ?? "manual", ["manual", "curated_import"], "intakeMethod"),
    metadata: objectValue(input.metadata, "metadata"),
    supersedesEventId: optionalId(input.supersedesEventId, "supersedesEventId"),
    createdByUserId: optionalId(input.createdByUserId, "createdByUserId"),
    createdByLabel: boundedText(input.createdByLabel ?? "system", "createdByLabel", 1, 200),
    documents,
    targets,
  };
  if (event.eventTimezone !== "Asia/Kolkata") {
    throw inputError("eventTimezone must be Asia/Kolkata");
  }
  if (event.effectiveEnd < event.effectiveStart) {
    throw inputError("effectiveEnd must be on or after effectiveStart");
  }
  assertImmutableReviewFields(event, "event");
  event.eventChecksum = checksum(event);
  event.idempotencyKey = idempotencyKey(
    input.idempotencyKey,
    `rto-factor-event:${event.eventChecksum}`,
  );
  return event;
}

export function prepareRtoFactorValidation(input = {}) {
  const decisionStatus = enumValue(input.decisionStatus, VALIDATION_STATUSES, "decisionStatus");
  const controls = normalizeValidationControls(input.controls);
  const documents = normalizeEvidenceDocuments(input.documents);
  const unexposedControlCount = controls.filter((control) => control.exposureStatus === "unexposed").length;
  const validation = {
    eventId: requiredId(input.eventId, "eventId"),
    reportId: requiredId(input.reportId, "reportId"),
    reportRevision: requiredPositiveInteger(input.reportRevision, "reportRevision"),
    reportSourceChecksum: requiredHash(input.reportSourceChecksum, "reportSourceChecksum"),
    decisionStatus,
    algorithmKey: boundedText(input.algorithmKey, "algorithmKey", 2, 100),
    algorithmVersion: boundedText(input.algorithmVersion, "algorithmVersion", 1, 100),
    preWindowStart: dateOnly(input.preWindowStart, "preWindowStart"),
    preWindowEnd: dateOnly(input.preWindowEnd, "preWindowEnd"),
    postWindowStart: dateOnly(input.postWindowStart, "postWindowStart"),
    postWindowEnd: dateOnly(input.postWindowEnd, "postWindowEnd"),
    baselineValue: optionalNonNegative(input.baselineValue, "baselineValue"),
    focalChange: optionalFinite(input.focalChange, "focalChange"),
    controlChange: optionalFinite(input.controlChange, "controlChange"),
    effectSize: optionalFinite(input.effectSize, "effectSize"),
    effectUnit: input.effectUnit
      ? enumValue(
        input.effectUnit,
        ["registrations_per_day", "percent", "percentage_points"],
        "effectUnit",
      )
      : null,
    confidenceIntervalLow: optionalFinite(input.confidenceIntervalLow, "confidenceIntervalLow"),
    confidenceIntervalHigh: optionalFinite(input.confidenceIntervalHigh, "confidenceIntervalHigh"),
    materialityThreshold: optionalNonNegative(input.materialityThreshold, "materialityThreshold"),
    controlCount: unexposedControlCount,
    observedDateCoverage: score(input.observedDateCoverage, "observedDateCoverage"),
    sourceReliabilityScore: score(input.sourceReliabilityScore, "sourceReliabilityScore"),
    hypothesisConfidenceScore: score(input.hypothesisConfidenceScore, "hypothesisConfidenceScore"),
    empiricalSupportScore: score(input.empiricalSupportScore, "empiricalSupportScore"),
    qualityGates: objectValue(input.qualityGates, "qualityGates"),
    evidencePack: objectValue(input.evidencePack, "evidencePack"),
    limitations: stringArray(input.limitations, "limitations"),
    controls,
    documents,
  };
  assertOrderedWindows(validation);
  if (
    validation.confidenceIntervalLow !== null
    && validation.confidenceIntervalHigh !== null
    && validation.confidenceIntervalLow > validation.confidenceIntervalHigh
  ) {
    throw inputError("confidenceIntervalLow must not exceed confidenceIntervalHigh");
  }
  if (EVIDENCE_DECISIONS.has(decisionStatus)) {
    if (unexposedControlCount < 5) {
      throw inputError(`${decisionStatus} requires at least five unexposed controls`);
    }
    if (validation.observedDateCoverage < 0.9) {
      throw inputError(`${decisionStatus} requires at least 90% observed-date coverage`);
    }
    if (
      daysInclusive(validation.preWindowStart, validation.preWindowEnd) < 28
      || daysInclusive(validation.postWindowStart, validation.postWindowEnd) < 14
      || addDays(validation.preWindowEnd, 1) !== validation.postWindowStart
    ) {
      throw inputError(`${decisionStatus} requires contiguous windows with at least 28 pre days and 14 post days`);
    }
    if (validation.algorithmKey !== "matched-rto-did") {
      throw inputError(`${decisionStatus} requires the matched-rto-did algorithm`);
    }
    if (!documents.some((item) => item.evidenceRole === "primary")) {
      throw inputError(`${decisionStatus} requires at least one primary evidence document`);
    }
  }
  if (decisionStatus === "supported_association") {
    assertSupportedEffect(validation);
  }
  const calculatedInputChecksum = checksum({
    eventId: validation.eventId,
    reportId: validation.reportId,
    reportRevision: validation.reportRevision,
    reportSourceChecksum: validation.reportSourceChecksum,
    windows: {
      preStart: validation.preWindowStart,
      preEnd: validation.preWindowEnd,
      postStart: validation.postWindowStart,
      postEnd: validation.postWindowEnd,
    },
    algorithmKey: validation.algorithmKey,
    algorithmVersion: validation.algorithmVersion,
    observedDateCoverage: validation.observedDateCoverage,
    baselineValue: validation.baselineValue,
    focalChange: validation.focalChange,
    controlChange: validation.controlChange,
    effectSize: validation.effectSize,
    effectUnit: validation.effectUnit,
    confidenceIntervalLow: validation.confidenceIntervalLow,
    confidenceIntervalHigh: validation.confidenceIntervalHigh,
    materialityThreshold: validation.materialityThreshold,
    controls,
    documents,
    qualityGates: validation.qualityGates,
    evidencePack: validation.evidencePack,
  });
  validation.inputChecksum = input.inputChecksum
    ? requiredHash(input.inputChecksum, "inputChecksum")
    : calculatedInputChecksum;
  validation.validationChecksum = checksum(validation);
  validation.idempotencyKey = idempotencyKey(
    input.idempotencyKey,
    `rto-factor-validation:${validation.validationChecksum}`,
  );
  return validation;
}

export function prepareRtoReportExplanation(input = {}) {
  const generationMethod = enumValue(
    input.generationMethod,
    ["llm", "template", "manual"],
    "generationMethod",
  );
  const modelProvider = optionalText(input.modelProvider, 200);
  const modelName = optionalText(input.modelName, 200);
  if (generationMethod === "llm" && (!modelProvider || !modelName)) {
    throw inputError("LLM explanations require modelProvider and modelName");
  }
  const citations = normalizeCitations(input.citations);
  if (!citations.length) throw inputError("At least one citation document is required");
  const explanation = {
    validationId: requiredId(input.validationId, "validationId"),
    heading: boundedText(input.heading, "heading", 2, 300),
    body: boundedText(input.body, "body", 5, 4000),
    confidenceLabel: enumValue(
      input.confidenceLabel,
      EXPLANATION_CONFIDENCE_LABELS,
      "confidenceLabel",
    ),
    limitations: stringArray(input.limitations, "limitations"),
    generationMethod,
    modelProvider,
    modelName,
    promptVersion: boundedText(input.promptVersion, "promptVersion", 1, 100),
    publicationMode: "draft_only",
    createdByUserId: optionalId(input.createdByUserId, "createdByUserId"),
    createdByLabel: boundedText(input.createdByLabel ?? "system", "createdByLabel", 1, 200),
    citations,
  };
  explanation.inputChecksum = input.inputChecksum
    ? requiredHash(input.inputChecksum, "inputChecksum")
    : checksum({
      validationId: explanation.validationId,
      promptVersion: explanation.promptVersion,
      citations,
    });
  explanation.outputChecksum = checksum({
    heading: explanation.heading,
    body: explanation.body,
    confidenceLabel: explanation.confidenceLabel,
    limitations: explanation.limitations,
  });
  explanation.explanationChecksum = checksum(explanation);
  explanation.idempotencyKey = idempotencyKey(
    input.idempotencyKey,
    `rto-report-explanation:${explanation.explanationChecksum}`,
  );
  return explanation;
}

export function prepareRtoReportExplanationReview(input = {}) {
  const decision = enumValue(input.decision, EXPLANATION_DECISIONS, "decision");
  const review = {
    explanationId: optionalId(input.explanationId, "explanationId"),
    decision,
    editedHeading: optionalText(input.editedHeading, 300),
    editedBody: optionalText(input.editedBody, 4000),
    reason: optionalText(input.reason, 2000),
    reviewerUserId: optionalId(input.reviewerUserId, "reviewerUserId"),
    reviewerLabel: boundedText(input.reviewerLabel, "reviewerLabel", 1, 200),
  };
  if (decision === "approved" && (review.editedHeading || review.editedBody || review.reason)) {
    throw inputError("approved reviews cannot include edits or a reason");
  }
  if (decision === "edited_and_approved" && (!review.editedHeading || !review.editedBody || review.reason)) {
    throw inputError("edited_and_approved requires editedHeading and editedBody, without a reason");
  }
  if (
    ["rejected", "needs_more_data", "revoked"].includes(decision)
    && (review.editedHeading || review.editedBody || !review.reason)
  ) {
    throw inputError(`${decision} requires a reason and cannot include edited copy`);
  }
  review.reviewChecksum = checksum(review);
  review.idempotencyKey = idempotencyKey(
    input.idempotencyKey,
    `rto-report-explanation-review:${review.reviewChecksum}`,
  );
  return review;
}

export async function createRtoFactorSource(input = {}) {
  const source = prepareRtoFactorSource(input);
  return transaction(async (tx) => {
    if (source.supersedesSourceId) {
      await requireRow(tx, "select id from rto_factor_sources where id = $1", [source.supersedesSourceId], "Superseded source");
    }
    const result = await tx(
      `
        insert into rto_factor_sources (
          source_key, publisher, source_tier, source_type, canonical_host,
          evidence_policy, intake_method, notes, idempotency_key, record_checksum,
          supersedes_source_id, created_by_user_id, created_by_label
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        on conflict (idempotency_key) do nothing
        returning *
      `,
      [
        source.sourceKey,
        source.publisher,
        source.sourceTier,
        source.sourceType,
        source.canonicalHost,
        source.evidencePolicy,
        source.intakeMethod,
        source.notes,
        source.idempotencyKey,
        source.recordChecksum,
        source.supersedesSourceId,
        source.createdByUserId,
        source.createdByLabel,
      ],
    );
    const row = result.rows[0] ?? await rowByIdempotencyKey(tx, "rto_factor_sources", source.idempotencyKey);
    assertIdempotentRecord(row, "record_checksum", source.recordChecksum, "source");
    return normalizeSource(row);
  });
}

export async function getRtoFactorSource(id) {
  const result = await query("select * from rto_factor_sources where id = $1", [requiredId(id, "id")]);
  return result.rows[0] ? normalizeSource(result.rows[0]) : null;
}

export async function listRtoFactorSources({
  sourceTier = null,
  evidencePolicy = null,
  limit = 100,
  offset = 0,
} = {}) {
  const values = [];
  const clauses = [];
  addFilter(values, clauses, "source_tier", sourceTier);
  addFilter(values, clauses, "evidence_policy", evidencePolicy);
  values.push(boundedLimit(limit, 200));
  const limitParam = `$${values.length}`;
  values.push(nonNegativeInteger(offset, "offset"));
  const offsetParam = `$${values.length}`;
  const result = await query(
    `
      select *
      from rto_factor_sources
      ${whereClause(clauses)}
      order by created_at desc, id desc
      limit ${limitParam}
      offset ${offsetParam}
    `,
    values,
  );
  return result.rows.map(normalizeSource);
}

export async function createRtoFactorDocument(input = {}) {
  const document = prepareRtoFactorDocument(input);
  return transaction(async (tx) => {
    const source = await requireRow(
      tx,
      "select * from rto_factor_sources where id = $1",
      [document.sourceId],
      "Factor source",
    );
    if (source.canonical_host !== document.canonicalHost) {
      throw inputError(`Document host must exactly match the source allowlist host ${source.canonical_host}`);
    }
    if (document.reviewStatus === "approved" && source.evidence_policy !== "report_evidence") {
      throw inputError("Only a report-evidence source can create an approved document");
    }
    if (document.supersedesDocumentId) {
      const superseded = await requireRow(
        tx,
        "select source_id from rto_factor_documents where id = $1",
        [document.supersedesDocumentId],
        "Superseded document",
      );
      if (Number(superseded.source_id) !== document.sourceId) {
        throw inputError("A document can only supersede a document from the same source");
      }
    }
    const result = await tx(
      `
        insert into rto_factor_documents (
          source_id, canonical_url, title, published_at, retrieved_at,
          evidence_excerpt, content_hash, content_hash_method, review_status,
          review_reason, reviewed_at, reviewed_by_user_id, reviewed_by_label,
          metadata, idempotency_key, record_checksum, supersedes_document_id,
          created_by_user_id, created_by_label
        )
        values (
          $1,$2,$3,$4,coalesce($5::timestamptz, now()),$6,$7,$8,$9,$10,$11,$12,$13,
          $14::jsonb,$15,$16,$17,$18,$19
        )
        on conflict (idempotency_key) do nothing
        returning id
      `,
      [
        document.sourceId,
        document.canonicalUrl,
        document.title,
        document.publishedAt,
        document.retrievedAt,
        document.evidenceExcerpt,
        document.contentHash,
        document.contentHashMethod,
        document.reviewStatus,
        document.reviewReason,
        document.reviewedAt,
        document.reviewedByUserId,
        document.reviewedByLabel,
        JSON.stringify(document.metadata),
        document.idempotencyKey,
        document.recordChecksum,
        document.supersedesDocumentId,
        document.createdByUserId,
        document.createdByLabel,
      ],
    );
    const id = result.rows[0]?.id
      ?? (await rowByIdempotencyKey(tx, "rto_factor_documents", document.idempotencyKey)).id;
    const row = await loadDocumentWithQuery(tx, id);
    assertIdempotentRecord(row, "record_checksum", document.recordChecksum, "document");
    return normalizeDocument(row, row.source);
  });
}

export async function getRtoFactorDocument(id) {
  const row = await loadDocumentWithQuery(query, requiredId(id, "id"));
  return row ? normalizeDocument(row, row.source) : null;
}

export async function listRtoFactorDocuments({
  sourceId = null,
  reviewStatus = null,
  limit = 100,
  offset = 0,
} = {}) {
  const values = [];
  const clauses = [];
  if (sourceId !== null && sourceId !== undefined) {
    addFilter(values, clauses, "d.source_id", requiredId(sourceId, "sourceId"));
  }
  addFilter(values, clauses, "d.review_status", reviewStatus);
  values.push(boundedLimit(limit, 200));
  const limitParam = `$${values.length}`;
  values.push(nonNegativeInteger(offset, "offset"));
  const offsetParam = `$${values.length}`;
  const result = await query(
    `
      select d.*, to_jsonb(s) as source
      from rto_factor_documents d
      join rto_factor_sources s on s.id = d.source_id
      ${whereClause(clauses)}
      order by d.published_at desc, d.id desc
      limit ${limitParam}
      offset ${offsetParam}
    `,
    values,
  );
  return result.rows.map((row) => normalizeDocument(row, row.source));
}

export async function createRtoFactorEvent(input = {}) {
  const event = prepareRtoFactorEvent(input);
  const eventId = await transaction(async (tx) => {
    if (event.supersedesEventId) {
      await requireRow(tx, "select id from rto_factor_events where id = $1", [event.supersedesEventId], "Superseded event");
    }
    const evidenceRows = await loadEventInputDocuments(tx, event.documents);
    assertEventEvidenceEligibility(event, evidenceRows);

    const result = await tx(
      `
        insert into rto_factor_events (
          event_type, title, claim_summary, hypothesis, expected_direction,
          effective_start, effective_end, event_timezone, review_status,
          source_reliability_score, review_reason, reviewed_at,
          reviewed_by_user_id, reviewed_by_label, intake_method, metadata,
          idempotency_key, event_checksum, supersedes_event_id,
          created_by_user_id, created_by_label
        )
        values (
          $1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,
          $16::jsonb,$17,$18,$19,$20,$21
        )
        on conflict (idempotency_key) do nothing
        returning id, event_checksum
      `,
      [
        event.eventType,
        event.title,
        event.claimSummary,
        event.hypothesis,
        event.expectedDirection,
        event.effectiveStart,
        event.effectiveEnd,
        event.eventTimezone,
        event.reviewStatus,
        event.sourceReliabilityScore,
        event.reviewReason,
        event.reviewedAt,
        event.reviewedByUserId,
        event.reviewedByLabel,
        event.intakeMethod,
        JSON.stringify(event.metadata),
        event.idempotencyKey,
        event.eventChecksum,
        event.supersedesEventId,
        event.createdByUserId,
        event.createdByLabel,
      ],
    );
    const existing = result.rows[0]
      ?? await rowByIdempotencyKey(tx, "rto_factor_events", event.idempotencyKey);
    assertIdempotentRecord(existing, "event_checksum", event.eventChecksum, "event");
    if (!result.rows[0]) return Number(existing.id);

    for (const document of event.documents) {
      await tx(
        `
          insert into rto_factor_event_documents (event_id, document_id, evidence_role)
          values ($1,$2,$3)
        `,
        [existing.id, document.documentId, document.evidenceRole],
      );
    }
    for (const target of event.targets) {
      await tx(
        `
          insert into rto_factor_event_targets (
            event_id, target_role, geography_scope, state, rto, oem,
            fuel_group, vehicle_category
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          existing.id,
          target.targetRole,
          target.geographyScope,
          target.state,
          target.rto,
          target.oem,
          target.fuelGroup,
          target.vehicleCategory,
        ],
      );
    }
    return Number(existing.id);
  });
  return getRtoFactorEvent(eventId);
}

export async function getRtoFactorEvent(id) {
  const eventId = requiredId(id, "id");
  return transaction(async (tx) => loadEventWithQuery(tx, eventId));
}

export async function listRtoFactorEvents({
  reviewStatus = null,
  eventType = null,
  state = null,
  rto = null,
  effectiveFrom = null,
  effectiveTo = null,
  limit = 100,
  offset = 0,
} = {}) {
  const values = [];
  const clauses = [];
  addFilter(values, clauses, "e.review_status", reviewStatus);
  addFilter(values, clauses, "e.event_type", eventType);
  if (effectiveFrom) {
    values.push(dateOnly(effectiveFrom, "effectiveFrom"));
    clauses.push(`e.effective_end >= $${values.length}::date`);
  }
  if (effectiveTo) {
    values.push(dateOnly(effectiveTo, "effectiveTo"));
    clauses.push(`e.effective_start <= $${values.length}::date`);
  }
  if (state || rto) {
    const targetClauses = [];
    if (state) {
      values.push(boundedText(state, "state", 1, 300));
      targetClauses.push(`t.state = $${values.length}`);
    }
    if (rto) {
      values.push(boundedText(rto, "rto", 1, 500));
      targetClauses.push(`t.rto = $${values.length}`);
    }
    clauses.push(
      `exists (
        select 1 from rto_factor_event_targets t
        where t.event_id = e.id and ${targetClauses.join(" and ")}
      )`,
    );
  }
  values.push(boundedLimit(limit, 200));
  const limitParam = `$${values.length}`;
  values.push(nonNegativeInteger(offset, "offset"));
  const offsetParam = `$${values.length}`;
  const result = await query(
    `
      select e.*,
             (select count(*)::int from rto_factor_event_documents ed where ed.event_id = e.id) as document_count,
             (select count(*)::int from rto_factor_event_targets et where et.event_id = e.id) as target_count
      from rto_factor_events e
      ${whereClause(clauses)}
      order by e.effective_start desc, e.id desc
      limit ${limitParam}
      offset ${offsetParam}
    `,
    values,
  );
  return result.rows.map((row) => ({
    ...normalizeEvent(row),
    documentCount: Number(row.document_count ?? 0),
    targetCount: Number(row.target_count ?? 0),
  }));
}

export async function saveRtoFactorValidation(input = {}) {
  const validation = prepareRtoFactorValidation(input);
  const validationId = await transaction(async (tx) => {
    const event = await requireRow(
      tx,
      "select * from rto_factor_events where id = $1",
      [validation.eventId],
      "Factor event",
    );
    const report = await requireRow(
      tx,
      `
        select r.id, r.status as report_status, b.revision, b.source_checksum,
               b.status as batch_status, b.source_snapshot_date
        from rto_reports r
        join rto_report_batches b on b.id = r.batch_id
        where r.id = $1
      `,
      [validation.reportId],
      "RTO report",
    );
    assertReportLinkage(validation, report);
    if (EVIDENCE_DECISIONS.has(validation.decisionStatus)) {
      assertReadyReport(report);
      if (event.review_status !== "eligible") {
        throw inputError(`${validation.decisionStatus} requires an eligible event`);
      }
      assertEvidenceWindowAlignment(validation, event, report);
    }

    const evidenceRows = await loadValidationInputDocuments(
      tx,
      validation.eventId,
      validation.documents,
    );
    if (EVIDENCE_DECISIONS.has(validation.decisionStatus)) {
      assertValidationEvidenceEligibility(validation, evidenceRows);
    }

    const result = await tx(
      `
        insert into rto_factor_validations (
          event_id, report_id, report_revision, report_source_checksum,
          decision_status, algorithm_key, algorithm_version, pre_window_start,
          pre_window_end, post_window_start, post_window_end, baseline_value,
          focal_change, control_change, effect_size, effect_unit,
          confidence_interval_low, confidence_interval_high, materiality_threshold,
          control_count, observed_date_coverage, source_reliability_score,
          hypothesis_confidence_score, empirical_support_score, quality_gates,
          evidence_pack, limitations, idempotency_key, input_checksum,
          validation_checksum
        )
        values (
          $1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10::date,$11::date,$12,$13,
          $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26::jsonb,
          $27::jsonb,$28,$29,$30
        )
        on conflict (idempotency_key) do nothing
        returning id, validation_checksum
      `,
      [
        validation.eventId,
        validation.reportId,
        validation.reportRevision,
        validation.reportSourceChecksum,
        validation.decisionStatus,
        validation.algorithmKey,
        validation.algorithmVersion,
        validation.preWindowStart,
        validation.preWindowEnd,
        validation.postWindowStart,
        validation.postWindowEnd,
        validation.baselineValue,
        validation.focalChange,
        validation.controlChange,
        validation.effectSize,
        validation.effectUnit,
        validation.confidenceIntervalLow,
        validation.confidenceIntervalHigh,
        validation.materialityThreshold,
        validation.controlCount,
        validation.observedDateCoverage,
        validation.sourceReliabilityScore,
        validation.hypothesisConfidenceScore,
        validation.empiricalSupportScore,
        JSON.stringify(validation.qualityGates),
        JSON.stringify(validation.evidencePack),
        JSON.stringify(validation.limitations),
        validation.idempotencyKey,
        validation.inputChecksum,
        validation.validationChecksum,
      ],
    );
    const existing = result.rows[0]
      ?? await rowByIdempotencyKey(tx, "rto_factor_validations", validation.idempotencyKey);
    assertIdempotentRecord(
      existing,
      "validation_checksum",
      validation.validationChecksum,
      "validation",
    );
    if (!result.rows[0]) return Number(existing.id);

    for (const control of validation.controls) {
      await tx(
        `
          insert into rto_factor_validation_controls (
            validation_id, selected_rank, state, rto, match_score,
            pre_baseline, pre_trend, exposure_status, exclusion_reason
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          existing.id,
          control.selectedRank,
          control.state,
          control.rto,
          control.matchScore,
          control.preBaseline,
          control.preTrend,
          control.exposureStatus,
          control.exclusionReason,
        ],
      );
    }
    for (const document of validation.documents) {
      await tx(
        `
          insert into rto_factor_validation_documents (
            validation_id, document_id, evidence_role
          )
          values ($1,$2,$3)
        `,
        [existing.id, document.documentId, document.evidenceRole],
      );
    }
    return Number(existing.id);
  });
  return transaction((tx) => loadValidationWithQuery(tx, validationId));
}

export async function saveRtoReportExplanation(input = {}) {
  const explanation = prepareRtoReportExplanation(input);
  const explanationId = await transaction(async (tx) => {
    const validation = await requireRow(
      tx,
      `
        select v.*, e.review_status as event_review_status
        from rto_factor_validations v
        join rto_factor_events e on e.id = v.event_id
        where v.id = $1
      `,
      [explanation.validationId],
      "Factor validation",
    );
    const expectedConfidence = CONFIDENCE_BY_VALIDATION.get(validation.decision_status);
    if (explanation.confidenceLabel !== expectedConfidence) {
      throw inputError(
        `confidenceLabel must be ${expectedConfidence} for validation status ${validation.decision_status}`,
      );
    }
    await assertExplanationCitations(tx, explanation.validationId, explanation.citations);

    const result = await tx(
      `
        insert into rto_report_explanations (
          validation_id, report_id, report_revision, report_source_checksum,
          heading, body, confidence_label, limitations, generation_method,
          model_provider, model_name, prompt_version, publication_mode,
          idempotency_key, input_checksum, output_checksum, explanation_checksum,
          created_by_user_id, created_by_label
        )
        values (
          $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,'draft_only',
          $13,$14,$15,$16,$17,$18
        )
        on conflict (idempotency_key) do nothing
        returning id, explanation_checksum
      `,
      [
        explanation.validationId,
        validation.report_id,
        validation.report_revision,
        validation.report_source_checksum,
        explanation.heading,
        explanation.body,
        explanation.confidenceLabel,
        JSON.stringify(explanation.limitations),
        explanation.generationMethod,
        explanation.modelProvider,
        explanation.modelName,
        explanation.promptVersion,
        explanation.idempotencyKey,
        explanation.inputChecksum,
        explanation.outputChecksum,
        explanation.explanationChecksum,
        explanation.createdByUserId,
        explanation.createdByLabel,
      ],
    );
    const existing = result.rows[0]
      ?? await rowByIdempotencyKey(tx, "rto_report_explanations", explanation.idempotencyKey);
    assertIdempotentRecord(
      existing,
      "explanation_checksum",
      explanation.explanationChecksum,
      "explanation",
    );
    if (!result.rows[0]) return Number(existing.id);
    for (const citation of explanation.citations) {
      await tx(
        `
          insert into rto_report_explanation_documents (
            explanation_id, document_id, citation_order, citation_label
          )
          values ($1,$2,$3,$4)
        `,
        [existing.id, citation.documentId, citation.citationOrder, citation.citationLabel],
      );
    }
    return Number(existing.id);
  });
  const rows = await listRtoReportExplanations({ explanationId, limit: 1 });
  return rows[0] ?? null;
}

export async function listRtoReportExplanations({
  explanationId = null,
  reportId = null,
  validationId = null,
  eventId = null,
  reviewStatus = null,
  limit = 100,
  offset = 0,
} = {}) {
  return transaction(async (tx) => {
    const values = [];
    const clauses = [];
    if (explanationId !== null && explanationId !== undefined) {
      addFilter(values, clauses, "x.id", requiredId(explanationId, "explanationId"));
    }
    if (reportId !== null && reportId !== undefined) {
      addFilter(values, clauses, "x.report_id", requiredId(reportId, "reportId"));
    }
    if (validationId !== null && validationId !== undefined) {
      addFilter(values, clauses, "x.validation_id", requiredId(validationId, "validationId"));
    }
    if (eventId !== null && eventId !== undefined) {
      addFilter(values, clauses, "v.event_id", requiredId(eventId, "eventId"));
    }
    if (reviewStatus) {
      values.push(enumValue(reviewStatus, ["pending", ...RTO_REPORT_EXPLANATION_DECISIONS], "reviewStatus"));
      clauses.push(`coalesce(lr.decision, 'pending') = $${values.length}`);
    }
    values.push(boundedLimit(limit, 200));
    const limitParam = `$${values.length}`;
    values.push(nonNegativeInteger(offset, "offset"));
    const offsetParam = `$${values.length}`;
    const result = await tx(
      `
        select x.*, v.event_id, v.decision_status as validation_decision_status,
               e.title as event_title,
               to_jsonb(lr) as latest_review
        from rto_report_explanations x
        join rto_factor_validations v on v.id = x.validation_id
        join rto_factor_events e on e.id = v.event_id
        left join lateral (
          select rr.*
          from rto_report_explanation_reviews rr
          where rr.explanation_id = x.id
          order by rr.created_at desc, rr.id desc
          limit 1
        ) lr on true
        ${whereClause(clauses)}
        order by x.created_at desc, x.id desc
        limit ${limitParam}
        offset ${offsetParam}
      `,
      values,
    );
    const citations = await loadCitationsByExplanationIds(
      tx,
      result.rows.map((row) => Number(row.id)),
    );
    return result.rows.map((row) =>
      normalizeExplanation(row, citations.get(Number(row.id)) ?? []));
  });
}

export async function reviewRtoReportExplanation(explanationId, input = {}) {
  const id = requiredId(explanationId, "explanationId");
  const review = prepareRtoReportExplanationReview({ ...input, explanationId: id });
  return transaction(async (tx) => {
    const explanation = await requireRow(
      tx,
      `
        select x.*, v.decision_status as validation_decision_status,
               e.review_status as event_review_status,
               r.status as report_status, b.status as batch_status,
               b.revision as current_report_revision,
               b.source_checksum as current_report_source_checksum
        from rto_report_explanations x
        join rto_factor_validations v on v.id = x.validation_id
        join rto_factor_events e on e.id = v.event_id
        join rto_reports r on r.id = x.report_id
        join rto_report_batches b on b.id = r.batch_id
        where x.id = $1
      `,
      [id],
      "Report explanation",
    );
    const idempotentResult = await tx(
      `
        select *
        from rto_report_explanation_reviews
        where idempotency_key = $1
        limit 1
      `,
      [review.idempotencyKey],
    );
    if (idempotentResult.rows[0]) {
      const existing = idempotentResult.rows[0];
      if (Number(existing.explanation_id) !== id) {
        throw conflictError("The explanation-review idempotency key belongs to another explanation");
      }
      assertIdempotentRecord(
        existing,
        "review_checksum",
        review.reviewChecksum,
        "explanation review",
      );
      return normalizeReview(existing);
    }
    const latestReview = (
      await tx(
        `
          select *
          from rto_report_explanation_reviews
          where explanation_id = $1
          order by created_at desc, id desc
          limit 1
        `,
        [id],
      )
    ).rows[0];
    if (review.decision === "revoked" && !APPROVAL_DECISIONS.has(latestReview?.decision)) {
      throw inputError("Only the latest approved explanation can be revoked");
    }
    if (APPROVAL_DECISIONS.has(review.decision)) {
      await assertExplanationCanBeApproved(tx, explanation);
    }

    const result = await tx(
      `
        insert into rto_report_explanation_reviews (
          explanation_id, decision, edited_heading, edited_body, reason,
          idempotency_key, review_checksum, reviewer_user_id, reviewer_label
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (idempotency_key) do nothing
        returning *
      `,
      [
        id,
        review.decision,
        review.editedHeading,
        review.editedBody,
        review.reason,
        review.idempotencyKey,
        review.reviewChecksum,
        review.reviewerUserId,
        review.reviewerLabel,
      ],
    );
    const row = result.rows[0]
      ?? await rowByIdempotencyKey(tx, "rto_report_explanation_reviews", review.idempotencyKey);
    assertIdempotentRecord(row, "review_checksum", review.reviewChecksum, "explanation review");
    return normalizeReview(row);
  });
}

export async function listApprovedRtoReportExplanations({
  reportId,
  reportRevision = null,
  limit = 100,
} = {}) {
  const id = requiredId(reportId, "reportId");
  const values = [id];
  const clauses = [
    "x.report_id = $1",
    "lr.decision in ('approved', 'edited_and_approved')",
    "v.decision_status in ('mixed_evidence', 'supported_association')",
    "e.review_status = 'eligible'",
    "x.report_revision = b.revision",
    "x.report_source_checksum = b.source_checksum",
    "r.status = 'ready'",
    "b.status = 'ready'",
    `not exists (
      select 1
      from rto_report_explanation_documents xd
      join rto_factor_documents d on d.id = xd.document_id
      join rto_factor_sources s on s.id = d.source_id
      where xd.explanation_id = x.id
        and (d.review_status <> 'approved' or s.evidence_policy <> 'report_evidence')
    )`,
  ];
  if (reportRevision !== null && reportRevision !== undefined) {
    values.push(requiredPositiveInteger(reportRevision, "reportRevision"));
    clauses.push(`x.report_revision = $${values.length}`);
  }
  values.push(boundedLimit(limit, 200));
  const limitParam = `$${values.length}`;
  return transaction(async (tx) => {
    const result = await tx(
      `
        select x.*, v.event_id, v.decision_status as validation_decision_status,
               e.title as event_title, to_jsonb(lr) as latest_review
        from rto_report_explanations x
        join rto_factor_validations v on v.id = x.validation_id
        join rto_factor_events e on e.id = v.event_id
        join rto_reports r on r.id = x.report_id
        join rto_report_batches b on b.id = r.batch_id
        join lateral (
          select rr.*
          from rto_report_explanation_reviews rr
          where rr.explanation_id = x.id
          order by rr.created_at desc, rr.id desc
          limit 1
        ) lr on true
        where ${clauses.join(" and ")}
        order by x.created_at desc, x.id desc
        limit ${limitParam}
      `,
      values,
    );
    const citations = await loadCitationsByExplanationIds(
      tx,
      result.rows.map((row) => Number(row.id)),
    );
    return result.rows.map((row) => {
      const normalized = normalizeExplanation(row, citations.get(Number(row.id)) ?? []);
      return {
        ...normalized,
        finalHeading: row.latest_review?.decision === "edited_and_approved"
          ? row.latest_review.edited_heading
          : row.heading,
        finalBody: row.latest_review?.decision === "edited_and_approved"
          ? row.latest_review.edited_body
          : row.body,
      };
    });
  });
}

async function loadDocumentWithQuery(runQuery, id) {
  const result = await runQuery(
    `
      select d.*, to_jsonb(s) as source
      from rto_factor_documents d
      join rto_factor_sources s on s.id = d.source_id
      where d.id = $1
    `,
    [id],
  );
  return result.rows[0] ?? null;
}

async function loadEventWithQuery(runQuery, id) {
  const eventResult = await runQuery("select * from rto_factor_events where id = $1", [id]);
  if (!eventResult.rows[0]) return null;
  const [documentsResult, targetsResult] = await Promise.all([
    runQuery(
      `
        select ed.document_id, ed.evidence_role, ed.created_at,
               to_jsonb(d) as document, to_jsonb(s) as source
        from rto_factor_event_documents ed
        join rto_factor_documents d on d.id = ed.document_id
        join rto_factor_sources s on s.id = d.source_id
        where ed.event_id = $1
        order by case ed.evidence_role when 'primary' then 1 when 'corroborating' then 2 else 3 end,
                 ed.document_id
      `,
      [id],
    ),
    runQuery(
      `
        select *
        from rto_factor_event_targets
        where event_id = $1
        order by case target_role when 'affected' then 1 else 2 end, id
      `,
      [id],
    ),
  ]);
  return {
    ...normalizeEvent(eventResult.rows[0]),
    documents: documentsResult.rows.map((row) => ({
      documentId: Number(row.document_id),
      evidenceRole: row.evidence_role,
      createdAt: isoOrNull(row.created_at),
      document: normalizeDocument(row.document, row.source),
    })),
    targets: targetsResult.rows.map(normalizeTarget),
  };
}

async function loadValidationWithQuery(runQuery, id) {
  const validationResult = await runQuery("select * from rto_factor_validations where id = $1", [id]);
  if (!validationResult.rows[0]) return null;
  const [controlsResult, documentsResult] = await Promise.all([
    runQuery(
      `
        select *
        from rto_factor_validation_controls
        where validation_id = $1
        order by selected_rank
      `,
      [id],
    ),
    runQuery(
      `
        select vd.document_id, vd.evidence_role, vd.created_at,
               to_jsonb(d) as document, to_jsonb(s) as source
        from rto_factor_validation_documents vd
        join rto_factor_documents d on d.id = vd.document_id
        join rto_factor_sources s on s.id = d.source_id
        where vd.validation_id = $1
        order by case vd.evidence_role when 'primary' then 1 when 'corroborating' then 2 else 3 end,
                 vd.document_id
      `,
      [id],
    ),
  ]);
  return {
    ...normalizeValidation(validationResult.rows[0]),
    controls: controlsResult.rows.map(normalizeControl),
    documents: documentsResult.rows.map((row) => ({
      documentId: Number(row.document_id),
      evidenceRole: row.evidence_role,
      createdAt: isoOrNull(row.created_at),
      document: normalizeDocument(row.document, row.source),
    })),
  };
}

async function loadEventInputDocuments(runQuery, documents) {
  const ids = documents.map((document) => document.documentId);
  const result = await runQuery(
    `
      select d.*, s.source_tier, s.evidence_policy
      from rto_factor_documents d
      join rto_factor_sources s on s.id = d.source_id
      where d.id = any($1::bigint[])
    `,
    [ids],
  );
  if (result.rows.length !== ids.length) throw inputError("One or more source documents do not exist");
  return result.rows.map((row) => ({
    ...row,
    evidenceRole: documents.find((document) => document.documentId === Number(row.id)).evidenceRole,
  }));
}

async function loadValidationInputDocuments(runQuery, eventId, documents) {
  if (!documents.length) return [];
  const ids = documents.map((document) => document.documentId);
  const result = await runQuery(
    `
      select d.*, s.source_tier, s.evidence_policy, ed.evidence_role as event_evidence_role
      from rto_factor_event_documents ed
      join rto_factor_documents d on d.id = ed.document_id
      join rto_factor_sources s on s.id = d.source_id
      where ed.event_id = $1
        and d.id = any($2::bigint[])
    `,
    [eventId, ids],
  );
  if (result.rows.length !== ids.length) {
    throw inputError("Validation documents must already be linked to the factor event");
  }
  return result.rows.map((row) => ({
    ...row,
    evidenceRole: documents.find((document) => document.documentId === Number(row.id)).evidenceRole,
  }));
}

async function assertExplanationCitations(runQuery, validationId, citations) {
  const ids = citations.map((citation) => citation.documentId);
  const result = await runQuery(
    `
      select document_id
      from rto_factor_validation_documents
      where validation_id = $1
        and document_id = any($2::bigint[])
    `,
    [validationId, ids],
  );
  if (result.rows.length !== ids.length) {
    throw inputError("Every explanation citation must be present in the frozen validation evidence");
  }
}

async function loadCitationsByExplanationIds(runQuery, explanationIds) {
  const grouped = new Map();
  if (!explanationIds.length) return grouped;
  const result = await runQuery(
    `
      select xd.explanation_id, xd.document_id, xd.citation_order,
             xd.citation_label, xd.created_at,
             to_jsonb(d) as document, to_jsonb(s) as source
      from rto_report_explanation_documents xd
      join rto_factor_documents d on d.id = xd.document_id
      join rto_factor_sources s on s.id = d.source_id
      where xd.explanation_id = any($1::bigint[])
      order by xd.explanation_id, xd.citation_order
    `,
    [explanationIds],
  );
  for (const row of result.rows) {
    const explanationId = Number(row.explanation_id);
    const items = grouped.get(explanationId) ?? [];
    items.push({
      documentId: Number(row.document_id),
      citationOrder: Number(row.citation_order),
      citationLabel: row.citation_label,
      createdAt: isoOrNull(row.created_at),
      document: normalizeDocument(row.document, row.source),
    });
    grouped.set(explanationId, items);
  }
  return grouped;
}

async function assertExplanationCanBeApproved(runQuery, explanation) {
  if (!EVIDENCE_DECISIONS.has(explanation.validation_decision_status)) {
    throw inputError("Only mixed-evidence or supported-association validations can be approved");
  }
  if (explanation.event_review_status !== "eligible") {
    throw inputError("The event is not eligible for an approved report explanation");
  }
  assertReadyReport(explanation);
  if (
    Number(explanation.report_revision) !== Number(explanation.current_report_revision)
    || explanation.report_source_checksum !== explanation.current_report_source_checksum
  ) {
    throw conflictError("The explanation is stale because the report revision or source checksum changed");
  }
  const citationResult = await runQuery(
    `
      select count(*)::int as total,
             count(*) filter (
               where d.review_status <> 'approved'
                  or s.evidence_policy <> 'report_evidence'
             )::int as ineligible
      from rto_report_explanation_documents xd
      join rto_factor_documents d on d.id = xd.document_id
      join rto_factor_sources s on s.id = d.source_id
      where xd.explanation_id = $1
    `,
    [explanation.id],
  );
  const citationStats = citationResult.rows[0];
  if (!Number(citationStats?.total)) {
    throw inputError("An explanation without citations cannot be approved");
  }
  if (Number(citationStats?.ineligible)) {
    throw inputError("All approved explanation citations must be approved report-evidence documents");
  }
}

function assertEventEvidenceEligibility(event, documents) {
  if (!["eligible", "context_only"].includes(event.reviewStatus)) return;
  const primary = documents.filter((document) => document.evidenceRole === "primary");
  if (!primary.length) throw inputError("Reviewed events require a primary source");
  const ineligible = documents.filter((document) =>
    document.evidenceRole !== "confounder"
    && (document.review_status !== "approved" || document.evidence_policy !== "report_evidence"));
  if (ineligible.length) {
    throw inputError("Eligible/context events require approved Tier A/B report-evidence documents");
  }
}

function assertValidationEvidenceEligibility(validation, documents) {
  if (!documents.length) throw inputError(`${validation.decisionStatus} requires evidence documents`);
  const primary = documents.filter((document) => document.evidenceRole === "primary");
  if (!primary.length) throw inputError(`${validation.decisionStatus} requires primary evidence`);
  const ineligible = documents.filter((document) =>
    document.evidenceRole !== "confounder"
    && (document.review_status !== "approved" || document.evidence_policy !== "report_evidence"));
  if (ineligible.length) {
    throw inputError(`${validation.decisionStatus} can only use approved report-evidence documents`);
  }
}

function assertReportLinkage(validation, report) {
  if (Number(report.revision) !== validation.reportRevision) {
    throw conflictError("reportRevision does not match the report batch revision");
  }
  if (report.source_checksum !== validation.reportSourceChecksum) {
    throw conflictError("reportSourceChecksum does not match the report batch source checksum");
  }
}

function assertReadyReport(report) {
  if (report.report_status !== "ready") {
    throw inputError("The RTO report is not ready for an evidence-backed explanation");
  }
  if (report.batch_status !== "ready") {
    throw inputError("The RTO report batch is not ready for an evidence-backed explanation");
  }
}

function normalizeSource(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceKey: row.source_key,
    publisher: row.publisher,
    sourceTier: row.source_tier,
    sourceType: row.source_type,
    canonicalHost: row.canonical_host,
    evidencePolicy: row.evidence_policy,
    intakeMethod: row.intake_method,
    notes: row.notes ?? null,
    idempotencyKey: row.idempotency_key,
    recordChecksum: row.record_checksum,
    supersedesSourceId: numberOrNull(row.supersedes_source_id),
    createdByUserId: numberOrNull(row.created_by_user_id),
    createdByLabel: row.created_by_label,
    createdAt: isoOrNull(row.created_at),
  };
}

function normalizeDocument(row, source = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceId: Number(row.source_id),
    canonicalUrl: row.canonical_url,
    title: row.title,
    publishedAt: isoOrNull(row.published_at),
    retrievedAt: isoOrNull(row.retrieved_at),
    evidenceExcerpt: row.evidence_excerpt,
    contentHash: row.content_hash,
    contentHashMethod: row.content_hash_method,
    reviewStatus: row.review_status,
    reviewReason: row.review_reason ?? null,
    reviewedAt: isoOrNull(row.reviewed_at),
    reviewedByUserId: numberOrNull(row.reviewed_by_user_id),
    reviewedByLabel: row.reviewed_by_label ?? null,
    metadata: row.metadata ?? {},
    idempotencyKey: row.idempotency_key,
    recordChecksum: row.record_checksum,
    supersedesDocumentId: numberOrNull(row.supersedes_document_id),
    createdByUserId: numberOrNull(row.created_by_user_id),
    createdByLabel: row.created_by_label,
    createdAt: isoOrNull(row.created_at),
    source: source ? normalizeSource(source) : null,
  };
}

function normalizeEvent(row) {
  return {
    id: Number(row.id),
    eventType: row.event_type,
    title: row.title,
    claimSummary: row.claim_summary,
    hypothesis: row.hypothesis,
    expectedDirection: row.expected_direction,
    effectiveStart: rawDateOnly(row.effective_start),
    effectiveEnd: rawDateOnly(row.effective_end),
    eventTimezone: row.event_timezone,
    reviewStatus: row.review_status,
    sourceReliabilityScore: Number(row.source_reliability_score ?? 0),
    reviewReason: row.review_reason ?? null,
    reviewedAt: isoOrNull(row.reviewed_at),
    reviewedByUserId: numberOrNull(row.reviewed_by_user_id),
    reviewedByLabel: row.reviewed_by_label ?? null,
    intakeMethod: row.intake_method,
    metadata: row.metadata ?? {},
    idempotencyKey: row.idempotency_key,
    eventChecksum: row.event_checksum,
    supersedesEventId: numberOrNull(row.supersedes_event_id),
    createdByUserId: numberOrNull(row.created_by_user_id),
    createdByLabel: row.created_by_label,
    createdAt: isoOrNull(row.created_at),
  };
}

function normalizeTarget(row) {
  return {
    id: Number(row.id),
    eventId: Number(row.event_id),
    targetRole: row.target_role,
    geographyScope: row.geography_scope,
    state: row.state ?? null,
    rto: row.rto ?? null,
    oem: row.oem ?? null,
    fuelGroup: row.fuel_group ?? null,
    vehicleCategory: row.vehicle_category ?? null,
    createdAt: isoOrNull(row.created_at),
  };
}

function normalizeValidation(row) {
  return {
    id: Number(row.id),
    eventId: Number(row.event_id),
    reportId: Number(row.report_id),
    reportRevision: Number(row.report_revision),
    reportSourceChecksum: row.report_source_checksum,
    decisionStatus: row.decision_status,
    algorithmKey: row.algorithm_key,
    algorithmVersion: row.algorithm_version,
    preWindowStart: rawDateOnly(row.pre_window_start),
    preWindowEnd: rawDateOnly(row.pre_window_end),
    postWindowStart: rawDateOnly(row.post_window_start),
    postWindowEnd: rawDateOnly(row.post_window_end),
    baselineValue: finiteOrNull(row.baseline_value),
    focalChange: finiteOrNull(row.focal_change),
    controlChange: finiteOrNull(row.control_change),
    effectSize: finiteOrNull(row.effect_size),
    effectUnit: row.effect_unit ?? null,
    confidenceIntervalLow: finiteOrNull(row.confidence_interval_low),
    confidenceIntervalHigh: finiteOrNull(row.confidence_interval_high),
    materialityThreshold: finiteOrNull(row.materiality_threshold),
    controlCount: Number(row.control_count ?? 0),
    observedDateCoverage: Number(row.observed_date_coverage ?? 0),
    sourceReliabilityScore: Number(row.source_reliability_score ?? 0),
    hypothesisConfidenceScore: Number(row.hypothesis_confidence_score ?? 0),
    empiricalSupportScore: Number(row.empirical_support_score ?? 0),
    qualityGates: row.quality_gates ?? {},
    evidencePack: row.evidence_pack ?? {},
    limitations: row.limitations ?? [],
    idempotencyKey: row.idempotency_key,
    inputChecksum: row.input_checksum,
    validationChecksum: row.validation_checksum,
    createdAt: isoOrNull(row.created_at),
  };
}

function normalizeControl(row) {
  return {
    validationId: Number(row.validation_id),
    selectedRank: Number(row.selected_rank),
    state: row.state,
    rto: row.rto,
    matchScore: Number(row.match_score),
    preBaseline: finiteOrNull(row.pre_baseline),
    preTrend: finiteOrNull(row.pre_trend),
    exposureStatus: row.exposure_status,
    exclusionReason: row.exclusion_reason ?? null,
    createdAt: isoOrNull(row.created_at),
  };
}

function normalizeExplanation(row, citations = []) {
  const latestReview = row.latest_review?.id ? normalizeReview(row.latest_review) : null;
  return {
    id: Number(row.id),
    validationId: Number(row.validation_id),
    reportId: Number(row.report_id),
    reportRevision: Number(row.report_revision),
    reportSourceChecksum: row.report_source_checksum,
    eventId: numberOrNull(row.event_id),
    eventTitle: row.event_title ?? null,
    validationDecisionStatus: row.validation_decision_status ?? null,
    heading: row.heading,
    body: row.body,
    confidenceLabel: row.confidence_label,
    limitations: row.limitations ?? [],
    generationMethod: row.generation_method,
    modelProvider: row.model_provider ?? null,
    modelName: row.model_name ?? null,
    promptVersion: row.prompt_version,
    publicationMode: row.publication_mode,
    idempotencyKey: row.idempotency_key,
    inputChecksum: row.input_checksum,
    outputChecksum: row.output_checksum,
    explanationChecksum: row.explanation_checksum,
    createdByUserId: numberOrNull(row.created_by_user_id),
    createdByLabel: row.created_by_label,
    createdAt: isoOrNull(row.created_at),
    citations,
    latestReview,
    reviewStatus: latestReview?.decision ?? "pending",
  };
}

function normalizeReview(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    explanationId: Number(row.explanation_id),
    decision: row.decision,
    editedHeading: row.edited_heading ?? null,
    editedBody: row.edited_body ?? null,
    reason: row.reason ?? null,
    idempotencyKey: row.idempotency_key,
    reviewChecksum: row.review_checksum,
    reviewerUserId: numberOrNull(row.reviewer_user_id),
    reviewerLabel: row.reviewer_label,
    createdAt: isoOrNull(row.created_at),
  };
}

function normalizeEvidenceDocuments(input) {
  if (!Array.isArray(input) || !input.length) return [];
  const documents = input.map((item) => ({
    documentId: requiredId(item?.documentId ?? item?.id, "documentId"),
    evidenceRole: enumValue(item?.evidenceRole ?? "primary", EVIDENCE_ROLES, "evidenceRole"),
  }));
  assertUnique(documents, (item) => item.documentId, "documentId");
  return documents;
}

function normalizeEventTargets(input) {
  if (!Array.isArray(input) || !input.length) throw inputError("targets must be a non-empty array");
  const targets = input.map((item) => {
    const state = optionalText(item?.state, 300);
    const rto = optionalText(item?.rto, 500);
    const geographyScope = enumValue(
      item?.geographyScope ?? (rto ? "rto" : state ? "state" : "national"),
      ["national", "state", "rto"],
      "geographyScope",
    );
    if (geographyScope === "national" && (state || rto)) {
      throw inputError("National targets cannot include state or RTO");
    }
    if (geographyScope === "state" && (!state || rto)) {
      throw inputError("State targets require state and cannot include RTO");
    }
    if (geographyScope === "rto" && (!state || !rto)) {
      throw inputError("RTO targets require both state and RTO");
    }
    return {
      targetRole: enumValue(item?.targetRole ?? "affected", ["affected", "excluded_control"], "targetRole"),
      geographyScope,
      state,
      rto,
      oem: optionalText(item?.oem, 300),
      fuelGroup: enumValue(item?.fuelGroup ?? "ALL", ["EV", "ICE", "ALL"], "fuelGroup"),
      vehicleCategory: enumValue(
        item?.vehicleCategory ?? "ALL",
        ["2W", "3W", "4W", "ALL"],
        "vehicleCategory",
      ),
    };
  });
  assertUnique(
    targets,
    (item) => [
      item.targetRole,
      item.geographyScope,
      item.state,
      item.rto,
      item.oem,
      item.fuelGroup,
      item.vehicleCategory,
    ].join("\u0000"),
    "event target",
  );
  return targets;
}

function normalizeValidationControls(input) {
  if (!Array.isArray(input)) throw inputError("controls must be an array");
  const controls = input.map((item, index) => {
    const exposureStatus = enumValue(
      item?.exposureStatus ?? "unexposed",
      ["unexposed", "excluded", "unknown"],
      "exposureStatus",
    );
    const exclusionReason = optionalText(item?.exclusionReason, 1000);
    if (exposureStatus === "unexposed" && exclusionReason) {
      throw inputError("Unexposed controls cannot include an exclusionReason");
    }
    if (exposureStatus !== "unexposed" && !exclusionReason) {
      throw inputError(`${exposureStatus} controls require an exclusionReason`);
    }
    return {
      selectedRank: index + 1,
      state: boundedText(item?.state, "control state", 1, 300),
      rto: boundedText(item?.rto, "control RTO", 1, 500),
      matchScore: score(item?.matchScore, "matchScore"),
      preBaseline: optionalFinite(item?.preBaseline, "preBaseline"),
      preTrend: optionalFinite(item?.preTrend, "preTrend"),
      exposureStatus,
      exclusionReason,
    };
  });
  assertUnique(controls, (item) => `${item.state}\u0000${item.rto}`, "control RTO");
  return controls;
}

function normalizeCitations(input) {
  if (!Array.isArray(input)) throw inputError("citations must be an array");
  const citations = input.map((item, index) => ({
    documentId: requiredId(item?.documentId ?? item?.id, "citation documentId"),
    citationOrder: index + 1,
    citationLabel: boundedText(
      item?.citationLabel ?? item?.label ?? `Source ${index + 1}`,
      "citationLabel",
      1,
      200,
    ),
  }));
  assertUnique(citations, (item) => item.documentId, "citation documentId");
  return citations;
}

function assertImmutableReviewFields(value, label) {
  if (value.reviewStatus === "pending") {
    if (value.reviewReason || value.reviewedAt || value.reviewedByUserId || value.reviewedByLabel) {
      throw inputError(`Pending ${label}s cannot include review fields`);
    }
    return;
  }
  if (!value.reviewedAt || !value.reviewedByLabel) {
    throw inputError(`Reviewed ${label}s require reviewedAt and reviewedByLabel`);
  }
  if (value.reviewStatus === "rejected" && !value.reviewReason) {
    throw inputError(`Rejected ${label}s require reviewReason`);
  }
  if (value.reviewStatus !== "rejected" && value.reviewReason) {
    throw inputError(`${value.reviewStatus} ${label}s cannot include reviewReason`);
  }
}

function assertOrderedWindows(validation) {
  if (validation.preWindowStart > validation.preWindowEnd) {
    throw inputError("preWindowStart must not be after preWindowEnd");
  }
  if (validation.preWindowEnd >= validation.postWindowStart) {
    throw inputError("The pre window must end before the post window starts");
  }
  if (validation.postWindowStart > validation.postWindowEnd) {
    throw inputError("postWindowStart must not be after postWindowEnd");
  }
}

function assertSupportedEffect(validation) {
  if (
    validation.baselineValue === null
    || validation.focalChange === null
    || validation.controlChange === null
    || validation.effectSize === null
    || validation.effectUnit !== "registrations_per_day"
    || validation.confidenceIntervalLow === null
    || validation.confidenceIntervalHigh === null
    || validation.materialityThreshold === null
  ) {
    throw inputError(
      "supported_association requires baseline, focal/control changes, a registrations-per-day effect, materiality threshold, and confidence interval",
    );
  }
  const calculatedEffect = validation.focalChange - validation.controlChange;
  if (Math.abs(validation.effectSize - calculatedEffect) > 1e-9) {
    throw inputError("supported_association effectSize must equal focalChange minus controlChange");
  }
  const minimumMateriality = Math.max(5, validation.baselineValue * 0.1);
  if (
    validation.materialityThreshold < minimumMateriality
    || Math.abs(validation.effectSize) < validation.materialityThreshold
  ) {
    throw inputError("supported_association does not meet the absolute and baseline-relative materiality threshold");
  }
  const positive = validation.effectSize > 0 && validation.confidenceIntervalLow > 0;
  const negative = validation.effectSize < 0 && validation.confidenceIntervalHigh < 0;
  if (!positive && !negative) {
    throw inputError("supported_association confidence interval must exclude zero in the effect direction");
  }
}

function assertEvidenceWindowAlignment(validation, event, report) {
  const eventStart = rawDateOnly(event.effective_start);
  const reportSnapshotDate = rawDateOnly(report.source_snapshot_date);
  if (validation.postWindowStart !== eventStart) {
    throw inputError("The post-event window must start on the event effective date");
  }
  if (!reportSnapshotDate || validation.postWindowEnd > reportSnapshotDate) {
    throw inputError("The report data must be fresh through the post-event window");
  }
  if (
    validation.decisionStatus === "supported_association"
    && (
      (event.expected_direction === "increase" && validation.effectSize <= 0)
      || (event.expected_direction === "decrease" && validation.effectSize >= 0)
    )
  ) {
    throw inputError("The supported effect direction does not match the reviewed event hypothesis");
  }
}

async function requireRow(runQuery, text, params, label) {
  const result = await runQuery(text, params);
  if (!result.rows[0]) throw notFoundError(`${label} was not found`);
  return result.rows[0];
}

async function rowByIdempotencyKey(runQuery, table, key) {
  const allowedTables = new Set([
    "rto_factor_sources",
    "rto_factor_documents",
    "rto_factor_events",
    "rto_factor_validations",
    "rto_report_explanations",
    "rto_report_explanation_reviews",
  ]);
  if (!allowedTables.has(table)) throw new Error("Unsafe idempotency table");
  return requireRow(
    runQuery,
    `select * from ${table} where idempotency_key = $1`,
    [key],
    "Idempotent record",
  );
}

function assertIdempotentRecord(row, checksumField, expectedChecksum, label) {
  if (row?.[checksumField] !== expectedChecksum) {
    throw conflictError(`The ${label} idempotency key was already used for different content`);
  }
}

function addFilter(values, clauses, column, value) {
  if (value === null || value === undefined || value === "") return;
  values.push(value);
  clauses.push(`${column} = $${values.length}`);
}

function whereClause(clauses) {
  return clauses.length ? `where ${clauses.join(" and ")}` : "";
}

function defaultEvidencePolicy(tier) {
  if (["A", "B"].includes(tier)) return "report_evidence";
  if (tier === "C") return "lead_only";
  return "prohibited";
}

function canonicalHost(value) {
  const host = String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host) || host.includes("..")) {
    throw inputError("canonicalHost must be a plain lowercase DNS host");
  }
  return host;
}

function canonicalHttpsUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw inputError("canonicalUrl must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw inputError("canonicalUrl must be HTTPS and cannot contain credentials");
  }
  url.hash = "";
  return { url: url.toString(), host: url.hostname.toLowerCase().replace(/\.$/, "") };
}

function requiredPattern(value, label, pattern, hint) {
  const text = String(value ?? "").trim();
  if (!pattern.test(text)) throw inputError(`${label} must use ${hint}`);
  return text;
}

function boundedText(value, label, min, max) {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) {
    throw inputError(`${label} must be between ${min} and ${max} characters`);
  }
  return text;
}

function optionalText(value, max) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > max) throw inputError(`Text must be at most ${max} characters`);
  return text;
}

function enumValue(value, allowed, label) {
  const text = String(value ?? "").trim();
  const set = allowed instanceof Set ? allowed : new Set(allowed);
  if (!set.has(text)) throw inputError(`${label} is invalid`);
  return text;
}

function requiredId(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw inputError(`${label} must be a positive integer`);
  return number;
}

function optionalId(value, label) {
  return value === null || value === undefined || value === "" ? null : requiredId(value, label);
}

function requiredPositiveInteger(value, label) {
  return requiredId(value, label);
}

function nonNegativeInteger(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw inputError(`${label} must be a non-negative integer`);
  return number;
}

function boundedLimit(value, max) {
  const number = Math.floor(Number(value) || 100);
  return Math.max(1, Math.min(max, number));
}

function score(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw inputError(`${label} must be between 0 and 1`);
  }
  return number;
}

function optionalFinite(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw inputError(`${label} must be finite`);
  return number;
}

function optionalNonNegative(value, label) {
  const number = optionalFinite(value, label);
  if (number !== null && number < 0) throw inputError(`${label} must not be negative`);
  return number;
}

function objectValue(value, label) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError(`${label} must be an object`);
  }
  return value;
}

function stringArray(value, label) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw inputError(`${label} must be an array`);
  return value.map((item) => boundedText(item, `${label} item`, 1, 1000));
}

function dateOnly(value, label) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw inputError(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw inputError(`${label} is not a valid calendar date`);
  }
  return text;
}

function rawDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function daysInclusive(start, end) {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function requiredIsoTimestamp(value, label) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw inputError(`${label} must be an ISO timestamp`);
  return parsed.toISOString();
}

function requiredHash(value, label) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw inputError(`${label} must be a SHA-256 hex digest`);
  return text;
}

function hashValue(value, fallback, label) {
  return value ? requiredHash(value, label) : checksum(fallback);
}

function idempotencyKey(value, fallback) {
  const key = String(value ?? fallback).trim();
  if (key.length < 8 || key.length > 200) {
    throw inputError("idempotencyKey must be between 8 and 200 characters");
  }
  return key;
}

function checksum(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertUnique(values, keyFor, label) {
  const keys = new Set();
  for (const value of values) {
    const key = keyFor(value);
    if (keys.has(key)) throw inputError(`${label} values must be unique`);
    keys.add(key);
  }
}

function finiteOrNull(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}
