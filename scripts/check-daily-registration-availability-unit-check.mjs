import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = await mkdtemp(path.join(os.tmpdir(), 'vahan-daily-registration-gate-'));
const summaryPath = path.join(directory, 'summary.json');
const gatePath = fileURLToPath(new URL('./check-daily-registration-availability.mjs', import.meta.url));

try {
  await writeFile(summaryPath, JSON.stringify({
    cycle: { succeeded: 100 },
    dailyRegistrations: {
      status: 'unavailable', baselineEligible: false, coverage: 0,
      reason: 'The source contains active stock, not exact-day registrations.',
    },
  }));

  const strict = spawnSync(process.execPath, [gatePath, summaryPath], { encoding: 'utf8' });
  assert.equal(strict.status, 1, 'strict mode must fail when registrations are unavailable');
  assert.match(strict.stderr, /Daily registrations unavailable/);

  const warning = spawnSync(process.execPath, [gatePath, summaryPath, '--warn-only'], { encoding: 'utf8' });
  assert.equal(warning.status, 0, 'warn-only mode must preserve collection success');
  assert.match(warning.stderr, /::warning title=Daily registration evidence unavailable::/);
  console.log('Daily registration availability gate: strict and warn-only modes verified.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
