# Monthly registration totals: aggregate and fuel detail reconciliation

The Noida UP16 answer combined fresh ALL-fuel monthly totals with older fuel-detail rows. The saved rows summed to 228,127, while the ten monthly aggregate rows total 138,965. January was incorrectly 35,217 rather than 17,615.

The answer now selects one authoritative total per exact month, state, canonical RTO, and filter context. Where an ALL row exists, fuel-detail rows cannot be added to that total. Repeated rows for a fuel use the latest observation. This selection runs at the answer boundary, including database and completed-refresh responses, and on the registrations endpoint.

Fuel composition is withheld when selected months contain aggregate-only evidence. A separately supplied composition must reconcile exactly to the selected total. A completed refresh clears older composition rather than keeping a stale chart. Old saved browser answers are invalidated, and the dashboard script URL is versioned.

Verification on 2026-10-04: read-only saved Noida data produced 138,965 total, January 17,615, and ten monthly rows. Monthly counts were 17,615; 13,474; 14,302; 14,614; 14,696; 14,179; 16,241; 15,592; 17,289; 963. No database rows were changed.

Mandatory query-refresh checks cover CSV, database, completed refresh, duplicate/reordered rows, canonical aliases, explicit fuel scopes, mixed evidence, and fuel-total reconciliation. A browser regression exercises fresh answers, refresh replacement, monthly selection, CSV export, and invalidation of old saved answers. Existing query-race, syntax, and production smoke checks also pass.
