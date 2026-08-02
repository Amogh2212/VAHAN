const DAY_MS = 24 * 60 * 60 * 1000;
const ALGORITHM_VERSION = "1.0.0";
const HARD_ROW_ISSUES = new Set([
  "duplicate_series_date",
  "filters_not_confirmed",
  "invalid_mtd_total",
  "invalid_snapshot_date",
  "late_fill",
  "mtd_decrease",
  "quality_flag_present",
  "quality_not_ready",
  "scrape_not_success",
  "target_month_mismatch",
  "unproven_row_quality",
]);

export const RTO_FACTOR_ELIGIBLE_SOURCE_TIERS = Object.freeze(["A", "B"]);
export const RTO_FACTOR_VALIDATION_STATUSES = Object.freeze([
  "blocked_data",
  "blocked_evidence",
  "too_early",
  "confounded",
  "no_effect",
  "mixed_evidence",
  "supported_association",
]);
export const RTO_FACTOR_VALIDATION_DEFAULTS = Object.freeze({
  preDays: 28,
  postDays: 14,
  minCoverage: 0.9,
  minControls: 5,
  maxControls: 10,
  bootstrapIterations: 1_000,
  confidenceLevel: 0.95,
  requireReadyContext: true,
});

/**
 * Normalize an event into the immutable, JSON-safe shape consumed by the
 * validator. Eligibility is deliberately reported rather than thrown so an
 * orchestrator can persist blocked attempts as part of its audit trail.
 */
export function normalizeRtoFactorEvent(input = {}) {
  const rawScope = cleanText(input.scopeLevel ?? input.scope_level ?? input.scope ?? "").toLowerCase();
  const scopeLevel = rawScope === "local" || rawScope === "rto"
    ? "rto"
    : rawScope === "state" || rawScope === "state_level"
      ? "state"
      : null;
  const state = cleanText(input.state ?? input.targetState ?? input.target_state) || null;
  const rtos = normalizeTargets(input, state);
  const effectiveDate = dateOnly(input.effectiveDate ?? input.effective_date ?? input.eventDate ?? input.event_date);
  const fuelGroup = upperText(input.fuelGroup ?? input.fuel_group) || null;
  const vehicleCategory = upperText(input.vehicleCategory ?? input.vehicle_category) || null;
  const oem = cleanText(input.oem ?? input.manufacturer) || null;
  const rawExpectedDirection = cleanText(
    input.expectedDirection ?? input.expected_direction ?? "unknown",
  ).toLowerCase();
  const expectedDirection = ["increase", "decrease", "unknown"].includes(rawExpectedDirection)
    ? rawExpectedDirection
    : null;
  const suppliedMetricKey = cleanText(input.metricKey ?? input.metric_key);
  const metricKey = suppliedMetricKey
    || [fuelGroup, vehicleCategory, oem].filter(Boolean).join("|")
    || null;
  const sources = (Array.isArray(input.sources) ? input.sources : [])
    .map((source, index) => normalizeSource(source, index));
  const confounders = normalizeConfounders(input);
  const hypothesis = cleanText(input.hypothesis ?? input.proposedExplanation ?? input.proposed_explanation) || null;
  const normalizationIssues = [];

  if (!cleanText(input.id ?? input.eventId ?? input.event_id)) normalizationIssues.push("missing_event_id");
  if (!cleanText(input.title ?? input.name)) normalizationIssues.push("missing_event_title");
  if (!effectiveDate) normalizationIssues.push("invalid_effective_date");
  if (!scopeLevel) normalizationIssues.push("unsupported_scope");
  if (!state) normalizationIssues.push("missing_target_state");
  if (scopeLevel === "rto" && rtos.length === 0) normalizationIssues.push("missing_target_rto");
  if (!metricKey) normalizationIssues.push("missing_metric");
  if (hypothesis && containsCausalClaim(hypothesis)) normalizationIssues.push("causal_claim_not_allowed");
  if (!expectedDirection) normalizationIssues.push("invalid_expected_direction");

  return {
    id: cleanText(input.id ?? input.eventId ?? input.event_id) || null,
    title: cleanText(input.title ?? input.name) || null,
    effectiveDate,
    scopeLevel,
    state,
    rtos,
    fuelGroup,
    vehicleCategory,
    oem,
    expectedDirection,
    metricKey,
    hypothesis,
    sources,
    confounders,
    hasConfounder: Boolean(input.hasConfounder ?? input.has_confounder)
      || confounders.some((item) => item.active),
    normalizationIssues: uniqueSorted(normalizationIssues),
  };
}

/**
 * Convert month-to-date report totals to observed daily increments.
 *
 * A day-one MTD value is a valid increment because VAHAN resets the series at
 * month start. Every other day requires the immediately preceding calendar
 * day's MTD value. Missing predecessors remain missing; they are never changed
 * into false zero-registration observations.
 */
