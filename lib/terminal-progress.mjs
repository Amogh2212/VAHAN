const IST_TIME_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function numericTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.round(safeMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatIstTime(timestamp) {
  return IST_TIME_FORMATTER.format(new Date(timestamp)).replace(/^24:/, "00:");
}

function formatProgressTiming({ total, fetched, startedAt, baselineSucceeded, now, compact = false }) {
  const startedAtMs = numericTimestamp(startedAt);
  const nowMs = numericTimestamp(now) ?? Date.now();
  if (!startedAtMs || nowMs < startedAtMs) return "";

  const elapsedMs = nowMs - startedAtMs;
  const baseline = Math.max(0, Number(baselineSucceeded) || 0);
  const sessionFetched = Math.max(0, fetched - baseline);
  const remaining = Math.max(0, total - fetched);
  const elapsed = formatDuration(elapsedMs);

  if (remaining === 0 && total > 0) {
    const rate = elapsedMs > 0 && sessionFetched > 0
      ? `${((sessionFetched / elapsedMs) * 3_600_000).toFixed(1)}/hr`
      : "--/hr";
    return compact
      ? ` | ${elapsed} | ${rate} | ETA done`
      : ` | elapsed ${elapsed} | rate ${rate} | ETA done`;
  }

  if (!sessionFetched || elapsedMs <= 0) {
    return compact
      ? ` | ${elapsed} | --/hr | ETA calculating...`
      : ` | elapsed ${elapsed} | rate --/hr | ETA calculating...`;
  }

  const ratePerHour = (sessionFetched / elapsedMs) * 3_600_000;
  const etaMs = (remaining / ratePerHour) * 3_600_000;
  const finishAt = nowMs + etaMs;
  return compact
    ? ` | ${elapsed} | ${ratePerHour.toFixed(1)}/hr | ETA ${formatDuration(etaMs)}`
    : ` | elapsed ${elapsed} | rate ${ratePerHour.toFixed(1)}/hr | ETA ${formatDuration(etaMs)} | finish ~${formatIstTime(finishAt)} IST`;
}

export function formatRtoDailyProgress(summary = {}, { width = 30, startedAt = null, baselineSucceeded = null, now = null, compact = false } = {}) {
  const total = Math.max(0, Number(summary.total) || 0);
  const fetched = Math.max(0, Number(summary.succeeded) || 0);
  const failed = Math.max(0, Number(summary.failed) || 0);
  const running = Math.max(0, Number(summary.running) || 0);
  const activeRunning = summary.activeRunning === undefined
    ? running
    : Math.max(0, Number(summary.activeRunning) || 0);
  const staleRunning = summary.staleRunning === undefined
    ? Math.max(0, running - activeRunning)
    : Math.max(0, Number(summary.staleRunning) || 0);
  const queued = Math.max(0, Number(summary.queued) || 0);
  const safeWidth = Math.max(10, Math.min(40, Math.floor(Number(width) || 30)));
  const ratio = total ? Math.min(1, fetched / total) : 0;
  const filled = Math.round(ratio * safeWidth);
  const bar = `${"#".repeat(filled)}${"-".repeat(safeWidth - filled)}`;
  const percent = total ? ((fetched / total) * 100).toFixed(1) : "0.0";
  const timing = formatProgressTiming({ total, fetched, startedAt, baselineSucceeded, now, compact });
  const runningText = staleRunning
    ? (compact ? `run ${activeRunning}+${staleRunning} stale` : `running ${activeRunning} active + ${staleRunning} stale`)
    : (compact ? `run ${activeRunning}` : `running ${activeRunning}`);
  const queueText = compact ? `q ${queued}` : `queued ${queued}`;
  const failedText = compact ? `fail ${failed}` : `failed ${failed}`;
  const fetchedText = compact
    ? `${fetched}/${total} (${percent}%)`
    : `${fetched}/${total} RTOs fetched (${percent}%)`;
  return `[${bar}] ${fetchedText} | ${runningText} | ${queueText} | ${failedText}${timing}`;
}

export function createTerminalProgress({ stream = process.stdout } = {}) {
  const startedAt = Date.now();
  let baselineSucceeded = null;
  let lastSummary = null;

  function clear() {
    return;
  }

  function render(summary = lastSummary) {
    if (!summary) return;
    lastSummary = summary;
    if (baselineSucceeded === null) {
      baselineSucceeded = Math.max(0, Number(summary.succeeded) || 0);
    }
    const availableWidth = Number(stream.columns) || 100;
    const compact = availableWidth < 150;
    const barWidth = Math.max(10, Math.min(30, availableWidth - (compact ? 100 : 130)));
    const line = formatRtoDailyProgress(summary, {
      width: barWidth,
      startedAt,
      baselineSucceeded,
      compact,
    });
    stream.write(`[rto-daily:progress] ${line}\n`);
  }

  function log(message, { error = false } = {}) {
    (error ? console.error : console.log)(message);
  }

  function finish(summary = lastSummary) {
    render(summary);
  }

  return { clear, finish, log, render };
}
