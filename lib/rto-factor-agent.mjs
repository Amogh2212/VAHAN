import {
  getRtoFactorEvent,
  saveRtoFactorValidation,
  saveRtoReportExplanation,
} from "./rto-factor-events.mjs";
import { getRtoReport } from "./rto-reports.mjs";
import {
  documentsForRtoFactorNarrative,
  loadRtoFactorDecisionInput,
} from "./rto-factor-data.mjs";
import { validateRtoFactorEvent } from "./rto-factor-validation.mjs";
import {
  buildRtoFactorEvidencePack,
  draftRtoFactorNarrative,
} from "./rto-factor-narrative.mjs";

const DRAFTABLE_STATUSES = new Set(["mixed_evidence", "supported_association"]);

export async function runRtoFactorAgent({
  eventId,
  reportId,
  write = false,
  asOfDate,
  provider = null,
  providerName = "auto",
  env = process.env,
  createdByUserId = null,
  createdByLabel = "rto-factor-agent",
  dependencies = {},
} = {}) {
  const deps = {
    getEvent: getRtoFactorEvent,
    getReport: getRtoReport,
    loadDecisionInput: loadRtoFactorDecisionInput,
    validate: validateRtoFactorEvent,
    buildEvidencePack: buildRtoFactorEvidencePack,
    draftNarrative: draftRtoFactorNarrative,
    saveValidation: saveRtoFactorValidation,
    saveExplanation: saveRtoReportExplanation,
    ...dependencies,
  };
  const normalizedEventId = positiveInteger(eventId, "eventId");
  const normalizedReportId = positiveInteger(reportId, "reportId");
  const [event, report] = await Promise.all([
    deps.getEvent(normalizedEventId),
    deps.getReport(normalizedReportId),
  ]);
  if (!event) throw notFoundError("Factor event");
  if (!report) throw notFoundError("RTO report");
  if (event.reviewStatus !== "eligible") {
    const error = new Error("Only an eligible, human-reviewed event can enter validation.");
    error.code = "event_not_eligible";
    error.statusCode = 409;
    throw error;
  }
  if (!/^[0-9a-f]{64}$/.test(String(report.sourceChecksum ?? ""))) {
    const error = new Error("The report batch does not have a reproducible source checksum.");
    error.code = "missing_report_source_checksum";
    error.statusCode = 409;
    throw error;
  }

  const decisionInput = await deps.loadDecisionInput({
    report,
    event,
    asOfDate,
    preDays: envInteger(env.FACTOR_AGENT_MIN_PRE_DAYS, 28),
    postDays: envInteger(env.FACTOR_AGENT_MIN_POST_DAYS, 14),
  });
  const validation = deps.validate({
    event: decisionInput.validationEvent,
    focalRows: decisionInput.focalRows,
    candidateRows: decisionInput.candidateRows,
    asOfDate: decisionInput.asOfDate,
    dataContext: decisionInput.dataContext,
    options: validationOptionsFromEnv(env),
  });
  const documents = documentsForRtoFactorNarrative(event);
  const draftable = DRAFTABLE_STATUSES.has(validation.status);
  let evidencePack = null;
  let narrativeDraft = null;
  if (draftable) {
    evidencePack = deps.buildEvidencePack({
      report,
      event: {
        ...event,
        sourceIds: documents.map((document) => document.id),
      },
      validation,
      documents,
    });
    narrativeDraft = await deps.draftNarrative({
      evidencePack,
      provider,
      providerName,
      env,
    });
  }

  if (!write) {
    return {
      mode: "dry_run",
      eventId: normalizedEventId,
      reportId: normalizedReportId,
      validation,
      narrativeDraft,
      persistedValidation: null,
      persistedExplanation: null,
      dataContext: decisionInput.dataContext,
    };
  }

  const persistedValidation = await deps.saveValidation(
    validationPersistenceInput({
      event,
      report,
      validation,
      createdByLabel,
    }),
  );
  let persistedExplanation = null;
  if (draftable && narrativeDraft?.narrative) {
    persistedExplanation = await deps.saveExplanation({
      validationId: persistedValidation.id,
      heading: narrativeDraft.narrative.heading,
      body: narrativeDraft.narrative.body,
      confidenceLabel: validation.status === "supported_association" ? "supported" : "mixed_evidence",
      limitations: uniqueText([
        ...(narrativeDraft.narrative.limitations ?? []),
        ...(validationLimitations(validation) ?? []),
      ]),
      generationMethod: narrativeDraft.mode === "llm" ? "llm" : "template",
      modelProvider: narrativeDraft.mode === "llm" ? narrativeDraft.provider : null,
      modelName: narrativeDraft.mode === "llm"
        ? configuredModelName(narrativeDraft.provider, env)
        : null,
      promptVersion: "rto-factor-narrative-v1",
      createdByUserId,
      createdByLabel,
      citations: narrativeDraft.narrative.citations.map((citation) => ({
        documentId: Number(citation.id),
        citationLabel: citation.title,
      })),
    });
  }
  return {
    mode: "write",
    eventId: normalizedEventId,
    reportId: normalizedReportId,
    validation,
    narrativeDraft,
    persistedValidation,
    persistedExplanation,
    dataContext: decisionInput.dataContext,
  };
}