export function mtdRowsToDailyIncrements(rows, {
  from = null,
  to = null,
  metric = null,
} = {}) {
  const fromDate = dateOnly(from);
  const toDate = dateOnly(to);
  const inputRows = Array.isArray(rows) ? rows : [];
  const canonicalRows = [];
  const rejectedRows = [];

  for (let index = 0; index < inputRows.length; index += 1) {
    const canonical = canonicalMtdRow(inputRows[index], index);
    if (!canonical.snapshotDate) {
      rejectedRows.push(rejectedRow(canonical, ["invalid_snapshot_date"]));
      continue;
    }
    if (fromDate && canonical.snapshotDate < addDays(fromDate, -1)) continue;
    if (toDate && canonical.snapshotDate > toDate) continue;
    if (!rowMatchesMetric(canonical, metric)) continue;
    canonicalRows.push(canonical);
  }

  const bySeries = groupBy(canonicalRows, (row) => row.seriesKey);
  const componentKeysByEntity = new Map();
  const increments = [];
  const seriesDiagnostics = [];

  for (const [seriesKey, seriesRows] of bySeries) {
    const sorted = [...seriesRows].sort(compareRows);
    const entityKey = sorted[0]?.entityKey ?? "";
    const componentKey = sorted[0]?.componentKey ?? "";
    if (!componentKeysByEntity.has(entityKey)) componentKeysByEntity.set(entityKey, new Set());
    componentKeysByEntity.get(entityKey).add(componentKey);

    const rowsByDate = groupBy(sorted, (row) => row.snapshotDate);
    const uniqueRows = new Map();
    for (const [snapshotDate, dateRows] of rowsByDate) {
      if (dateRows.length !== 1) {
        for (const row of dateRows) {
          rejectedRows.push(rejectedRow(row, ["duplicate_series_date"]));
        }
        continue;
      }
      uniqueRows.set(snapshotDate, dateRows[0]);
    }

    let observedCount = 0;
    let missingPredecessorCount = 0;
    for (const row of sorted) {
      if (uniqueRows.get(row.snapshotDate) !== row) continue;
      if (fromDate && row.snapshotDate < fromDate) continue;
      if (toDate && row.snapshotDate > toDate) continue;

      const qualityIssues = rowQualityIssues(row);
      if (qualityIssues.length > 0) {
        rejectedRows.push(rejectedRow(row, qualityIssues));
        continue;
      }

      let increment = null;
      if (Number(row.snapshotDate.slice(8, 10)) === 1) {
        increment = row.reportTotal;
      } else {
        const previousDate = addDays(row.snapshotDate, -1);
        const previous = uniqueRows.get(previousDate);
        if (!previous || rowQualityIssues(previous).length > 0) {
          missingPredecessorCount += 1;
          rejectedRows.push(rejectedRow(row, ["missing_previous_day"]));
          continue;
        }
        increment = row.reportTotal - previous.reportTotal;
        if (increment < 0) {
          rejectedRows.push(rejectedRow(row, ["mtd_decrease"]));
          continue;
        }
      }

      observedCount += 1;
      increments.push({
        state: row.state,
        rto: row.rto,
        key: row.entityKey,
        snapshotDate: row.snapshotDate,
        componentKey: row.componentKey,
        value: increment,
      });
    }

    seriesDiagnostics.push({
      seriesKey,
      entityKey,
      componentKey,
      observedCount,
      missingPredecessorCount,
    });
  }

  const incrementsByEntityDate = groupBy(
    increments,
    (row) => `${row.key}\u0001${row.snapshotDate}`,
  );
  const observations = [];
  for (const rowsForDate of incrementsByEntityDate.values()) {
    const first = rowsForDate[0];
    const expectedComponents = componentKeysByEntity.get(first.key)?.size ?? 0;
    const observedComponents = new Set(rowsForDate.map((row) => row.componentKey)).size;
    if (expectedComponents === 0 || observedComponents !== expectedComponents) continue;
    observations.push({
      state: first.state,
      rto: first.rto,
      key: first.key,
      snapshotDate: first.snapshotDate,
      value: sum(rowsForDate.map((row) => row.value)),
      componentCount: observedComponents,
    });
  }
  observations.sort(compareObservations);

  const entities = [...groupBy(canonicalRows, (row) => row.entityKey).entries()]
    .map(([key, entityRows]) => ({
      key,
      state: entityRows[0]?.state ?? null,
      rto: entityRows[0]?.rto ?? null,
      eventExposed: entityRows.some((row) => row.eventExposed),
      componentCount: componentKeysByEntity.get(key)?.size ?? 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    observations,
    rejectedRows: rejectedRows.sort(compareRejectedRows),
    entities,
    seriesDiagnostics: seriesDiagnostics.sort((a, b) => a.seriesKey.localeCompare(b.seriesKey)),
  };
}

/**
 * Freeze comparison RTOs using only observations from the pre-event window.
 * Post-event values and post coverage are intentionally not accepted as inputs.
 */
export function selectFrozenPeers({
  event,
  focalKey,
  observations,
  entities = [],
  preStart,
  preEnd,
  minCoverage = RTO_FACTOR_VALIDATION_DEFAULTS.minCoverage,
  minControls = RTO_FACTOR_VALIDATION_DEFAULTS.minControls,
  maxControls = RTO_FACTOR_VALIDATION_DEFAULTS.maxControls,
  hardIssueKeys = [],
} = {}) {
  const normalizedEvent = event?.normalizationIssues
    ? event
    : normalizeRtoFactorEvent(event);
  const dates = dateRange(preStart, preEnd);
  const observationsByKey = groupBy(
    (Array.isArray(observations) ? observations : [])
      .filter((row) => row.snapshotDate >= preStart && row.snapshotDate <= preEnd),
    (row) => row.key,
  );
  const entityByKey = new Map((Array.isArray(entities) ? entities : []).map((entity) => [entity.key, entity]));
  const focalValues = valuesForDates(observationsByKey.get(focalKey), dates);
  const focalFeatures = prePeriodFeatures(focalValues);
  const excludedTargets = new Set(normalizedEvent.rtos.map((target) => entityKey(target.state, target.rto)));
  const hardKeys = new Set(hardIssueKeys);
  const excluded = [];
  const candidates = [];

  for (const [key, rows] of observationsByKey) {
    if (key === focalKey) continue;
    const entity = entityByKey.get(key) ?? {
      key,
      state: rows[0]?.state ?? null,
      rto: rows[0]?.rto ?? null,
      eventExposed: false,
    };
    const reasons = [];
    if (hardKeys.has(key)) reasons.push("pre_period_quality_issue");
    if (entity.eventExposed) reasons.push("marked_event_exposed");
    if (excludedTargets.has(key)) reasons.push("event_target");
    if (normalizedEvent.scopeLevel === "state" && entity.state === normalizedEvent.state) {
      reasons.push("same_state_exposure");
    }

    const coverage = coverageFor(rows, dates);
    if (coverage.ratio < minCoverage) reasons.push("insufficient_pre_coverage");
    const values = valuesForDates(rows, dates);
    if (values.length === 0) reasons.push("no_pre_observations");

    if (reasons.length > 0) {
      excluded.push({
        key,
        state: entity.state,
        rto: entity.rto,
        reasonCodes: uniqueSorted(reasons),
      });
      continue;
    }

    candidates.push({
      key,
      state: entity.state,
      rto: entity.rto,
      preCoverage: coverage,
      features: prePeriodFeatures(values),
    });
  }

  const featureScales = peerFeatureScales(focalFeatures, candidates.map((candidate) => candidate.features));
  for (const candidate of candidates) {
    const volumeDistance = scaledDifference(
      candidate.features.mean,
      focalFeatures.mean,
      featureScales.mean,
    );
    const trendDistance = scaledDifference(
      candidate.features.trend,
      focalFeatures.trend,
      featureScales.trend,
    );
    const volatilityDistance = scaledDifference(
      candidate.features.standardDeviation,
      focalFeatures.standardDeviation,
      featureScales.standardDeviation,
    );
    const sameStatePenalty = normalizedEvent.scopeLevel === "rto"
      && candidate.state !== normalizedEvent.state
      ? 0.25
      : 0;
    candidate.score = Math.sqrt(
      volumeDistance ** 2
      + trendDistance ** 2
      + volatilityDistance ** 2,
    ) + sameStatePenalty;
  }
  candidates.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));

  const boundedMinimum = positiveInt(minControls, RTO_FACTOR_VALIDATION_DEFAULTS.minControls);
  const boundedMaximum = Math.max(
    boundedMinimum,
    positiveInt(maxControls, RTO_FACTOR_VALIDATION_DEFAULTS.maxControls),
  );
  const selected = candidates.slice(0, boundedMaximum).map((candidate) => ({
    key: candidate.key,
    state: candidate.state,
    rto: candidate.rto,
    score: round(candidate.score),
    preCoverage: candidate.preCoverage,
    features: roundedFeatures(candidate.features),
  }));

  return {
    frozenAt: dateOnly(preEnd),
    method: "pre_period_only_standardized_distance",
    eligibleCandidateCount: candidates.length,
    requiredControlCount: boundedMinimum,
    selected,
    excluded: excluded.sort((a, b) => a.key.localeCompare(b.key)),
    focalFeatures: roundedFeatures(focalFeatures),
    featureScales: roundedFeatures(featureScales),
  };
}

