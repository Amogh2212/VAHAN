# Vahan EY read-only audit harness

This directory defines the repository-local deep-audit policy. The harness inventories the exact checkout, runs a closed allow-list of non-mutating checks, normalizes sanitized evidence, and writes a report. It does not refactor or fix application code.

## Commands

Run through `npm.cmd` on Windows so the harness can invoke the current npm CLI without a shell:

```powershell
npm.cmd run audit:inventory
npm.cmd run audit:static
npm.cmd run audit:browser
npm.cmd run audit:full
npm.cmd run audit:runtime:readonly
npm.cmd run audit:report -- --input audit-output/<run-id> --publish
npm.cmd run audit:ci
```

Every command supports `--out <directory>` and `--baseline <git-ref>`. `audit:full` omits database access unless `--include-runtime` is present. Only that explicit option, or `audit:runtime:readonly`, may read and parse `.env` when `DATABASE_URL` is otherwise absent; it does not merge the file into the parent process environment. Hosted CodeQL SARIF can be normalized with `--codeql <sarif-file>`; imports must be SARIF 2.1.0 with at least one CodeQL run and a results array for every run. Source snippets and raw SARIF are never copied to audit artifacts.

The npm scripts for static, browser, runtime, full, and CI modes include the CLI's explicit `--run` acknowledgement. Direct CLI use must also provide `--run`. This records the remaining trust boundary clearly: these modes execute the checkout's allowlisted test or server code. Environment isolation, exact command arguments, read-only transactions, loopback binding, request blocking, and before/after hashes reduce accidental side effects, but they are not an OS security sandbox for hostile source code.

`audit:report` writes a new ignored artifact run. Regenerating an existing result requires `--input audit-output/<run-id>`. Tracked documentation changes only when `--publish` is explicit. Publication uses a validated current date and run ID, rejects linked `docs/audits` paths, and uses create-only semantics so an existing report is never overwritten.

## Safety boundary

The allow-list contains syntax, unit, contract, security, secret, local-regression, and local production-simulation checks. Child processes receive an environment with database, OAuth, AI-provider, Telegram, token, key, cookie, authorization, and runtime-injection values removed. Live VAHAN refresh is forced off. Commands are launched with argument arrays and `shell: false`.

The command catalog contains no direct entries for:

- the VAHAN scraper or RTO queue worker;
- a database schema, migration, import, restore, backup, or fixture integration script;
- task registration or a hosted GitHub workflow;
- report generation or rebuilding that persists rows;
- a production write endpoint;
- `npm audit fix`, Semgrep autofix, or an AI code editor.

The separate `Reviewed Audit Gate` workflow runs `audit:ci` on Node 22 with the pinned Semgrep version and an event-specific Git baseline. It enforces deterministic failures and only the manually promoted findings in `reviewed-findings.json`. It does not replace the independent CodeQL, advisory Semgrep, or production-risk workflows.

Existing RTO database integration checks are intentionally absent because they insert, update, or delete fixture rows and one takes the shared scrape advisory lock. Existing browser checks are also absent from the default path because they load `.env`; the audit has a separate loopback fixture browser instead.

## Artifacts and redaction

Each invocation creates a unique directory under ignored `audit-output/`, unless an absolute external artifact base is supplied. A repository-relative `--out` is rejected unless its top-level directory is `audit-output/`:

```text
manifest.json
command-results.json
findings.json
coverage.json
backlog.json
report.md
run-summary.json
logs/*.stdout.log
logs/*.stderr.log
screenshots/*.png
```

The manifest is written once with create-only (`wx`) semantics. It records HEAD, baseline, NUL-safe Git status, tracked and untracked classifications, SHA-256 worktree hashes, tool versions, workflow and test inventory, and Graphify commit, hash, and candidate freshness. Real environment files and generated or runtime directories are classified by path but never opened or hashed.

“Raw log” means unparsed command output, not unredacted output. Literal credential values, credential URLs, authorization or cookie headers, JWTs, known key formats, URL query strings, home paths, and repository absolute paths are redacted before any text or JSON is written. Uploaded Semgrep evidence additionally removes matched lines, metavariable contents, scanner-authored messages, and fixes. Findings retain structured evidence and both stdout and stderr artifact paths when both exist.