export function validationPersistenceInput({
  event,
  report,
  validation,
  createdByLabel = "rto-factor-agent",
} = {}) {
  const selectedPeers = validation.peerSelection?.selectedPeers
    ?? validation.peerSelection?.selected
    ?? validation.peerSelection?.peers
    ?? [];
  const windows = validation.windows ?? {};
  const estimate = validation.estimate ?? {};
  const interval = estimate.interval ?? {};
  const controls = selectedPeers.map((peer, index) => ({
    state: peer.state,
    rto: peer.rto,
    matchScore: peer.matchScore === undefined
      ? 1 / (1 + Math.max(0, finiteOr(peer.score, 0)))
      : Math.max(0, Math.min(1, Number(peer.matchScore))),
    preBaseline: finiteOrNull(peer.preBaseline ?? peer.baseline ?? peer.features?.mean),
    preTrend: finiteOrNull(peer.preTrend ?? peer.trend ?? peer.features?.trend),
    exposureStatus: peer.exposureStatus ?? "unexposed",
    exclusionReason: peer.exclusionReason ?? null,
    selectedRank: index + 1,
  }));
  const documents = (event.documents ?? []).map((entry) => ({
    documentId: Number(entry.documentId ?? entry.document?.id ?? entry.id),
    evidenceRole: entry.evidenceRole ?? "corroborating",
  }));
  const algorithm = validation.algorithm ?? {};
  const pre = windows.pre ?? windows.preWindow ?? {};
  const post = windows.post ?? windows.postWindow ?? {};
  const focalCoverage = [
    validation.coverage?.focal?.pre?.ratio,
    validation.coverage?.focal?.post?.ratio,
  ].filter((value) => Number.isFinite(Number(value))).map(Number);
  const coverage = focalCoverage.length
    ? Math.min(...focalCoverage)
    : firstFinite(
        validation.coverage?.observedDateCoverage,
        validation.coverage?.ratio,
        validation.dataEligibility?.observedDateCoverage,
        0,
      );
  const empiricalSupport = empiricalSupportScore(validation);
  return {
    eventId: event.id,
    reportId: report.id,
    reportRevision: report.revision,
    reportSourceChecksum: report.sourceChecksum,
    decisionStatus: validation.status,
    algorithmKey: "matched-rto-did",
    algorithmVersion: algorithm.version ?? "1",
    preWindowStart:
      windows.preStart ?? pre.start ?? pre.windowStart ?? validation.event?.preWindowStart,
    preWindowEnd:
      windows.preEnd ?? pre.end ?? pre.windowEnd ?? validation.event?.preWindowEnd,
    postWindowStart:
      windows.postStart ?? post.start ?? post.windowStart ?? validation.event?.postWindowStart,
    postWindowEnd:
      windows.postEnd ?? post.end ?? post.windowEnd ?? validation.event?.postWindowEnd,
    baselineValue: finiteOrNull(estimate.focalPreMean),
    focalChange: finiteOrNull(estimate.focalChange),
    controlChange: finiteOrNull(estimate.controlMedianChange),
    effectSize: finiteOrNull(estimate.effect),
    effectUnit: estimate.unit ?? "registrations_per_day",
    confidenceIntervalLow: finiteOrNull(interval.lower),
    confidenceIntervalHigh: finiteOrNull(interval.upper),
    materialityThreshold: finiteOrNull(estimate.effectThreshold),
    observedDateCoverage: coverage,
    sourceReliabilityScore: finiteOr(event.sourceReliabilityScore, 0),
    hypothesisConfidenceScore: hypothesisConfidenceScore(validation, event),
    empiricalSupportScore: empiricalSupport,
    qualityGates: {
      status: validation.status,
      reasonCodes: validation.reasonCodes ?? [],
      dataEligibility: validation.dataEligibility ?? {},
      evidenceEligibility: validation.evidenceEligibility ?? {},
      diagnostics: validation.diagnostics ?? {},
      createdByLabel,
    },
    evidencePack: validation,
    limitations: validationLimitations(validation),
    controls,
    documents,
  };
}

