import assert from "node:assert/strict";
import {
  normalizeDashboardQueryText,
  normalizeDashboardStructuralText,
  rtoStateForCode,
} from "../lib/query-normalization.mjs";

const cases = [
  {
    label: "case punctuation spaces and possessive",
    input: "  BS-6, DIESEL; passenger-cars' registrations in DELHI\u2014Jan. 2025.  ",
    expected: "bs vi diesel passenger car registrations in delhi january 2025",
  },
  {
    label: "curly possessive and metric phrase",
    input: "Delhi\u2019s EV registration count",
    expected: "delhi ev registrations",
  },
  {
    label: "equivalent electric vehicle phrase",
    input: "Electric vehicles registered",
    expected: "ev registrations",
  },
  {
    label: "dotted abbreviation",
    input: "B.O.V.",
    expected: "bov",
  },
  {
    label: "vehicle abbreviations",
    input: "2-W 3W 4-W LMV H.M.V.",
    expected: "two wheeler three wheeler four wheeler light motor vehicle heavy motor vehicle",
  },
  {
    label: "canonical RTO forms",
    input: "MH\u201312 MH 12 MH12",
    expected: "mh-12 mh-12 mh-12",
  },
  {
    label: "norm abbreviations",
    input: "BS4 BS-6 Bharat Stage 6",
    expected: "bs iv bs vi bharat stage vi",
  },
  {
    label: "controlled plurals",
    input: "cars buses motorcycles scooters mopeds tractors taxis ambulances trucks rickshaws",
    expected: "car bus motorcycle scooter moped tractor taxi ambulance truck rickshaw",
  },
  {
    label: "month aliases",
    input: "Jan Sept December",
    expected: "january september december",
  },
  {
    label: "non EV remains explicit negation",
    input: "non-EV registrations",
    expected: "non ev registrations",
  },
];

for (const item of cases) {
  const actual = normalizeDashboardQueryText(item.input);
  assert.equal(actual, item.expected, `${item.label}: unexpected normalization`);
  assert.equal(normalizeDashboardQueryText(actual), actual, `${item.label}: normalization must be idempotent`);
}

assert.equal(
  normalizeDashboardStructuralText("Jan\u20132025 MH\u201312 2025-01"),
  "jan-2025 mh-12 2025-01",
  "Structural normalization must preserve date and RTO separators.",
);
assert.equal(rtoStateForCode("DL-01"), "Delhi");
assert.equal(rtoStateForCode("KA01"), "Karnataka");
assert.equal(rtoStateForCode("TN 01"), "Tamil Nadu");
assert.equal(rtoStateForCode("BS6"), null, "An emission norm must not be treated as an RTO prefix.");

console.log(JSON.stringify({
  passed: true,
  normalizationCaseCount: cases.length,
  rtoPrefixChecks: 4,
}, null, 2));
