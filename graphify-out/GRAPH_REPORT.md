# Graph Report - public-dashboard-main  (2026-09-01)

## Corpus Check
- 116 files · ~209,047 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2519 nodes · 6728 edges · 68 communities detected
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 518 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8abe0c4c`
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
- [[_COMMUNITY_Community 51|Community 51]]
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
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]

## God Nodes (most connected - your core abstractions)
1. `query()` - 146 edges
2. `queryData()` - 66 edges
3. `queryData()` - 57 edges
4. `hasDatabaseUrl()` - 52 edges
5. `normalizeDashboardQueryText()` - 42 edges
6. `buildMonthlySalesReport()` - 38 edges
7. `inputError()` - 38 edges
8. `transaction()` - 37 edges
9. `ensureDatabase()` - 33 edges
10. `normalizeLookup()` - 31 edges

## Surprising Connections (you probably didn't know these)
- `renderRtoRegistrationReportPdf()` --calls--> `renderRtoReportHtml()`  [INFERRED]
  server.mjs → lib/rto-reports.mjs
- `renderRtoRegistrationReportPdf()` --calls--> `renderRtoReportHtml()`  [INFERRED]
  server.mjs → lib/rto-reports.mjs
- `safeErrorMessage()` --calls--> `redactLogValue()`  [INFERRED]
  server.mjs → lib/http-security.mjs
- `getRtoReportWithFactorContext()` --calls--> `loadRtoReportWithOptionalFactorContext()`  [INFERRED]
  server.mjs → lib/rto-report-context.mjs
- `loadRows()` --calls--> `hasDatabaseUrl()`  [INFERRED]
  server.mjs → lib/db.mjs

## Communities (78 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (117): ensureCycleWithQuery(), updateCycleTotalWithQuery(), addDays(), addFilter(), assertEventEvidenceEligibility(), assertEvidenceWindowAlignment(), assertExplanationCanBeApproved(), assertExplanationCitations() (+109 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (78): buildSecurityHeaders(), monthlySalesOemRefreshContexts(), monthlySalesSegmentRefreshContexts(), assertProductionReadinessConfig(), createDashboardQueryRoutingMetrics(), dashboardGroqQuotaBlock(), editDistanceWithin(), envFlag() (+70 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (83): addDays(), assignRanks(), boundedInt(), buildOemMetric(), buildRtoReportPayloads(), buildSeriesIndex(), capitalize(), checksum() (+75 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (77): closePool(), callQuery(), countMonthRows(), main(), startServer(), summarizeResult(), waitForHealth(), appendFileWithRetry() (+69 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (60): hasDatabaseUrl(), buildMakerRegistrationWhere(), dedupeMakerRegistrationRows(), deleteMakerRegistrationContexts(), makerRegistrationKey(), monthKeyNumber(), parseCsvLine(), queryMakerRegistrationRows() (+52 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (64): buildMonthlySalesReport(), categoryNarrative(), contextItems(), dataNotes(), describeFuelSelection(), displayDateTime(), displayMonth(), displayShortMonth() (+56 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (58): configuredModelName(), empiricalSupportScore(), envInteger(), envPercent(), finiteOr(), finiteOrNull(), firstFinite(), hypothesisConfidenceScore() (+50 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (69): loadRegistrationRowsFromDb(), queryRegistrationFreshness(), assertProductionReadinessConfig(), buildMonthlySalesReportForUrl(), buildTelegramSummary(), checkTelegramBigChangeAlerts(), configuredDashboardQueryRoutingMode(), csvHealthPayload() (+61 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (59): adminEmails(), appBaseUrl(), authCookieName(), clearCookieHeader(), cookieHeader(), createGoogleSession(), createSession(), createSessionWithQuery() (+51 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (63): addNumericIfPresent(), allowedNumericTokensForSentence(), appendNumericFacts(), assertEvidencePack(), boundedInteger(), buildEvidenceFacts(), buildRetryPrompt(), buildRtoFactorEvidencePack() (+55 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (61): addDays(), baseResult(), booleanOrNull(), bootstrapEffectInterval(), boundedInt(), boundedNumber(), canonicalMtdRow(), cleanText() (+53 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (63): allowLlmVehicleCategory(), allowLlmVehicleClass(), allowLlmVehicleGroup(), appendExactRepairConflict(), applySemanticPlanToFilters(), boundedModelText(), buildSemanticVocabulary(), canonicalAiState() (+55 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (55): addRowToRankGroup(), aggregateTotals(), anomalyFromRow(), barWidth(), buildDailyEvReportSet(), buildMovement(), buildReportForScope(), buildWarnings() (+47 more)

### Community 13 - "Community 13"
Cohesion: 0.1
Nodes (56): approvedUrl(), assertAllowedKeys(), assertUnique(), attributeValue(), boundedInteger(), buildCandidate(), candidateUrl(), cleanText() (+48 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (58): interpretation(), allowLlmVehicleCategory(), allowLlmVehicleClass(), allowLlmVehicleGroup(), appendDefinitionEvidence(), closestStateAlias(), conservativeFuzzyDefinitionResult(), containsAlias() (+50 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (55): buildMonthlySalesReportForUrl(), buildTelegramSummary(), checkTelegramBigChangeAlerts(), cleanupJobMap(), cleanupRefreshJobs(), createMapProgress(), csvHealthPayload(), dashboardMetricRate() (+47 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (49): actualFilterSnapshot(), aliasCases(), assertCondition(), assertLocalDatabase(), atomicCases(), canonicalArray(), canonicalFilters(), checkExpectedError() (+41 more)

### Community 17 - "Community 17"
Cohesion: 0.09
Nodes (44): apiJson(), batchesForCadence(), categoryBars(), changeText(), escapeHtml(), evShareComparison(), factorExplanationCard(), factorSourceList() (+36 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (44): animateCounter(), buildReportCsv(), buildTrendLineChart(), clampChartValue(), compactChartNumber(), compactFilterEntries(), compactRefreshMessage(), dataStatusLabel() (+36 more)

### Community 19 - "Community 19"
Cohesion: 0.1
Nodes (48): dedupeOsmElements(), getRtoGeoProfile(), summarizeOsmSignal(), addImportStats(), assertValidOverpassBody(), buildFalloutReport(), clampFalloutCycles(), clampWorkerCount() (+40 more)

### Community 20 - "Community 20"
Cohesion: 0.13
Nodes (45): transaction(), addDays(), claimRtoDailyJob(), completeRtoDailyCollectionRun(), createRtoDailyCollectionRun(), createRtoDailyPin(), dateOnly(), deferStaleRtoDailyCycles() (+37 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (46): applyMapData(), comparisonBaseline(), comparisonDelta(), comparisonLevelFor(), currentBody(), currentParams(), dashboardQuery(), escapeHtml() (+38 more)

### Community 22 - "Community 22"
Cohesion: 0.06
Nodes (43): updateQueryRefreshAudit(), answerFilterVariants(), applyDefaultDateRange(), assertSupportedDashboardQuery(), clampFutureDateRange(), classifyDashboardQueryRouting(), findMissingAnswerMonths(), findMissingAnswerMonthsFromDb() (+35 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (47): answerFilterVariants(), appendExactRepairConflict(), applyDefaultDateRange(), applySemanticPlanToFilters(), boundedModelText(), buildSemanticVocabulary(), canonicalAiState(), combineSemanticPlan() (+39 more)

### Community 24 - "Community 24"
Cohesion: 0.09
Nodes (44): normalizeDashboardQueryText(), normalizeDashboardStructuralText(), rtoStateForCode(), appendDefinitionEvidence(), conservativeFuzzyDefinitionResult(), containsAlias(), decodeWithRules(), deterministicInterpretationConflicts() (+36 more)

### Community 25 - "Community 25"
Cohesion: 0.1
Nodes (38): boundedLimit(), buildInsightRow(), buildOverpassQuery(), choosePattern(), clamp01(), dateOnly(), finiteOrNull(), geocodeQueriesForRto() (+30 more)

### Community 26 - "Community 26"
Cohesion: 0.1
Nodes (42): actualFilterSnapshot(), applyPairChecks(), auditCase(), canonicalPairFilter(), canonicalRows(), canSkipCheckpointResult(), classify(), compareFilters() (+34 more)

### Community 27 - "Community 27"
Cohesion: 0.07
Nodes (43): dashboardGroqQuotaStateForTests(), resetDashboardAiStateForTests(), configError(), configuredOllama(), fetchModelCatalog(), hasRequiredModel(), main(), nextSteps() (+35 more)

### Community 28 - "Community 28"
Cohesion: 0.1
Nodes (39): addImportStats(), assertOsmiumAvailable(), averageCoordinate(), buildOsmiumExportConfig(), buildOsmiumFilterExpressions(), createImportStats(), createSpatialIndex(), downloadGeofabrikExtract() (+31 more)

### Community 29 - "Community 29"
Cohesion: 0.08
Nodes (39): addMonths(), aggregateComparisonKey(), completeLoadedMonthKeys(), currentMonthKey(), dashboardPayload(), dataReliabilityWarning(), dateRange(), filterContext() (+31 more)

### Community 30 - "Community 30"
Cohesion: 0.12
Nodes (35): apiJson(), autoRefreshKey(), compactRefreshMessage(), displayMonth(), displayMonthList(), escapeHtml(), formatCoverageCount(), formatDelta() (+27 more)

### Community 31 - "Community 31"
Cohesion: 0.13
Nodes (34): apiJson(), closeSuggestions(), escapeHtml(), hideNotice(), init(), latestMovement(), loadCurrentUser(), loadPins() (+26 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (33): addDays(), completeTrackedQueryRun(), createTrackedQuery(), createTrackedQueryRun(), dateOnly(), dateRange(), deleteTrackedQuery(), disableTrackedQuery() (+25 more)

### Community 33 - "Community 33"
Cohesion: 0.13
Nodes (33): buildSnapshotRows(), completeRtoDailyJob(), countForOem(), heartbeatRtoDailyJob(), listRtoDailyConfigs(), markRtoDailyConfigStatus(), previewRtoDailyCycle(), rtoDailyCombinationMatrix() (+25 more)

### Community 34 - "Community 34"
Cohesion: 0.14
Nodes (24): apiJson(), deleteTrackedQuery(), deltaPercent(), deltaText(), disableTrackedQuery(), displayLabel(), escapeHtml(), formatPercent() (+16 more)

### Community 35 - "Community 35"
Cohesion: 0.12
Nodes (28): arrayIncludesAll(), buildMarkdownReport(), buildQueue(), callQuery(), callRefresh(), categorize(), compactResult(), emitRegressionCases() (+20 more)

### Community 36 - "Community 36"
Cohesion: 0.09
Nodes (31): addMonths(), aggregateComparisonKey(), completeLoadedMonthKeys(), currentMonthKey(), dashboardPayload(), dataReliabilityWarning(), dateRange(), filterContext() (+23 more)

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (25): query(), getRtoReport(), getRtoReportBatch(), listRtoReportsForBatch(), renderRtoReportBatchCsv(), main(), applyCohort(), coverage() (+17 more)

### Community 38 - "Community 38"
Cohesion: 0.16
Nodes (24): computeDelta(), dataWarnings(), displayMonthList(), escapeHtml(), extractBracketMeta(), extractQueryLocation(), fetchQuery(), formatChange() (+16 more)

### Community 39 - "Community 39"
Cohesion: 0.2
Nodes (18): apiJson(), displayDateTime(), escapeHtml(), loadDetail(), loadSummary(), metricCard(), renderEmptyDetail(), renderHealth() (+10 more)

### Community 40 - "Community 40"
Cohesion: 0.18
Nodes (20): cacheKey(), cleanPlaceLabel(), confidenceForMatch(), formatConfidence(), formatCoordinate(), geocode(), geocodeRow(), hasCoordinates() (+12 more)

### Community 41 - "Community 41"
Cohesion: 0.17
Nodes (18): buildQueue(), buildRetryQueue(), callQuery(), callRefresh(), compactResult(), fileExists(), loadOrCreateReport(), main() (+10 more)

### Community 42 - "Community 42"
Cohesion: 0.15
Nodes (19): consumeTelegramPublicQuota(), describeFilters(), evShare(), findStatesInText(), formatDashboardTelegramResult(), formatMapComparison(), formatMapStateDetail(), formatMapTopStates() (+11 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (6): Flowable, callout(), make_table(), p(), section(), SectionRule

### Community 44 - "Community 44"
Cohesion: 0.23
Nodes (16): bestMatch(), candidateNames(), cleanPlaceLabel(), formatConfidence(), formatCoordinate(), hasCoordinates(), loadAdmin1(), loadGeoNames() (+8 more)

### Community 45 - "Community 45"
Cohesion: 0.24
Nodes (12): buildRtoCatalogFromRows(), deriveAliases(), flattenCatalog(), normalizeRtoLookup(), rankEntries(), resolveRtoWithCatalog(), scoreEntry(), searchRtoCatalog() (+4 more)

### Community 46 - "Community 46"
Cohesion: 0.28
Nodes (14): assert(), assertMonthlyReport(), assertQuery(), callMapQueryError(), callMapSummary(), callMonthlySalesPdf(), callMonthlySalesReport(), callQuery() (+6 more)

### Community 47 - "Community 47"
Cohesion: 0.32
Nodes (10): acceptance_chart(), build_report(), bullet(), data_table(), filter_summary(), p(), phase_block(), routing_chart() (+2 more)

### Community 48 - "Community 48"
Cohesion: 0.24
Nodes (11): assertNoPageOverflow(), assertReadinessPillAligned(), assertTabsContained(), expectMetricCard(), fulfillEmptyReportApi(), fulfillReportApi(), fullReport(), json() (+3 more)

### Community 49 - "Community 49"
Cohesion: 0.32
Nodes (12): copyTable(), counts(), isLocalHostname(), main(), parseArgs(), parsedDatabaseUrl(), poolConfig(), quoteIdentifier() (+4 more)

### Community 50 - "Community 50"
Cohesion: 0.36
Nodes (9): connectionStringForPg(), getPool(), isRetryableDatabaseError(), queryWithRetry(), retryDelayMs(), shouldUseSsl(), sleep(), acquireVahanScrapeLock() (+1 more)

### Community 51 - "Community 51"
Cohesion: 0.27
Nodes (10): queryRtos(), loadRtoCatalog(), loadCatalog(), mergeRtoCatalogs(), canonicalRtoInput(), isSameStateLocation(), loadCatalog(), mergeRtoCatalogs() (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.31
Nodes (6): createTelegramBot(), parseAllowedChatIds(), scheduleTelegramSummaries(), startTelegramCommandCenter(), scheduleTelegramSummaries(), startTelegramCommandCenter()

### Community 54 - "Community 54"
Cohesion: 0.44
Nodes (8): fetchJson(), getFreshness(), getSampleRows(), main(), fetchJson(), getFreshness(), getSampleRows(), main()

### Community 55 - "Community 55"
Cohesion: 0.46
Nodes (7): downloadResource(), fetchJson(), main(), parseArgs(), safeFileName(), selectResources(), writeManualTemplate()

### Community 56 - "Community 56"
Cohesion: 0.46
Nodes (7): upsertRtoGeoProfile(), main(), numericOrNull(), parseArgs(), parseBoolean(), parseCsv(), printHelp()

### Community 57 - "Community 57"
Cohesion: 0.54
Nodes (7): assert(), fetchJson(), main(), postQuery(), startServer(), stopServer(), waitForHealth()

### Community 58 - "Community 58"
Cohesion: 0.39
Nodes (5): loadExistingProfiles(), main(), parseArgs(), printHelp(), toCsv()

### Community 60 - "Community 60"
Cohesion: 0.52
Nodes (6): assertErrorContract(), assertLocalDatabase(), main(), requestJson(), startServer(), waitForHealth()

### Community 61 - "Community 61"
Cohesion: 0.62
Nodes (6): insertRows(), localDatabaseUrl(), main(), parseArgs(), quoted(), resetSequence()

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (5): canConnect(), cleanStop(), config(), ensureDatabase(), main()

### Community 64 - "Community 64"
Cohesion: 0.7
Nodes (4): localDatabaseUrl(), main(), pruneBackups(), timestamp()

### Community 66 - "Community 66"
Cohesion: 0.83
Nodes (3): existingLocalPassword(), main(), setEnvValue()

### Community 67 - "Community 67"
Cohesion: 0.5
Nodes (3): loadRtoReportWithOptionalFactorContext(), getRtoReportWithFactorContext(), getRtoReportWithFactorContext()

## Knowledge Gaps
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `query()` connect `Community 37` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 12`, `Community 16`, `Community 19`, `Community 20`, `Community 22`, `Community 25`, `Community 26`, `Community 28`, `Community 32`, `Community 33`, `Community 50`, `Community 51`, `Community 56`, `Community 58`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `runQuery()` connect `Community 0` to `Community 8`, `Community 18`, `Community 20`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `validateRtoFactorEvent()` connect `Community 10` to `Community 6`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Are the 117 inferred relationships involving `query()` (e.g. with `destroySession()` and `currentUser()`) actually correct?**
  _`query()` has 117 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `queryData()` (e.g. with `readRegistrationsCsv()` and `queryRegistrationRows()`) actually correct?**
  _`queryData()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `queryData()` (e.g. with `readRegistrationsCsv()` and `publicDashboardRefreshEligibility()`) actually correct?**
  _`queryData()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 41 inferred relationships involving `hasDatabaseUrl()` (e.g. with `loadRows()` and `loadMakerRows()`) actually correct?**
  _`hasDatabaseUrl()` has 41 INFERRED edges - model-reasoned connections that need verification._