## Enforced read-only runtime mode

`audit:runtime:readonly` is the only database-aware audit command. It uses a dedicated `pg.Client` rather than the application's general read/write pool. The order is fixed:

1. connect;
2. `BEGIN READ ONLY`;
3. set local statement, lock, and idle-transaction timeouts;
4. verify `transaction_read_only=on`;
5. run fixed, parameterized catalog and sanity `SELECT`s;
6. `ROLLBACK` in `finally`.

If the read-only guarantee cannot be verified, no inventory `SELECT` runs. Missing credentials, connectivity, or dependencies are recorded as `skipped`, never `passed` and never automatically labeled a defect. Target, database, and user names are stored only as short SHA-256 fingerprints.

## Controlled browser mode

`audit:browser` launches `server.mjs` on a random loopback port without an env file. Database, OAuth, AI, factors, Telegram, and live VAHAN access are disabled. Playwright aborts every non-loopback network request. The check covers health and readiness, security headers, unauthenticated boundaries, deterministic query rendering, fail-closed invalid input, dashboard and API total agreement, RTO report shell rendering, console errors, and desktop and mobile overflow.

Authenticated CSRF and database-backed report or CSV checks remain explicit nested skips until a disposable fixture exists. A result with any nested skip is `partial`, and the nested check and reason appear in coverage and the report. It must not be described as passed merely because its parent process exited successfully.

## Coverage and audit status

`coverage-matrix.json` is the checked-in representation of the eleven `COVERAGE_DOMAINS` entries in `lib/audit/policy.mjs`; domain names, source areas, checks, and notes must stay deeply equal. Coverage status is derived from both parent checks and nested checks.

`run-summary.json` and the report use a coverage-level `auditStatus` independent of the process exit code:

- `complete`: every coverage domain passed;
- `partial`: no domain failed, but at least one check is skipped, not run, unavailable, or partial;
- `incomplete`: a coverage domain failed or coverage is missing.

Process exit codes remain reserved for configured deterministic gate failures and reviewed blocking findings.

## Findings, baselines, and review gates

`findings.schema.json` and `validateFinding()` enforce the same closed contract: all required fields must exist, unknown properties are rejected, enums and IDs are exact, evidence is structured and nonempty, and baseline and attribution values are validated.

Static finding IDs are line-independent. Semgrep and CodeQL IDs are based on normalized category, repository path, and sanitized rule ID, never a scanner-authored message or matched source text. Duplicate occurrences merge structured evidence. Exact cross-tool matches can reconcile when the normalized category, file, and rule identity agree; disagreement never silently promotes a finding to confirmed.

The npm adapter must receive the parsed or raw `package-lock.json` as its third argument so evidence records installed versions rather than only advisory ranges.

`baseline-findings.json` has this closed shape:

```text
schemaVersion, baselineCommit, reviewedAt, reviewedBy, policy, findingIds
```

An empty baseline may use `null` review metadata. A nonempty `findingIds` array requires the reviewed baseline commit, ISO review timestamp, and reviewer. Baseline membership suppresses a previously accepted finding; it does not confirm, promote, or prove that the finding was introduced in the current checkout.

`reviewed-findings.json` is a separate manual promotion registry. Each promotion must contain:

```text
findingId, severity, status, confidence, introducedInCurrentCheckout,
baselineCommit, reviewedAt, reviewedBy, reviewEvidence, introductionEvidence
```

Only `P0` or `P1`, `confirmed`, `high` confidence, and explicit `introducedInCurrentCheckout: true` entries are valid. `audit:ci` blocks only when the normalized finding still matches that reviewed promotion and exact baseline commit, has not been baseline-suppressed, and is proven introduced. Scanner output, registry auto rules, and Ponytail cannot independently block CI. Do not add an ID to either registry merely to make CI green.

Ponytail is optional and manual. Use `ponytail-review-prompt.md` only after deterministic evidence exists, and reconcile every suggestion against source, Graphify, tests, Semgrep, and CodeQL before changing finding status.

The backlog is ordered by operational priority before severity: data integrity and security; production reliability; correctness and regression coverage; architecture and maintainability; then documentation and cleanup. Every item retains its invariant, acceptance criteria, and required regression test.
