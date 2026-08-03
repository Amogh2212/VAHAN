# Graph Report - Vahan EY  (2026-08-03)

## Corpus Check
- 115 files · ~258,605 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2198 nodes · 5785 edges · 65 communities detected
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 420 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9558eb87`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]

## God Nodes (most connected - your core abstractions)
1. `query()` - 143 edges
2. `queryData()` - 66 edges
3. `inputError()` - 38 edges
4. `transaction()` - 37 edges
5. `buildMonthlySalesReport()` - 36 edges
6. `hasDatabaseUrl()` - 33 edges
7. `ensureDatabase()` - 33 edges
8. `normalizeLookup()` - 31 edges
9. `closePool()` - 29 edges
10. `decodeWithRules()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `clarificationFor()` --calls--> `queryData()`  [INFERRED]
  scripts/query-ai-repair-unit-check.mjs → server.mjs
- `expectQueryError()` --calls--> `queryData()`  [INFERRED]
  scripts/query-routing-telemetry-unit-check.mjs → server.mjs
- `main()` --calls--> `query()`  [INFERRED]
  scripts/apply-neon-schema.mjs → lib/db.mjs
- `safeErrorMessage()` --calls--> `redactLogValue()`  [INFERRED]
  server.mjs → lib/http-security.mjs
- `getRtoReportWithFactorContext()` --calls--> `getRtoReport()`  [INFERRED]
  server.mjs → lib/rto-reports.mjs

## Communities (74 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (85): loadRtoReportWithOptionalFactorContext(), addDays(), assignRanks(), boundedInt(), buildOemMetric(), buildRtoReportPayloads(), buildSeriesIndex(), capitalize() (+77 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (92): transaction(), ensureCycleWithQuery(), updateCycleTotalWithQuery(), upsertRtoDailySnapshotsWithQuery(), addDays(), addFilter(), assertEventEvidenceEligibility(), assertEvidenceWindowAlignment() (+84 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (79): acquireRtoFactorDailyLock(), assertDailyAutomationWriteEnabled(), boundedAsOfDate(), boundedInteger(), countBy(), dateOnlyOrNull(), listPendingRtoFactorValidations(), normalizeCandidate() (+71 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (62): buildSecurityHeaders(), monthlySalesOemRefreshContexts(), monthlySalesSegmentRefreshContexts(), assertProductionReadinessConfig(), buildMonthlySalesReportForUrl(), cleanupJobMap(), cleanupRateLimitBuckets(), cleanupRefreshJobs() (+54 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (69): addNumericIfPresent(), allowedNumericTokensForSentence(), appendNumericFacts(), assertEvidencePack(), boundedInteger(), buildEvidenceFacts(), buildRetryPrompt(), buildRtoFactorEvidencePack() (+61 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (67): deleteRegistrationContexts(), replaceRegistrationRows(), upsertBatch(), appendFileWithRetry(), applyReportSideFilters(), applySideFilters(), assertPrimeCheckboxGroup(), buildReportItems() (+59 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (63): buildMonthlySalesReport(), categoryNarrative(), contextItems(), dataNotes(), describeFuelSelection(), displayDateTime(), displayMonth(), displayShortMonth() (+55 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (61): addDays(), baseResult(), booleanOrNull(), bootstrapEffectInterval(), boundedInt(), boundedNumber(), canonicalMtdRow(), cleanText() (+53 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (55): addRowToRankGroup(), aggregateTotals(), anomalyFromRow(), barWidth(), buildDailyEvReportSet(), buildMovement(), buildReportForScope(), buildWarnings() (+47 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (52): adminEmails(), appBaseUrl(), authCookieName(), clearCookieHeader(), cookieHeader(), createGoogleSession(), createSession(), createSessionWithQuery() (+44 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (51): normalizeDashboardQueryText(), normalizeDashboardStructuralText(), rtoStateForCode(), interpretation(), allowLlmVehicleCategory(), allowLlmVehicleClass(), allowLlmVehicleGroup(), appendDefinitionEvidence() (+43 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (49): actualFilterSnapshot(), aliasCases(), assertCondition(), assertLocalDatabase(), atomicCases(), canonicalArray(), canonicalFilters(), checkExpectedError() (+41 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (50): concurrentFetch(), headers(), requestReserveFetch(), successfulFetch(), successfulResponse(), tokenReserveFetch(), actualFilterSnapshot(), applyPairChecks() (+42 more)

