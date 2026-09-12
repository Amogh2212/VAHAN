import assert from "node:assert/strict";
import { renderHtmlTextPdf } from "../lib/text-pdf.mjs";

const pdf = renderHtmlTextPdf(`<!doctype html><title>Noida Daily Report</title><style>.hidden{color:red}</style>
  <h1>Noida - UP16</h1><p>Daily registrations unavailable.</p>
  <table><tr><td>Previous-day registrations</td><td>2026-09-10</td><td>Unavailable</td></tr></table>`);
const source = pdf.toString("latin1");
assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
assert.match(source, /Noida Daily Report/);
assert.match(source, /Daily registrations unavailable/);
assert.match(source, /Previous-day registrations/);
assert.doesNotMatch(source, /color:red/);
assert.match(source, /xref[\s\S]*trailer[\s\S]*%%EOF/);
console.log("Text PDF fallback checks passed.");