/**
 * Run the complete deterministic v1 validation.
 *
 * Values supplied in reportTotal/report_total/mtdTotal/mtd_total/value are
 * interpreted as VAHAN month-to-date registration totals. Returned effects,
 * changes, interval bounds, and thresholds are registrations per day.
 */
export function validateRtoFactorEvent({
  event: eventInput,
  focalRows = [],
  candidateRows = [],
  asOfDate = null,
  dataContext = null,
  options = {},
} = {}) {
  const settings = validationSettings(options);
  const event = normalizeRtoFactorEvent(eventInput);
  const effectiveDate = event.effectiveDate;
  const windows = effectiveDate
    ? {
        preStart: addDays(effectiveDate, -settings.preDays),
        preEnd: addDays(effectiveDate, -1),
        postStart: effectiveDate,
        postEnd: addDays(effectiveDate, settings.postDays - 1),
        asOfDate: dateOnly(asOfDate) || latestDate([...focalRows, ...candidateRows]),
      }
    : {
        preStart: null,
        preEnd: null,
        postStart: null,
        postEnd: null,
        asOfDate: dateOnly(asOfDate) || latestDate([...focalRows, ...candidateRows]),
      };
  const evidenceEligibility = evidenceEligibilityFor(event);
  const dataEligibility = dataContextEligibility(dataContext, settings);
  const base = baseResult({
    event,
    windows,
    settings,
    evidenceEligibility,
    dataEligibility,
  });

  if (event.normalizationIssues.length > 0 || !evidenceEligibility.eligible) {
    return finalizeResult(base, {
      status: "blocked_evidence",
      reasonCodes: [
        ...event.normalizationIssues,
        ...evidenceEligibility.issues,
      ],
    });
  }
  if (!dataEligibility.eligible) {
    return finalizeResult(base, {
      status: "blocked_data",
      reasonCodes: dataEligibility.issues,
    });
  }
  if (!windows.asOfDate || windows.asOfDate < windows.postEnd) {
    return finalizeResult(base, {
      status: "too_early",
      reasonCodes: ["post_period_not_complete"],
    });
  }

  const metric = {
    metricKey: event.metricKey,
    fuelGroup: event.fuelGroup,
    vehicleCategory: event.vehicleCategory,
    oem: event.oem,
  };
  const conversion = mtdRowsToDailyIncrements(
    [...focalRows, ...candidateRows],
    {
      from: windows.preStart,
      to: windows.postEnd,
      metric,
    },
  );
  const focalIdentity = uniqueEntityIdentity(focalRows, metric);
  if (!focalIdentity) {
    return finalizeResult({
      ...base,
      diagnostics: conversionDiagnostics(conversion),
    }, {
      status: "blocked_data",
      reasonCodes: ["focal_rto_not_unique_or_missing"],
    });
  }

  const targetIssues = focalTargetIssues(event, focalIdentity);
  if (targetIssues.length > 0) {
    return finalizeResult({
      ...base,
      diagnostics: conversionDiagnostics(conversion),
    }, {
      status: "blocked_data",
      reasonCodes: targetIssues,
    });
  }

  const preDates = dateRange(windows.preStart, windows.preEnd);
  const postDates = dateRange(windows.postStart, windows.postEnd);
  const observationsByKey = groupBy(conversion.observations, (row) => row.key);
  const focalObservations = observationsByKey.get(focalIdentity.key) ?? [];
  const focalPreCoverage = coverageFor(focalObservations, preDates);
  const focalPostCoverage = coverageFor(focalObservations, postDates);
  const hardIssuesByKey = hardIssuesForWindow(
    conversion.rejectedRows,
    windows.preStart,
    windows.postEnd,
  );
  const preHardIssueKeys = hardIssuesForWindow(
    conversion.rejectedRows,
    windows.preStart,
    windows.preEnd,
  ).map((item) => item.key);
  const peerSelection = selectFrozenPeers({
    event,
    focalKey: focalIdentity.key,
    observations: conversion.observations,
    entities: conversion.entities,
    preStart: windows.preStart,
    preEnd: windows.preEnd,
    minCoverage: settings.minCoverage,
    minControls: settings.minControls,
    maxControls: settings.maxControls,
    hardIssueKeys: preHardIssueKeys,
  });
  const controlCoverage = peerSelection.selected.map((peer) => {
    const rows = observationsByKey.get(peer.key) ?? [];
    return {
      key: peer.key,
      state: peer.state,
      rto: peer.rto,
      pre: coverageFor(rows, preDates),
      post: coverageFor(rows, postDates),
    };
  });
  const coverage = {
    minimumRequired: settings.minCoverage,
    focal: {
      key: focalIdentity.key,
      state: focalIdentity.state,
      rto: focalIdentity.rto,
      pre: focalPreCoverage,
      post: focalPostCoverage,
    },
    controls: controlCoverage,
  };
  const diagnostics = {
    ...conversionDiagnostics(conversion),
    hardIssues: hardIssuesByKey,
    activeConfounders: event.confounders.filter((item) => item.active),
  };
  const populatedBase = {
    ...base,
    coverage,
    peerSelection,
    diagnostics,
  };

  const selectedKeys = new Set([
    focalIdentity.key,
    ...peerSelection.selected.map((peer) => peer.key),
  ]);
  const selectedHardIssues = hardIssuesByKey.filter((item) => selectedKeys.has(item.key));
  const dataIssues = [];
  if (selectedHardIssues.length > 0) dataIssues.push("quality_issue_in_analysis_window");
  if (focalPreCoverage.ratio < settings.minCoverage) dataIssues.push("insufficient_focal_pre_coverage");
  if (focalPostCoverage.ratio < settings.minCoverage) dataIssues.push("insufficient_focal_post_coverage");
  if (peerSelection.selected.length < settings.minControls) dataIssues.push("insufficient_controls");
  if (controlCoverage.some((item) => item.pre.ratio < settings.minCoverage)) {
    dataIssues.push("insufficient_control_pre_coverage");
  }
  if (controlCoverage.some((item) => item.post.ratio < settings.minCoverage)) {
    dataIssues.push("insufficient_control_post_coverage");
  }
  if (dataIssues.length > 0) {
    return finalizeResult(populatedBase, {
      status: "blocked_data",
      reasonCodes: dataIssues,
    });
  }
  if (event.hasConfounder) {
    return finalizeResult(populatedBase, {
      status: "confounded",
      reasonCodes: ["active_relevant_confounder"],
    });
  }

  const focalPreValues = valuesForDates(focalObservations, preDates);
  const focalPostValues = valuesForDates(focalObservations, postDates);
  const controlPeriods = peerSelection.selected.map((peer) => {
    const rows = observationsByKey.get(peer.key) ?? [];
    return {
      key: peer.key,
      pre: valuesForDates(rows, preDates),
      post: valuesForDates(rows, postDates),
    };
  });
  const focalPreMean = mean(focalPreValues);
  const focalPostMean = mean(focalPostValues);
  const focalChange = focalPostMean - focalPreMean;
  const controlChanges = controlPeriods.map((period) => mean(period.post) - mean(period.pre));
  const controlMedianChange = median(controlChanges);
  const effect = focalChange - controlMedianChange;
  const effectThreshold = Math.max(5, Math.abs(focalPreMean) * 0.1);
  const interval = bootstrapEffectInterval({
    focalPreValues,
    focalPostValues,
    controlPeriods,
    iterations: settings.bootstrapIterations,
    confidenceLevel: settings.confidenceLevel,
    seedMaterial: stableSeedMaterial(event, windows, focalIdentity.key, controlPeriods),
  });
  const estimate = {
    unit: "registrations_per_day",
    focalPreMean: round(focalPreMean),
    focalPostMean: round(focalPostMean),
    focalChange: round(focalChange),
    controlMedianChange: round(controlMedianChange),
    controlChanges: controlPeriods.map((period, index) => ({
      key: period.key,
      change: round(controlChanges[index]),
    })),
    effect: round(effect),
    effectThreshold: round(effectThreshold),
    relativeEffect: focalPreMean === 0 ? null : round(effect / focalPreMean),
    interval,
  };
  const intervalExcludesZeroInDirection = effect > 0
    ? interval.lower > 0
    : effect < 0
      ? interval.upper < 0
      : false;
  const isPractical = Math.abs(effect) >= effectThreshold;
  const statisticalStatus = isPractical && intervalExcludesZeroInDirection
    ? "supported_association"
    : !isPractical && interval.lower <= 0 && interval.upper >= 0
      ? "no_effect"
      : "mixed_evidence";
  const contradictsExpectedDirection =
    statisticalStatus === "supported_association" &&
    (
      (event.expectedDirection === "increase" && effect < 0) ||
      (event.expectedDirection === "decrease" && effect > 0)
    );
  const status = contradictsExpectedDirection ? "mixed_evidence" : statisticalStatus;
  const reasonCodes = contradictsExpectedDirection
    ? ["effect_opposes_expected_direction", "interval_excludes_zero", "practical_effect"]
    : status === "supported_association"
      ? ["practical_effect_and_interval_excludes_zero"]
      : status === "no_effect"
        ? ["effect_below_practical_threshold", "interval_includes_zero"]
        : [
            isPractical ? "practical_effect" : "effect_below_practical_threshold",
            intervalExcludesZeroInDirection ? "interval_excludes_zero" : "interval_includes_zero",
          ];

  return finalizeResult({
    ...populatedBase,
    estimate,
  }, {
    status,
    reasonCodes,
  });
}

