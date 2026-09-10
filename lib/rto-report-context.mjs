// Report totals are primary VAHAN-derived facts. Reviewed factor explanations
// are optional context and must never make a valid report unavailable.
export async function loadRtoReportWithOptionalFactorContext({
  reportId,
  factorAgentEnabled,
  loadReport,
  loadApprovedExplanations,
  onContextError = () => {},
}) {
  const report = await loadReport(reportId);
  if (!report) return null;

  if (!factorAgentEnabled) {
    return { ...report, factorContext: { status: "disabled" } };
  }

  if (report.payload?.source?.validationContract !== "public-stock-v2") {
    return { ...report, explanations: [], factorContext: { status: "unavailable",
      message: "Historical source evidence is unverified; explanations based on it are withheld." } };
  }

  try {
    const explanations = await loadApprovedExplanations({
      reportId: report.id,
      reportRevision: report.revision,
    });
    return { ...report, explanations, factorContext: { status: "available" } };
  } catch (error) {
    onContextError(error);
    return {
      ...report,
      explanations: [],
      factorContext: {
        status: "unavailable",
        message: "Reviewed context is temporarily unavailable. Active-stock facts remain available.",
      },
    };
  }
}
