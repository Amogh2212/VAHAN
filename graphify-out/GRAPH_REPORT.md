# Graph Report - Vahan EY  (2026-06-12)

## Corpus Check
- 30 files · ~2,192,200 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 705 nodes · 1729 edges · 27 communities detected
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 96 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4f94abc1`
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

## God Nodes (most connected - your core abstractions)
1. `query()` - 40 edges
2. `buildMonthlySalesReport()` - 34 edges
3. `queryData()` - 30 edges
4. `hasDatabaseUrl()` - 23 edges
5. `normalizeLookup()` - 18 edges
6. `render()` - 18 edges
7. `scrape()` - 18 edges
8. `buildTelegramSummary()` - 13 edges
9. `loadObservations()` - 13 edges
10. `loadRows()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `loadCatalog()` --calls--> `buildRtoCatalogFromRows()`  [INFERRED]
  server.mjs → lib/rto-resolver.mjs
- `loadCatalog()` --calls--> `hasDatabaseUrl()`  [INFERRED]
  server.mjs → lib/db.mjs
- `resolveRto()` --calls--> `resolveRtoWithCatalog()`  [INFERRED]
  server.mjs → lib/rto-resolver.mjs
- `queryData()` --calls--> `queryRegistrationRows()`  [INFERRED]
  server.mjs → lib/registrations.mjs
- `queryData()` --calls--> `readRegistrationsCsv()`  [INFERRED]
  server.mjs → lib/registrations.mjs

## Communities (30 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (65): hasDatabaseUrl(), buildMakerRegistrationWhere(), deleteMakerRegistrationContexts(), monthKeyNumber(), parseCsvLine(), queryMakerRegistrationRows(), readLegacyMakerFuelCsv(), readMakerRegistrationsCsv() (+57 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (59): appendFileWithRetry(), applyReportSideFilters(), applySideFilters(), assertPrimeCheckboxGroup(), buildReportItems(), buildRtoCatalog(), buildWorkItems(), captureFailureArtifacts() (+51 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (56): buildMonthlySalesReport(), categoryNarrative(), dataNotes(), describeFuelSelection(), displayDateTime(), displayMonth(), displayShortMonth(), escapeHtml() (+48 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (36): queryRtos(), loadRtoCatalog(), buildMonthlySalesReportForUrl(), cleanupJobMap(), cleanupRateLimitBuckets(), cleanupRefreshJobs(), clientIp(), createMapProgress() (+28 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (42): closePool(), connectionStringForPg(), getPool(), query(), shouldUseSsl(), addDays(), completeTrackedQueryRun(), createTrackedQuery() (+34 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (43): applyMapData(), comparisonBaseline(), comparisonDelta(), comparisonLevelFor(), currentBody(), currentParams(), dashboardQuery(), escapeHtml() (+35 more)

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (40): animateCounter(), buildReportCsv(), buildTrendLineChart(), clampChartValue(), compactChartNumber(), compactFilterEntries(), compactRefreshMessage(), dataStatusLabel() (+32 more)

