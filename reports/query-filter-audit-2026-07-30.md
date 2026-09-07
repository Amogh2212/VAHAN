# Query Filter Audit

Generated: 2026-07-30T17:00:44.888Z

## Outcome

- Frozen oracle: 50 unique cases (30 coverage, 10 spelling/shorthand, 10 paired paraphrases).
- Groq calls: 50/50; quota pauses: 5; call-cap stop: no.
- Database consistency: verified.
- Live VAHAN source accuracy: not verified by this audit.

## Classification counts

| Lane | Classification | Count |
|---|---:|---:|
| groq | api_error | 1 |
| groq | data_inconsistency | 3 |
| groq | filter_mismatch | 14 |
| groq | pass | 32 |
| rules | filter_mismatch | 12 |
| rules | pass | 38 |

## Pass rates by filter family

| Lane | Family | Passed | Conclusive | Inconclusive | Pass rate |
|---|---|---:|---:|---:|---:|
| groq | category | 9 | 17 | 0 | 52.9% |
| groq | class | 9 | 16 | 0 | 56.3% |
| groq | date | 32 | 50 | 0 | 64.0% |
| groq | fuel | 14 | 25 | 0 | 56.0% |
| groq | geography | 32 | 50 | 0 | 64.0% |
| groq | norm | 5 | 13 | 0 | 38.5% |
| groq | paraphrase | 7 | 10 | 0 | 70.0% |
| groq | rto | 3 | 6 | 0 | 50.0% |
| groq | shorthand | 4 | 6 | 0 | 66.7% |
| groq | spelling | 2 | 5 | 0 | 40.0% |
| rules | category | 10 | 17 | 0 | 58.8% |
| rules | class | 13 | 16 | 0 | 81.3% |
| rules | date | 38 | 50 | 0 | 76.0% |
| rules | fuel | 17 | 25 | 0 | 68.0% |
| rules | geography | 38 | 50 | 0 | 76.0% |
| rules | norm | 6 | 13 | 0 | 46.2% |
| rules | paraphrase | 6 | 10 | 0 | 60.0% |
| rules | rto | 3 | 6 | 0 | 50.0% |
| rules | shorthand | 5 | 6 | 0 | 83.3% |
| rules | spelling | 3 | 5 | 0 | 60.0% |

## Safety and evidence

- API execution used POST /api/query with concurrency 1.
- Groq spacing was at least 30 seconds and cache TTL was 24 hours. Quota retries occur only after the reported reset timestamp.
- Live refresh was disabled and every response was checked for an unexpected refresh job.
- Telegram was disabled and API rate limiting used in-memory state.
- The audit database code issued SELECT statements only.
- VAHAN data-file hashes were unchanged: yes.

## Scope limits

Passing cases show consistency for this sample; they do not prove the parser or stored data is error-free. Zero rows are evaluated separately from semantic filter correctness. Counts were not compared with the official VAHAN website.

Targeted follow-up cases generated for failing families: 30. They were not sent to Groq, preserving the 50-call cap.