function baseResult({
  event,
  windows,
  settings,
  evidenceEligibility,
  dataEligibility,
}) {
  return {
    status: null,
    eligible: false,
    reasonCodes: [],
    interpretation: null,
    event,
    windows,
    dataEligibility,
    evidenceEligibility,
    coverage: null,
    peerSelection: null,
    estimate: null,
    diagnostics: {
      rejectedRows: [],
      seriesDiagnostics: [],
      hardIssues: [],
      activeConfounders: event.confounders.filter((item) => item.active),
    },
    algorithm: {
      name: "robust_median_difference_in_differences",
      version: ALGORITHM_VERSION,
      preDays: settings.preDays,
      postDays: settings.postDays,
      minCoverage: settings.minCoverage,
      minControls: settings.minControls,
      maxControls: settings.maxControls,
      bootstrapIterations: settings.bootstrapIterations,
      confidenceLevel: settings.confidenceLevel,
      peerSelection: "pre_period_only_standardized_distance",
      controlAggregation: "median",
      intervalMethod: "deterministic_seeded_percentile_bootstrap",
    },
  };
}

function finalizeResult(base, { status, reasonCodes }) {
  const decisionReady = ["no_effect", "mixed_evidence", "supported_association"].includes(status);
  return {
    ...base,
    status,
    eligible: decisionReady,
    reasonCodes: uniqueSorted(reasonCodes),
    interpretation: interpretationFor(status),
  };
}