### Community 7 - "Community 7"
Cohesion: 0.14
Nodes (30): apiJson(), compactRefreshMessage(), displayMonth(), escapeHtml(), formatCoverageCount(), formatDelta(), formatPercent(), loadCurrentUser() (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (24): apiJson(), deleteTrackedQuery(), deltaPercent(), deltaText(), disableTrackedQuery(), displayLabel(), escapeHtml(), formatPercent() (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.16
Nodes (24): computeDelta(), dataWarnings(), displayMonthList(), escapeHtml(), extractBracketMeta(), extractQueryLocation(), fetchQuery(), formatChange() (+16 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (25): allowLlmVehicleClass(), allowLlmVehicleGroup(), closestStateAlias(), decodeWithRules(), findFilterValues(), findFuzzyCityAlias(), findMatchingFilterDefinitions(), findStateByLocationText() (+17 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (24): appBaseUrl(), authCookieName(), clearCookieHeader(), cookieHeader(), createSession(), createTelegramLinkCode(), currentUser(), destroySession() (+16 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (18): buildQueue(), buildRetryQueue(), callQuery(), callRefresh(), compactResult(), fileExists(), loadOrCreateReport(), main() (+10 more)

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (19): applyDefaultDateRange(), clampFutureDateRange(), decodeWithAiProviders(), groupMonthKeys(), hasRequestedSideFilterContext(), hasRequiredScrapeFilters(), liveRefreshInfo(), monthKeyToParts() (+11 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (19): completeLoadedMonthKeys(), filterContext(), filterContextValue(), findMissingMonths(), findMissingMonthsFromDb(), hasActiveContext(), hasCompleteMonthlyReportBaseCoverage(), hasMapCoverageFor() (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (16): checkTelegramBigChangeAlerts(), describeFilters(), evShare(), findStatesInText(), formatDashboardTelegramResult(), formatMapComparison(), formatMapStateDetail(), formatMapTopStates() (+8 more)

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (10): buildRtoCatalogFromRows(), deriveAliases(), flattenCatalog(), normalizeRtoLookup(), rankEntries(), resolveRtoWithCatalog(), scoreEntry(), toCatalogRto() (+2 more)

### Community 17 - "Community 17"
Cohesion: 0.32
Nodes (12): assert(), assertMonthlyReport(), assertQuery(), callMapSummary(), callMonthlySalesPdf(), callMonthlySalesReport(), callQuery(), callRtoResolve() (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (11): buildSemanticVocabulary(), combineSemanticPlan(), compact(), exactVocabularyLabels(), findVehicleGroups(), normalizeConfidence(), normalizeSemanticPlan(), semanticFuelSelection() (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.32
Nodes (8): dashboardPayload(), dataReliabilityWarning(), filterRows(), filterRowsIgnoringDate(), hasAmbiguousRtos(), resolveDataStatus(), resolveImmediateDataStatus(), summarizeScraperRuns()

### Community 20 - "Community 20"
Cohesion: 0.32
Nodes (8): currentMonthKey(), monthKey(), parseDateRange(), parseMonthYear(), parseYearOnly(), parseYearRange(), summarize(), summarizeMapRtoRows()

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (8): userForTelegramChat(), consumeTelegramPublicQuota(), handleTelegramMessage(), handleTelegramQuery(), isTrustedTelegramChat(), telegramQuotaLine(), telegramUsageDateKey(), withTelegramQuota()

### Community 22 - "Community 22"
Cohesion: 0.46
Nodes (7): downloadResource(), fetchJson(), main(), parseArgs(), safeFileName(), selectResources(), writeManualTemplate()

### Community 23 - "Community 23"
Cohesion: 0.54
Nodes (7): assert(), fetchJson(), main(), postQuery(), startServer(), stopServer(), waitForHealth()

### Community 24 - "Community 24"
Cohesion: 0.38
Nodes (4): createTelegramBot(), parseAllowedChatIds(), scheduleTelegramSummaries(), startTelegramCommandCenter()

### Community 25 - "Community 25"
Cohesion: 0.8
Nodes (4): fetchJson(), getFreshness(), getSampleRows(), main()

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (4): decodeWithGemini(), decodeWithGroq(), parseJsonFromModelText(), semanticPlannerPrompt()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `buildMonthlySalesReport()` connect `Community 2` to `Community 0`, `Community 3`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `query()` connect `Community 4` to `Community 0`, `Community 3`, `Community 11`, `Community 21`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `renderMonthlySalesReportHtml()` connect `Community 2` to `Community 0`, `Community 3`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Are the 32 inferred relationships involving `query()` (e.g. with `upsertGoogleUser()` and `createSession()`) actually correct?**
  _`query()` has 32 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `buildMonthlySalesReport()` (e.g. with `buildMonthlySalesReportForUrl()` and `main()`) actually correct?**
  _`buildMonthlySalesReport()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `queryData()` (e.g. with `queryRegistrationRows()` and `readRegistrationsCsv()`) actually correct?**
  _`queryData()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `hasDatabaseUrl()` (e.g. with `loadRows()` and `loadMakerRows()`) actually correct?**
  _`hasDatabaseUrl()` has 18 INFERRED edges - model-reasoned connections that need verification._