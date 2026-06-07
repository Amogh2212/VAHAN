# Graph Report - Vahan EY  (2026-06-07)

## Corpus Check
- 26 files · ~1,331,011 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 573 nodes · 1370 edges · 23 communities detected
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 85 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5635de23`
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

## God Nodes (most connected - your core abstractions)
1. `query()` - 32 edges
2. `queryData()` - 28 edges
3. `buildMonthlySalesReport()` - 28 edges
4. `hasDatabaseUrl()` - 21 edges
5. `scrape()` - 17 edges
6. `normalizeLookup()` - 15 edges
7. `render()` - 14 edges
8. `buildTelegramSummary()` - 13 edges
9. `main()` - 12 edges
10. `loadRows()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `loadRows()` --calls--> `hasDatabaseUrl()`  [INFERRED]
  server.mjs → lib/db.mjs
- `loadRows()` --calls--> `readRegistrationsCsv()`  [INFERRED]
  server.mjs → lib/registrations.mjs
- `loadCatalog()` --calls--> `hasDatabaseUrl()`  [INFERRED]
  server.mjs → lib/db.mjs
- `useDatabaseStorage()` --calls--> `hasDatabaseUrl()`  [INFERRED]
  server.mjs → lib/db.mjs
- `resolveRto()` --calls--> `resolveRtoWithCatalog()`  [INFERRED]
  server.mjs → lib/rto-resolver.mjs

## Communities (24 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (53): appendFileWithRetry(), applyReportSideFilters(), applySideFilters(), assertPrimeCheckboxGroup(), buildReportItems(), buildRtoCatalog(), buildWorkItems(), captureFailureArtifacts() (+45 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (41): hasDatabaseUrl(), buildMakerRegistrationWhere(), deleteMakerRegistrationContexts(), monthKeyNumber(), parseCsvLine(), queryMakerRegistrationRows(), readLegacyMakerFuelCsv(), readMakerRegistrationsCsv() (+33 more)

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (42): closePool(), connectionStringForPg(), getPool(), query(), shouldUseSsl(), addDays(), completeTrackedQueryRun(), createTrackedQuery() (+34 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (43): applyMapData(), comparisonBaseline(), comparisonDelta(), comparisonLevelFor(), currentBody(), currentParams(), dashboardQuery(), escapeHtml() (+35 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (41): buildMonthlySalesReport(), categoryNarrative(), dataNotes(), describeFuelSelection(), displayDateTime(), displayMonth(), escapeHtml(), formatDelta() (+33 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (29): buildMonthlySalesReportForUrl(), createMapProgress(), decodeWithGemini(), decodeWithGroq(), extractScrapedRows(), filterRows(), filterRowsIgnoringDate(), hasRequestedSideFilterContext() (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (27): animateCounter(), buildReportCsv(), compactFilterEntries(), compactRefreshMessage(), dataStatusLabel(), displayMonth(), downloadBlob(), downloadCurrentCsv() (+19 more)

### Community 7 - "Community 7"
Cohesion: 0.16
Nodes (24): computeDelta(), dataWarnings(), displayMonthList(), escapeHtml(), extractBracketMeta(), extractQueryLocation(), fetchQuery(), formatChange() (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (24): buildSemanticVocabulary(), closestStateAlias(), combineSemanticPlan(), compact(), decodeWithRules(), exactVocabularyLabels(), findFilterValues(), findFuzzyCityAlias() (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (15): apiJson(), deleteTrackedQuery(), deltaText(), disableTrackedQuery(), displayLabel(), escapeHtml(), latestObservation(), latestRun() (+7 more)

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (18): buildQueue(), buildRetryQueue(), callQuery(), callRefresh(), compactResult(), fileExists(), loadOrCreateReport(), main() (+10 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (19): consumeTelegramPublicQuota(), describeFilters(), evShare(), findStatesInText(), formatDashboardTelegramResult(), formatMapComparison(), formatMapStateDetail(), formatMapTopStates() (+11 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (19): loadRegistrationRowsFromDb(), queryRegistrationFreshness(), buildTelegramSummary(), checkTelegramBigChangeAlerts(), fetchMissingTelegramSummaryRows(), filterMapRows(), freshness(), freshnessFromDb() (+11 more)

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (18): completeLoadedMonthKeys(), filterContext(), filterContextValue(), findMissingMonths(), findMissingMonthsFromDb(), groupMonthKeys(), hasActiveContext(), hasMapCoverageFor() (+10 more)

### Community 14 - "Community 14"
Cohesion: 0.21
Nodes (14): queryRtos(), buildRtoCatalogFromRows(), deriveAliases(), flattenCatalog(), loadRtoCatalog(), normalizeRtoLookup(), rankEntries(), resolveRtoWithCatalog() (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.26
Nodes (11): escapeHtml(), formatDelta(), formatPercent(), loadReport(), queryParams(), renderBars(), renderMetricGrid(), renderReport() (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (13): applyDefaultDateRange(), clampFutureDateRange(), decodeWithAiProviders(), hasRequiredScrapeFilters(), isSameStateLocation(), liveRefreshInfo(), queryData(), resolveRto() (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.32
Nodes (12): assert(), assertMonthlyReport(), assertQuery(), callMapSummary(), callMonthlySalesPdf(), callMonthlySalesReport(), callQuery(), callRtoResolve() (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.23
Nodes (12): currentMonthKey(), dashboardPayload(), monthKey(), parseDateRange(), parseMonthYear(), parseYearOnly(), parseYearRange(), resolveDataStatus() (+4 more)

### Community 19 - "Community 19"
Cohesion: 0.46
Nodes (7): downloadResource(), fetchJson(), main(), parseArgs(), safeFileName(), selectResources(), writeManualTemplate()

### Community 20 - "Community 20"
Cohesion: 0.38
Nodes (4): createTelegramBot(), parseAllowedChatIds(), scheduleTelegramSummaries(), startTelegramCommandCenter()

### Community 21 - "Community 21"
Cohesion: 0.33
Nodes (6): hasExplicitMapLocation(), mapBaseFilters(), mapFiltersFromQuery(), mapFiltersFromUrl(), queryFiltersFromSearchParams(), queryListParam()

### Community 22 - "Community 22"
Cohesion: 0.8
Nodes (4): fetchJson(), getFreshness(), getSampleRows(), main()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `buildMonthlySalesReport()` connect `Community 4` to `Community 1`, `Community 5`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `query()` connect `Community 2` to `Community 1`, `Community 12`, `Community 14`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `renderMonthlySalesReportHtml()` connect `Community 4` to `Community 1`, `Community 5`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Are the 25 inferred relationships involving `query()` (e.g. with `queryMakerRegistrationRows()` and `deleteMakerRegistrationContexts()`) actually correct?**
  _`query()` has 25 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `queryData()` (e.g. with `queryRegistrationRows()` and `readRegistrationsCsv()`) actually correct?**
  _`queryData()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `buildMonthlySalesReport()` (e.g. with `buildMonthlySalesReportForUrl()` and `main()`) actually correct?**
  _`buildMonthlySalesReport()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `hasDatabaseUrl()` (e.g. with `loadRows()` and `loadMakerRows()`) actually correct?**
  _`hasDatabaseUrl()` has 16 INFERRED edges - model-reasoned connections that need verification._