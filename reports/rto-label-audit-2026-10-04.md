# RTO label audit — 4 October 2026

The combined fix removes duplicate selectable offices for Noida, Pune, Ludhiana, Haridwar and Dehradun. Saved registrations remain in place and canonical office queries read the audited historical aliases.

| State | Office retained | Historical label treated as an alias |
| --- | --- | --- |
| Uttar Pradesh | Noida - UP16 | Noida - UP16( 13-NOV-2017 ) |
| Maharashtra | PUNE - MH12 | PUNE - MH12( 25-JAN-2017 ) |
| Punjab | RTO LUDHIANA - PB10 | RTO LUDHIANA - PB10( 25-JAN-2018 ) |
| Uttarakhand | HARIDWAR ARTO - UK8 | haridwar |
| Uttarakhand | DEHRADUN RTO - UK7 | dehradun |

## Scope and evidence

The audit covered the saved catalog (1,676 offices across 36 states), raw registration CSV labels and a read-only snapshot of the configured Neon database (54 distinct state/RTO pairs, including aggregate offices). The combined sources contained 1,686 distinct non-aggregate labels.

All 1,676 catalog office-code queries resolved to their expected office after the fix. Before the code fix, MH-04 could incorrectly resolve to `RTO MH04-Mira Bhayander FitnessTrack - MH203`, because the referenced MH04 code inside its name was treated as its own office code. Final office codes now take precedence, and MH-04 resolves to Thane while MH-203 remains selectable separately.

The catalog loader and metadata endpoint now share the canonical office list. Catalog discovery also canonicalizes offices before writing the catalog and generating collection configurations. Bare historical labels with no identified office code (delhi, gurugram, bengaluru and DTO) remain in storage but are excluded as additional selectable offices. They are not assigned to a guessed office.

Distinct offices serving a city remain separate. The audit recorded 113 ambiguous name probes; these are not evidence of 113 duplicate offices. No bulk merge or deletion was applied to those candidates. Erode TN33/TN86 was explicitly tested to retain its ambiguity prompt.

## Verification

- RTO resolver/unit and source checks passed.
- Local production-mode HTTP checks passed for all five canonical offices and their historical links, MH-04/MH-203, filter metadata, and genuine multiple-office selection.
- The exact screenshot query, `registrations in noida in 2026`, resolved to Uttar Pradesh / Noida - UP16 without the multiple-RTO warning.
- Production smoke checks passed on the isolated release based on origin/main.
- Query fuzzy and normalization checks passed in the working checkout.

Machine-readable evidence: `outputs/rto-label-audit-2026-10-04.json`, `outputs/rto-label-database-snapshot-2026-10-04.json`, and `outputs/rto-label-http-check-2026-10-04.json`.

These results establish local behavior. Deployment and live verification are separate release steps. Registration totals, freshness, and completeness are outside this label audit.