function interpretationFor(status) {
  if (status === "supported_association") {
    return "The registration movement is consistent with the event timing and frozen comparison group. This is an association only and does not establish why registrations changed.";
  }
  if (status === "mixed_evidence") {
    return "The registration movement and comparison evidence do not support a clear finding. The event may be reported only as unresolved context.";
  }
  if (status === "no_effect") {
    return "No practically meaningful registration association was detected for this event window and frozen comparison group.";
  }
  if (status === "confounded") {
    return "A relevant overlapping event prevents this registration movement from being attributed to the tested event.";
  }
  if (status === "too_early") {
    return "The complete post-event observation window is not available yet.";
  }
  if (status === "blocked_evidence") {
    return "The event evidence is not eligible for validation or report use.";
  }
  return "The registration data does not pass the required quality and coverage gates.";
}

function evidenceEligibilityFor(event) {
  const sourceDiagnostics = event.sources.map((source) => {
    const reasonCodes = [];
    if (!source.id) reasonCodes.push("missing_source_id");
    if (!RTO_FACTOR_ELIGIBLE_SOURCE_TIERS.includes(source.tier)) {
      reasonCodes.push("source_tier_not_eligible");
    }
    if (!source.verified) reasonCodes.push("source_not_verified");
    return {
      id: source.id,
      tier: source.tier,
      verified: source.verified,
      eligible: reasonCodes.length === 0,
      reasonCodes,
    };
  });
  const eligibleSourceIds = sourceDiagnostics
    .filter((source) => source.eligible)
    .map((source) => source.id);
  const issues = [];
  if (event.sources.length === 0) issues.push("missing_sources");
  if (eligibleSourceIds.length === 0) issues.push("no_verified_tier_a_or_b_source");
  return {
    eligible: issues.length === 0,
    issues,
    eligibleSourceIds,
    sources: sourceDiagnostics,
  };
}

