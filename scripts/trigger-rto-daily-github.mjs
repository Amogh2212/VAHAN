// Render cron: 0 6 * * * (11:30 AM Asia/Kolkata).
const token = process.env.GH_TRIGGER_TOKEN;
if (!token) throw new Error('Set GH_TRIGGER_TOKEN in Render environment settings.');
const api = 'https://api.github.com/repos/Amogh2212/VAHAN';
const workflow = 'rto-daily-neon-production.yml';
const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` };
const dateKey = (date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(date));
const today = dateKey(Date.now());
async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GitHub request failed: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function runs() {
  const result = await request(`/actions/workflows/${workflow}/runs?branch=main&per_page=100`);
  return result.workflow_runs;
}
const before = await runs();
const existing = before.find((run) => dateKey(run.created_at) === today);
if (existing) {
  console.log(JSON.stringify({ action: 'already_dispatched', date: today, url: existing.html_url, status: existing.status, conclusion: existing.conclusion }));
  if (existing.status === 'completed' && existing.conclusion !== 'success') {
    throw new Error('Today\'s collection failed; inspect evidence and explicitly retry the collection.');
  }
} else {
  const previousIds = new Set(before.map((run) => run.id));
  await request(`/actions/workflows/${workflow}/dispatches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { initialize_cohort: false, retry_failed: true, refresh_all: true } }),
  });
  console.log(`GitHub accepted full-cohort dispatch for ${today}.`);
  let started = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    const run = (await runs()).find((candidate) => !previousIds.has(candidate.id) && candidate.event === 'workflow_dispatch' && dateKey(candidate.created_at) === today);
    if (!run) continue;
    console.log(JSON.stringify({ url: run.html_url, status: run.status, conclusion: run.conclusion }));
    if (run.status === 'completed' && run.conclusion !== 'success') throw new Error('Collection ended unsuccessfully; inspect the GitHub run.');
    if (run.status === 'in_progress' || run.status === 'completed') { started = true; break; }
  }
  if (!started) throw new Error('Dispatch accepted, but no started run confirmed within five minutes. Inspect GitHub before retrying.');
}
