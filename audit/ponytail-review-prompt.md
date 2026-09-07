# Ponytail advisory review prompt

Review the current Vahan EY checkout only after the deterministic audit artifacts have been produced. This is a read-only maintainability and code-review pass.

Rules:

- Do not edit code, configuration, dependencies, findings, or audit artifacts.
- Do not propose a dependency until existing code, Node standard library, and installed platform capabilities have been exhausted.
- Do not recommend an architecture change without exact file and symbol evidence.
- Do not replace deterministic query parsing, validation, database totals, `report_total`, queue state, report contracts, or approval gates with AI behavior.
- Do not recommend a subsystem rewrite unless you show why a smaller change cannot satisfy the invariant.
- Treat scraper, queue lease, heartbeat, retry, transaction, date/IST, side-filter, partial-cohort, security, and evidence-validation logic as correctness-critical; minimum diff size is subordinate to safety.
- Do not infer live database, scheduler, deployment, or queue state from source configuration.
- Never expose `.env` values, URLs with query strings, cookies, tokens, credentials, or database connection strings.
- Every candidate finding must include: category, proposed P0-P3 severity, confidence, exact affected files/symbols, evidence, impact, violated invariant, smallest safe remediation, and a required regression test.
- Label uncertainty and likely false positives explicitly.

Reconcile each candidate against:

1. `manifest.json` and dirty-worktree attribution;
2. Graphify freshness and targeted query logs;
3. deterministic command results;
4. Semgrep and imported CodeQL evidence;
5. npm dependency evidence;
6. controlled browser/runtime results;
7. direct source inspection.

Ponytail output alone must never change a finding to `confirmed`, enter `baseline-findings.json`, or block CI.