function dataContextEligibility(dataContext, settings) {
  if (!settings.requireReadyContext) {
    return {
      eligible: true,
      issues: [],
      batchStatus: cleanText(dataContext?.batchStatus ?? dataContext?.batch_status) || null,
      reportStatus: cleanText(dataContext?.reportStatus ?? dataContext?.report_status) || null,
      gateEnforced: false,
    };
  }
  const batchStatus = cleanText(dataContext?.batchStatus ?? dataContext?.batch_status).toLowerCase() || null;
  const reportStatus = cleanText(dataContext?.reportStatus ?? dataContext?.report_status).toLowerCase() || null;
  const issues = [];
  if (batchStatus !== "ready") issues.push(batchStatus ? "batch_not_ready" : "missing_batch_status");
  if (reportStatus !== "ready") issues.push(reportStatus ? "report_not_ready" : "missing_report_status");
  return {
    eligible: issues.length === 0,
    issues,
    batchStatus,
    reportStatus,
    gateEnforced: true,
  };
}

function validationSettings(options) {
  const minControls = Math.max(
    RTO_FACTOR_VALIDATION_DEFAULTS.minControls,
    positiveInt(options.minControls, RTO_FACTOR_VALIDATION_DEFAULTS.minControls),
  );
  return {
    preDays: positiveInt(options.preDays, RTO_FACTOR_VALIDATION_DEFAULTS.preDays),
    postDays: positiveInt(options.postDays, RTO_FACTOR_VALIDATION_DEFAULTS.postDays),
    minCoverage: boundedNumber(
      options.minCoverage,
      RTO_FACTOR_VALIDATION_DEFAULTS.minCoverage,
      1,
      RTO_FACTOR_VALIDATION_DEFAULTS.minCoverage,
    ),
    minControls,
    maxControls: Math.max(
      minControls,
      positiveInt(options.maxControls, RTO_FACTOR_VALIDATION_DEFAULTS.maxControls),
    ),
    bootstrapIterations: boundedInt(
      options.bootstrapIterations,
      200,
      5_000,
      RTO_FACTOR_VALIDATION_DEFAULTS.bootstrapIterations,
    ),
    confidenceLevel: boundedNumber(
      options.confidenceLevel,
      0.8,
      0.99,
      RTO_FACTOR_VALIDATION_DEFAULTS.confidenceLevel,
    ),
    requireReadyContext: options.requireReadyContext === undefined
      ? RTO_FACTOR_VALIDATION_DEFAULTS.requireReadyContext
      : options.requireReadyContext === true,
  };
}

function canonicalMtdRow(input, index) {
  const state = cleanText(input?.state);
  const rto = cleanText(input?.rto);
  const snapshotDate = dateOnly(input?.snapshotDate ?? input?.snapshot_date ?? input?.date);
  const reportTotalRaw = input?.reportTotal
    ?? input?.report_total
    ?? input?.mtdTotal
    ?? input?.mtd_total
    ?? input?.value;
  const reportTotal = finiteNumber(reportTotalRaw);
  const fuelGroup = upperText(input?.fuelGroup ?? input?.fuel_group) || null;
  const vehicleCategory = upperText(input?.vehicleCategory ?? input?.vehicle_category) || null;
  const oem = cleanText(input?.oem ?? input?.manufacturer) || null;
  const metricKey = cleanText(input?.metricKey ?? input?.metric_key)
    || [fuelGroup, vehicleCategory, oem].filter(Boolean).join("|")
    || "TOTAL";
  const componentKey = [metricKey, fuelGroup, vehicleCategory, oem].map((value) => value ?? "").join("|");
  const key = entityKey(state, rto);
  return {
    index,
    state,
    rto,
    entityKey: key,
    snapshotDate,
    targetMonth: cleanText(input?.targetMonth ?? input?.target_month) || null,
    reportTotal,
    rawReportTotal: reportTotalRaw,
    fuelGroup,
    vehicleCategory,
    oem,
    metricKey,
    componentKey,
    seriesKey: `${key}\u0001${componentKey}`,
    scrapeStatus: cleanText(input?.scrapeStatus ?? input?.scrape_status ?? input?.status).toLowerCase() || null,
    qualityStatus: cleanText(input?.qualityStatus ?? input?.quality_status).toLowerCase() || null,
    qualityFlags: parseQualityFlags(input?.qualityFlags ?? input?.quality_flags),
    filtersConfirmed: booleanOrNull(input?.filtersConfirmed ?? input?.filters_confirmed),
    lateFill: Boolean(input?.lateFill ?? input?.late_fill),
    eventExposed: Boolean(input?.eventExposed ?? input?.event_exposed ?? input?.exposed),
  };
}

function rowQualityIssues(row) {
  const issues = [];
  if (!row.snapshotDate) issues.push("invalid_snapshot_date");
  if (!row.state || !row.rto) issues.push("missing_rto_identity");
  if (row.reportTotal === null || row.reportTotal < 0 || !Number.isInteger(row.reportTotal)) {
    issues.push("invalid_mtd_total");
  }
  if (row.scrapeStatus !== "success") {
    issues.push(row.scrapeStatus === "late_fill" || row.lateFill ? "late_fill" : "scrape_not_success");
  }
  if (row.qualityStatus && row.qualityStatus !== "ready") issues.push("quality_not_ready");
  if (!row.qualityStatus && row.filtersConfirmed !== true) issues.push("unproven_row_quality");
  if (row.filtersConfirmed === false) issues.push("filters_not_confirmed");
  if (qualityFlagsPresent(row.qualityFlags)) issues.push("quality_flag_present");
  if (row.targetMonth && row.snapshotDate && row.targetMonth !== row.snapshotDate.slice(0, 7)) {
    issues.push("target_month_mismatch");
  }
  return uniqueSorted(issues);
}