### Community 13 - "Community 13"
Cohesion: 0.09
Nodes (44): apiJson(), batchesForCadence(), categoryBars(), changeText(), escapeHtml(), evShareComparison(), factorExplanationCard(), factorSourceList() (+36 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (44): animateCounter(), buildReportCsv(), buildTrendLineChart(), clampChartValue(), compactChartNumber(), compactFilterEntries(), compactRefreshMessage(), dataStatusLabel() (+36 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (46): applyMapData(), comparisonBaseline(), comparisonDelta(), comparisonLevelFor(), currentBody(), currentParams(), dashboardQuery(), escapeHtml() (+38 more)

### Community 16 - "Community 16"
Cohesion: 0.1
Nodes (37): buildMakerRegistrationWhere(), dedupeMakerRegistrationRows(), deleteMakerRegistrationContexts(), makerRegistrationKey(), monthKeyNumber(), parseCsvLine(), queryMakerRegistrationRows(), readLegacyMakerFuelCsv() (+29 more)

### Community 17 - "Community 17"
Cohesion: 0.1
Nodes (42): geocodeQueriesForRto(), getRtoGeoProfile(), parseRtoCode(), placeLabelFromRto(), assertValidOverpassBody(), buildFalloutReport(), clampFalloutCycles(), clampWorkerCount() (+34 more)

### Community 18 - "Community 18"
Cohesion: 0.14
Nodes (39): addDays(), claimRtoDailyJob(), createRtoDailyPin(), dateOnly(), deferStaleRtoDailyCycles(), deleteRtoDailyPin(), enqueueRtoDailyJob(), ensureConfigWithQuery() (+31 more)

### Community 19 - "Community 19"
Cohesion: 0.1
Nodes (35): configuredModelName(), empiricalSupportScore(), envInteger(), envPercent(), finiteOr(), finiteOrNull(), firstFinite(), hypothesisConfidenceScore() (+27 more)

### Community 20 - "Community 20"
Cohesion: 0.1
Nodes (34): boundedLimit(), buildInsightRow(), buildOverpassQuery(), choosePattern(), clamp01(), dateOnly(), finiteOrNull(), getRtoInsightDetail() (+26 more)

### Community 21 - "Community 21"
Cohesion: 0.1
Nodes (39): addImportStats(), assertOsmiumAvailable(), averageCoordinate(), buildOsmiumExportConfig(), buildOsmiumFilterExpressions(), createImportStats(), createSpatialIndex(), downloadGeofabrikExtract() (+31 more)

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (38): buildSnapshotRows(), completeRtoDailyCollectionRun(), completeRtoDailyJob(), countForOem(), createRtoDailyCollectionRun(), heartbeatRtoDailyJob(), listRtoDailyConfigs(), markRtoDailyConfigStatus() (+30 more)

### Community 23 - "Community 23"
Cohesion: 0.1
Nodes (37): addDays(), completeTrackedQueryRun(), createTrackedQuery(), createTrackedQueryRun(), dateOnly(), dateRange(), deleteTrackedQuery(), disableTrackedQuery() (+29 more)

### Community 24 - "Community 24"
Cohesion: 0.07
Nodes (35): appliedFilters(), assertExpectedFilters(), errorCase(), sampleRows(), successCase(), expectedError(), answerFilterVariants(), applyDefaultDateRange() (+27 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (35): apiJson(), autoRefreshKey(), compactRefreshMessage(), displayMonth(), displayMonthList(), escapeHtml(), formatCoverageCount(), formatDelta() (+27 more)

### Community 26 - "Community 26"
Cohesion: 0.1
Nodes (38): hasDatabaseUrl(), loadRegistrationRowsFromDb(), queryRegistrationFreshness(), buildTelegramSummary(), checkTelegramBigChangeAlerts(), csvHealthPayload(), dashboardMetricRate(), dashboardQueryRoutingMetricsSnapshot() (+30 more)

### Community 27 - "Community 27"
Cohesion: 0.08
Nodes (38): addMonths(), aggregateComparisonKey(), completeLoadedMonthKeys(), currentMonthKey(), dashboardPayload(), dataReliabilityWarning(), dateRange(), filterContext() (+30 more)

### Community 28 - "Community 28"
Cohesion: 0.13
Nodes (34): apiJson(), closeSuggestions(), escapeHtml(), hideNotice(), init(), latestMovement(), loadCurrentUser(), loadPins() (+26 more)

### Community 29 - "Community 29"
Cohesion: 0.1
Nodes (31): fetchImpl(), compact(), configuredAiQueryProvider(), configuredDashboardQueryRoutingMode(), configuredGroqCacheTtl(), configuredGroqInterval(), configuredGroqModel(), configuredGroqRateLimitCooldown() (+23 more)

### Community 30 - "Community 30"
Cohesion: 0.14
Nodes (24): apiJson(), deleteTrackedQuery(), deltaPercent(), deltaText(), disableTrackedQuery(), displayLabel(), escapeHtml(), formatPercent() (+16 more)

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (28): arrayIncludesAll(), buildMarkdownReport(), buildQueue(), callQuery(), callRefresh(), categorize(), compactResult(), emitRegressionCases() (+20 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (22): closePool(), connectionStringForPg(), getPool(), isRetryableDatabaseError(), queryWithRetry(), retryDelayMs(), shouldUseSsl(), sleep() (+14 more)

### Community 33 - "Community 33"
Cohesion: 0.17
Nodes (27): assertAllowedKeys(), assertEvidenceEligibility(), assertManualIntakeMethod(), assertServices(), assertUnique(), assertWriteGate(), boundedText(), compileManualRtoFactorEventInput() (+19 more)

### Community 34 - "Community 34"
Cohesion: 0.16
Nodes (24): computeDelta(), dataWarnings(), displayMonthList(), escapeHtml(), extractBracketMeta(), extractQueryLocation(), fetchQuery(), formatChange() (+16 more)

### Community 35 - "Community 35"
Cohesion: 0.17
Nodes (22): query(), getRtoReport(), getRtoReportBatch(), listRtoReportsForBatch(), renderRtoReportBatchCsv(), applyCohort(), coverage(), dateOnly() (+14 more)

### Community 36 - "Community 36"
Cohesion: 0.2
Nodes (18): apiJson(), displayDateTime(), escapeHtml(), loadDetail(), loadSummary(), metricCard(), renderEmptyDetail(), renderHealth() (+10 more)

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (20): cacheKey(), cleanPlaceLabel(), confidenceForMatch(), formatConfidence(), formatCoordinate(), geocode(), geocodeRow(), hasCoordinates() (+12 more)

### Community 38 - "Community 38"
Cohesion: 0.17
Nodes (18): buildQueue(), buildRetryQueue(), callQuery(), callRefresh(), compactResult(), fileExists(), loadOrCreateReport(), main() (+10 more)

### Community 39 - "Community 39"
Cohesion: 0.16
Nodes (20): appendExactRepairConflict(), boundedModelText(), buildSemanticVocabulary(), canonicalAiState(), exactInterpretationValues(), labelIntersections(), modelStringArray(), normalizeConfidence() (+12 more)

### Community 40 - "Community 40"
Cohesion: 0.15
Nodes (16): buildRegistrationWhere(), contextValue(), monthKeyNumber(), parseCsvLine(), queryAvailableMonthFuelTypes(), queryAvailableMonths(), queryRegistrationRows(), queryRtos() (+8 more)

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (6): Flowable, callout(), make_table(), p(), section(), SectionRule

### Community 42 - "Community 42"
Cohesion: 0.22
Nodes (13): buildRtoCatalogFromRows(), deriveAliases(), flattenCatalog(), normalizeRtoLookup(), rankEntries(), resolveRtoWithCatalog(), scoreEntry(), searchRtoCatalog() (+5 more)

### Community 43 - "Community 43"
Cohesion: 0.23
Nodes (16): bestMatch(), candidateNames(), cleanPlaceLabel(), formatConfidence(), formatCoordinate(), hasCoordinates(), loadAdmin1(), loadGeoNames() (+8 more)

### Community 44 - "Community 44"
Cohesion: 0.18
Nodes (17): consumeTelegramPublicQuota(), describeFilters(), evShare(), findStatesInText(), formatDashboardTelegramResult(), formatMapComparison(), formatMapStateDetail(), formatMapTopStates() (+9 more)

### Community 45 - "Community 45"
Cohesion: 0.28
Nodes (14): assert(), assertMonthlyReport(), assertQuery(), callMapQueryError(), callMapSummary(), callMonthlySalesPdf(), callMonthlySalesReport(), callQuery() (+6 more)

### Community 46 - "Community 46"
Cohesion: 0.32
Nodes (10): acceptance_chart(), build_report(), bullet(), data_table(), filter_summary(), p(), phase_block(), routing_chart() (+2 more)

### Community 47 - "Community 47"
Cohesion: 0.24
Nodes (11): assertNoPageOverflow(), assertReadinessPillAligned(), assertTabsContained(), expectMetricCard(), fulfillEmptyReportApi(), fulfillReportApi(), fullReport(), json() (+3 more)

### Community 48 - "Community 48"
Cohesion: 0.32
Nodes (12): copyTable(), counts(), isLocalHostname(), main(), parseArgs(), parsedDatabaseUrl(), poolConfig(), quoteIdentifier() (+4 more)

### Community 49 - "Community 49"
Cohesion: 0.18
Nodes (11): findStateByLocationText(), fuzzyCandidateSignature(), hasExplicitMapLocation(), mapBaseFilters(), mapFiltersFromQuery(), mapFiltersFromUrl(), mergeFilters(), queryFiltersFromSearchParams() (+3 more)

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (10): dedupeOsmElements(), summarizeOsmSignal(), uniqueStrings(), addImportStats(), createImportStats(), itemWorker(), processSignalItem(), processTarget() (+2 more)

### Community 52 - "Community 52"
Cohesion: 0.46
Nodes (7): upsertRtoGeoProfile(), main(), numericOrNull(), parseArgs(), parseBoolean(), parseCsv(), printHelp()

### Community 53 - "Community 53"
Cohesion: 0.46
Nodes (7): downloadResource(), fetchJson(), main(), parseArgs(), safeFileName(), selectResources(), writeManualTemplate()

### Community 54 - "Community 54"
Cohesion: 0.54
Nodes (7): assert(), fetchJson(), main(), postQuery(), startServer(), stopServer(), waitForHealth()

### Community 55 - "Community 55"
Cohesion: 0.38
Nodes (4): createTelegramBot(), parseAllowedChatIds(), scheduleTelegramSummaries(), startTelegramCommandCenter()

### Community 57 - "Community 57"
Cohesion: 0.52
Nodes (6): assertErrorContract(), assertLocalDatabase(), main(), requestJson(), startServer(), waitForHealth()

### Community 58 - "Community 58"
Cohesion: 0.62
Nodes (6): insertRows(), localDatabaseUrl(), main(), parseArgs(), quoted(), resetSequence()

### Community 60 - "Community 60"
Cohesion: 0.67
Nodes (5): canConnect(), cleanStop(), config(), ensureDatabase(), main()

### Community 61 - "Community 61"
Cohesion: 0.8
Nodes (4): fetchJson(), getFreshness(), getSampleRows(), main()

### Community 62 - "Community 62"
Cohesion: 0.7
Nodes (4): localDatabaseUrl(), main(), pruneBackups(), timestamp()

### Community 64 - "Community 64"
Cohesion: 0.83
Nodes (3): existingLocalPassword(), main(), setEnvValue()

## Knowledge Gaps
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `query()` connect `Community 35` to `Community 0`, `Community 1`, `Community 2`, `Community 5`, `Community 8`, `Community 9`, `Community 11`, `Community 12`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 21`, `Community 22`, `Community 23`, `Community 26`, `Community 32`, `Community 40`, `Community 52`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `runQuery()` connect `Community 1` to `Community 9`, `Community 18`, `Community 14`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `closePool()` connect `Community 32` to `Community 0`, `Community 33`, `Community 2`, `Community 35`, `Community 5`, `Community 8`, `Community 11`, `Community 12`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 52`, `Community 21`, `Community 22`, `Community 23`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 115 inferred relationships involving `query()` (e.g. with `destroySession()` and `currentUser()`) actually correct?**
  _`query()` has 115 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `queryData()` (e.g. with `readRegistrationsCsv()` and `successCase()`) actually correct?**
  _`queryData()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 25 inferred relationships involving `transaction()` (e.g. with `createGoogleSession()` and `upsertRtoDailyConfigs()`) actually correct?**
  _`transaction()` has 25 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `buildMonthlySalesReport()` (e.g. with `buildMonthlySalesReportForUrl()` and `monthlySalesRecentRefresh()`) actually correct?**
  _`buildMonthlySalesReport()` has 3 INFERRED edges - model-reasoned connections that need verification._