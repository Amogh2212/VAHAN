// The installed collector is an active-stock adapter. No collected stock row,
// stock delta, monthly aggregate, or cached payload is a daily registration fact.
export const DAILY_REGISTRATION_REASON = "The configured VAHAN Public Dashboard source provides active vehicle stock, not registrations for an exact day. Stock differences cannot establish daily registrations. A verified daily registration source is required.";
export const DAILY_REGISTRATION_TIMEZONE = "Asia/Kolkata";

export function unavailableDailyRegistrationReport(report) {
  const payload = report.payload ?? {};
  if ((report.cadence ?? payload.cadence) !== "daily") return report;
  const date = report.periodEnd ?? payload.period?.end ?? null;
  const previousDate = date ? new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : null;
  const source = payload.source ?? report.source ?? {};
  const reason = source.validationContract === "public-stock-v2" || report.validationContract === "public-stock-v2"
    ? DAILY_REGISTRATION_REASON
    : "No verified daily registration evidence exists for this RTO and date. Historical or unverified observations are excluded; collection must use a verified daily registration source.";
  const empty = () => ({ ev: null, ice: null, total: null, evShare: null });
  const field = (fieldDate, why = reason) => ({ value: null, date: fieldDate, timezone: DAILY_REGISTRATION_TIMEZONE, status: "unavailable", reason: why });
  const dailyRegistration = {
    status: "unavailable", reason, date, timezone: DAILY_REGISTRATION_TIMEZONE,
    baselineEligible: false,
    previousDayRegistrations: field(previousDate), evRegistrations: field(date), iceRegistrations: field(date),
    evShare: field(date), rank: field(date, "Daily rank requires verified daily EV registrations for all 100 cohort RTOs. " + reason),
    rankDefinition: "Rank by daily EV registrations across the complete frozen 100-RTO cohort",
  };
  const summary = `Daily registrations unavailable for ${date ?? "the selected date"}. ${reason}`;
  return { ...report, status: "needs_review", summary, currentCoverage: false,
    explanations: [],
    cohortRank: null, previousRank: null, periodEv: null, periodIce: null, mtdEv: null, mtdIce: null, evShare: null,
    dailyRegistration,
    payload: { ...payload, cadence: "daily", kind: "rto-daily-registration-report", status: "needs_review", summary,
      period: { ...payload.period, start: date, end: date, label: date ?? "Selected date", comparisonStart: previousDate, comparisonEnd: previousDate },
      rto: { ...payload.rto, cohortRank: null, previousRank: null },
      dailyRegistration,
      metrics: { period: empty(), previousPeriod: empty(), stock: empty(), change: { ev: {absolute:null,percent:null}, ice: {absolute:null,percent:null}, total: {absolute:null,percent:null} } },
      categories: ["2W", "3W", "4W"].map(vehicleCategory => ({ vehicleCategory, period: empty(), previousPeriod: empty(), stock: empty() })),
      oems: [], trend: [], explanations: [],
      quality: { ...payload.quality, currentCoverage: false, registrationCoverage: 0,
        sourceCollectionCoverage: payload.quality?.sourceCollectionCoverage ?? payload.quality?.currentCoverage ?? null,
        warnings: [reason], sourceFlags: ["daily_registration_source_unavailable"] },
      source: { ...source, registrationFlowAvailable: false, dailyBaselineEligible: false,
        limitation: reason, sourceAsOf: null, freshnessStatus: "unverified",
        freshnessReason: "Collection time records when the response was fetched; the source does not confirm its data refresh time.",
      },
    },
  };
}