function rowMatchesMetric(row, metric) {
  if (!metric) return true;
  if (metric.fuelGroup && row.fuelGroup !== upperText(metric.fuelGroup)) return false;
  if (metric.vehicleCategory && row.vehicleCategory !== upperText(metric.vehicleCategory)) return false;
  if (metric.oem && lowerText(row.oem) !== lowerText(metric.oem)) return false;
  if (
    metric.metricKey
    && !metric.fuelGroup
    && !metric.vehicleCategory
    && !metric.oem
    && row.metricKey !== metric.metricKey
  ) {
    return false;
  }
  return true;
}

function normalizeTargets(input, defaultState) {
  const raw = [];
  if (input.rto) raw.push({ state: defaultState, rto: input.rto });
  if (Array.isArray(input.rtos)) raw.push(...input.rtos);
  if (Array.isArray(input.targets)) raw.push(...input.targets);
  const targets = raw.map((target) => {
    if (typeof target === "string") return { state: defaultState, rto: cleanText(target) };
    return {
      state: cleanText(target?.state ?? defaultState),
      rto: cleanText(target?.rto ?? target?.name),
    };
  }).filter((target) => target.state && target.rto);
  const unique = new Map(targets.map((target) => [entityKey(target.state, target.rto), target]));
  return [...unique.values()].sort((a, b) => entityKey(a.state, a.rto).localeCompare(entityKey(b.state, b.rto)));
}

function normalizeSource(source, index) {
  const rawTier = upperText(source?.tier ?? source?.sourceTier ?? source?.source_tier);
  const tier = rawTier.replace(/^TIER[\s_-]*/, "") || null;
  const reviewStatus = cleanText(source?.reviewStatus ?? source?.review_status).toLowerCase();
  return {
    id: cleanText(source?.id ?? source?.sourceId ?? source?.source_id) || null,
    tier,
    verified: source?.verified === true
      || source?.approved === true
      || reviewStatus === "accepted"
      || reviewStatus === "approved",
    url: cleanText(source?.url ?? source?.sourceUrl ?? source?.source_url) || null,
    index,
  };
}

function normalizeConfounders(input) {
  const values = Array.isArray(input.confounders) ? input.confounders : [];
  return values.map((item, index) => ({
    id: cleanText(item?.id ?? item?.confounderId ?? item?.confounder_id) || `confounder-${index + 1}`,
    label: cleanText(item?.label ?? item?.title ?? item?.name) || null,
    active: item?.active !== false && item?.relevant !== false && item?.resolved !== true,
  }));
}

function focalTargetIssues(event, focal) {
  const issues = [];
  if (event.scopeLevel === "state" && focal.state !== event.state) {
    issues.push("focal_outside_event_state");
  }
  if (
    event.scopeLevel === "rto"
    && !event.rtos.some((target) => entityKey(target.state, target.rto) === focal.key)
  ) {
    issues.push("focal_not_event_target");
  }
  return issues;
}

function uniqueEntityIdentity(rows, metric) {
  const identities = new Map();
  for (let index = 0; index < (Array.isArray(rows) ? rows : []).length; index += 1) {
    const row = canonicalMtdRow(rows[index], index);
    if (!rowMatchesMetric(row, metric) || !row.state || !row.rto) continue;
    identities.set(row.entityKey, { key: row.entityKey, state: row.state, rto: row.rto });
  }
  return identities.size === 1 ? [...identities.values()][0] : null;
}

function hardIssuesForWindow(rejectedRows, from, to) {
  const relevant = (Array.isArray(rejectedRows) ? rejectedRows : []).filter((item) =>
    item.snapshotDate
    && item.snapshotDate >= from
    && item.snapshotDate <= to
    && item.reasonCodes.some((reason) => HARD_ROW_ISSUES.has(reason)));
  const grouped = groupBy(relevant, (item) => item.key);
  return [...grouped.entries()].map(([key, items]) => ({
    key,
    state: items[0]?.state ?? null,
    rto: items[0]?.rto ?? null,
    dates: uniqueSorted(items.map((item) => item.snapshotDate)),
    reasonCodes: uniqueSorted(items.flatMap((item) => item.reasonCodes)),
  })).sort((a, b) => a.key.localeCompare(b.key));
}

function conversionDiagnostics(conversion) {
  return {
    rejectedRows: conversion.rejectedRows,
    seriesDiagnostics: conversion.seriesDiagnostics,
    hardIssues: [],
    activeConfounders: [],
  };
}

function coverageFor(rows, dates) {
  const expected = Array.isArray(dates) ? dates : [];
  const observedSet = new Set((Array.isArray(rows) ? rows : []).map((row) => row.snapshotDate));
  const missingDates = expected.filter((date) => !observedSet.has(date));
  const observedDays = expected.length - missingDates.length;
  return {
    expectedDays: expected.length,
    observedDays,
    ratio: expected.length === 0 ? 0 : round(observedDays / expected.length),
    missingDates,
  };
}