export function validationOptionsFromEnv(env = process.env) {
  return {
    preDays: envInteger(env.FACTOR_AGENT_MIN_PRE_DAYS, 28),
    postDays: envInteger(env.FACTOR_AGENT_MIN_POST_DAYS, 14),
    minControls: envInteger(env.FACTOR_AGENT_MIN_CONTROLS, 5),
    minCoverage: envPercent(env.FACTOR_AGENT_MIN_COVERAGE_PCT, 90),
  };
}

function validationLimitations(validation) {
  const limitations = [];
  if (Array.isArray(validation.limitations)) limitations.push(...validation.limitations);
  if (Array.isArray(validation.reasonCodes)) {
    limitations.push(...validation.reasonCodes.map((reason) => `Quality gate: ${String(reason).replaceAll("_", " ")}.`));
  }
  if (validation.interpretation) limitations.push(validation.interpretation);
  return uniqueText(limitations);
}

function empiricalSupportScore(validation) {
  if (validation.status === "supported_association") return 0.9;
  if (validation.status === "mixed_evidence") return 0.6;
  if (validation.status === "no_effect") return 0.3;
  return 0.1;
}

function hypothesisConfidenceScore(validation, event) {
  const reliability = finiteOr(event.sourceReliabilityScore, 0);
  return Math.max(0, Math.min(1, (reliability + empiricalSupportScore(validation)) / 2));
}

function configuredModelName(provider, env) {
  const normalized = String(provider ?? "").toLowerCase();
  if (normalized.includes("ollama")) {
    return env.FACTOR_AGENT_OLLAMA_MODEL ?? env.OLLAMA_FACTOR_MODEL ?? "qwen3:4b";
  }
  if (normalized.includes("gemini")) {
    return env.FACTOR_AGENT_GEMINI_MODEL ?? env.GEMINI_MODEL ?? "gemini-2.0-flash";
  }
  if (normalized.includes("groq")) {
    return env.FACTOR_AGENT_GROQ_MODEL ?? env.GROQ_MODEL ?? "llama-3.1-8b-instant";
  }
  return "configured-provider-model";
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function finiteOr(...values) {
  return firstFinite(...values);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function envInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function envPercent(value, fallback) {
  const number = Number(value);
  const percent = Number.isFinite(number) ? number : fallback;
  return Math.max(0, Math.min(1, percent / 100));
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${label} must be a positive integer.`);
  return number;
}

function notFoundError(label) {
  const error = new Error(`${label} not found.`);
  error.statusCode = 404;
  return error;
}

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}
