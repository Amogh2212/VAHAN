import fs from 'node:fs/promises';

// Collection success is independent of the metric requested by the Daily page.
const [file, ...flags] = process.argv.slice(2);
if (!file) throw new Error('Pass the sanitized collection summary JSON path.');
if (flags.some((flag) => flag !== '--warn-only')) {
  throw new Error(`Unsupported option(s): ${flags.join(', ')}`);
}
const warnOnly = flags.includes('--warn-only');
const summary = JSON.parse(await fs.readFile(file, 'utf8'));
const daily = summary.dailyRegistrations;
if (daily?.status !== 'available' || daily.baselineEligible !== true || daily.coverage !== 100) {
  const message = `Daily registrations unavailable: ${daily?.reason ?? 'No verified daily registration evidence.'} Collection success does not establish Daily report readiness.`;
  const annotation = `::warning title=Daily registration evidence unavailable::${message}`;
  console[warnOnly ? 'warn' : 'error'](warnOnly ? annotation : message);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Daily RTO report unavailable\n\n${message}\n\nStock source collection: ${summary.cycle?.succeeded ?? summary.run?.succeededRtos ?? 'unknown'}/100. The saved stock observations are rejected as daily-registration baselines.\n`);
  if (!warnOnly) process.exitCode = 1;
} else {
  console.log('Verified Daily registrations are available for all 100 RTOs.');
}