function valuesForDates(rows, dates) {
  const byDate = new Map((Array.isArray(rows) ? rows : []).map((row) => [row.snapshotDate, row.value]));
  return (Array.isArray(dates) ? dates : [])
    .filter((date) => byDate.has(date))
    .map((date) => byDate.get(date));
}

function prePeriodFeatures(values) {
  const numericValues = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  return {
    mean: mean(numericValues),
    trend: linearSlope(numericValues),
    standardDeviation: standardDeviation(numericValues),
  };
}

function peerFeatureScales(focal, candidateFeatures) {
  const fields = ["mean", "trend", "standardDeviation"];
  return Object.fromEntries(fields.map((field) => {
    const differences = candidateFeatures.map((features) => Math.abs(features[field] - focal[field]));
    const robust = medianAbsoluteDeviation(differences);
    const fallback = median(differences.filter((value) => value > 0));
    return [field, robust > 0 ? robust : fallback > 0 ? fallback : Math.max(1, Math.abs(focal[field]) * 0.1)];
  }));
}

function bootstrapEffectInterval({
  focalPreValues,
  focalPostValues,
  controlPeriods,
  iterations,
  confidenceLevel,
  seedMaterial,
}) {
  const random = seededRandom(fnv1a(seedMaterial));
  const effects = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const focalChange = resampledMean(focalPostValues, random) - resampledMean(focalPreValues, random);
    const controlChanges = controlPeriods.map((period) =>
      resampledMean(period.post, random) - resampledMean(period.pre, random));
    effects.push(focalChange - median(controlChanges));
  }
  effects.sort((a, b) => a - b);
  const alpha = (1 - confidenceLevel) / 2;
  return {
    lower: round(percentile(effects, alpha)),
    upper: round(percentile(effects, 1 - alpha)),
    level: confidenceLevel,
    method: "deterministic_seeded_percentile_bootstrap",
    iterations,
  };
}

function stableSeedMaterial(event, windows, focalKey, controlPeriods) {
  return JSON.stringify({
    eventId: event.id,
    effectiveDate: event.effectiveDate,
    windows,
    focalKey,
    controls: controlPeriods.map((period) => ({
      key: period.key,
      pre: period.pre,
      post: period.post,
    })),
  });
}

function resampledMean(values, random) {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[Math.floor(random() * values.length)];
  }
  return total / values.length;
}

function seededRandom(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function percentile(sortedValues, probability) {
  if (sortedValues.length === 0) return 0;
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return sum(values) / values.length;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function medianAbsoluteDeviation(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function standardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
}

function linearSlope(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    numerator += (index - xMean) * (values[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function scaledDifference(value, reference, scale) {
  return scale === 0 ? 0 : (value - reference) / scale;
}

function roundedFeatures(features) {
  return {
    mean: round(features.mean),
    trend: round(features.trend),
    standardDeviation: round(features.standardDeviation),
  };
}

function parseQualityFlags(value) {
  if (value === null || value === undefined || value === "") return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { unparseable: true };
    }
  }
  return value;
}

function qualityFlagsPresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== "object") return Boolean(value);
  return Object.values(value).some((item) => {
    if (Array.isArray(item)) return item.length > 0;
    if (item && typeof item === "object") return Object.keys(item).length > 0;
    return Boolean(item);
  });
}

function rejectedRow(row, reasonCodes) {
  return {
    index: row.index,
    state: row.state || null,
    rto: row.rto || null,
    key: row.entityKey || null,
    snapshotDate: row.snapshotDate || null,
    componentKey: row.componentKey || null,
    reasonCodes: uniqueSorted(reasonCodes),
  };
}

function containsCausalClaim(value) {
  return /\b(caused?|because of|due to|led to|resulted in|drove|driven by|responsible for)\b/i.test(value);
}

function entityKey(state, rto) {
  return `${cleanText(state)}\u0000${cleanText(rto)}`;
}

function dateOnly(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === match[1]
    ? match[1]
    : null;
}

function addDays(value, amount) {
  const date = dateOnly(value);
  if (!date) return null;
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

function dateRange(from, to) {
  const start = dateOnly(from);
  const end = dateOnly(to);
  if (!start || !end || start > end) return [];
  const dates = [];
  for (let current = start; current <= end; current = addDays(current, 1)) dates.push(current);
  return dates;
}

function latestDate(rows) {
  const dates = (Array.isArray(rows) ? rows : [])
    .map((row) => dateOnly(row?.snapshotDate ?? row?.snapshot_date ?? row?.date))
    .filter(Boolean)
    .sort();
  return dates.at(-1) ?? null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
  if (value === true || value === false) return value;
  if (String(value).toLowerCase() === "true") return true;
  if (String(value).toLowerCase() === "false") return false;
  return null;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function upperText(value) {
  return cleanText(value).toUpperCase();
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function boundedInt(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function groupBy(values, keyFor) {
  const grouped = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }
  return grouped;
}

function compareRows(a, b) {
  return a.snapshotDate.localeCompare(b.snapshotDate) || a.index - b.index;
}

function compareObservations(a, b) {
  return a.key.localeCompare(b.key) || a.snapshotDate.localeCompare(b.snapshotDate);
}

function compareRejectedRows(a, b) {
  return String(a.key).localeCompare(String(b.key))
    || String(a.snapshotDate).localeCompare(String(b.snapshotDate))
    || a.index - b.index;
}
