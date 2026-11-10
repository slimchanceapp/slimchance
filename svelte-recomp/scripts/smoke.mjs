// The live site works. After a deploy (scripts/ship.sh, which rolls back on a
// failure): every address serves that commit. On a schedule
// (.github/workflows/live-check.yml, no commit given): every address serves
// the same build, and it is a commit on main. Either way the pages people
// land on load, the first screen runs, and the edge functions answer.
// Usage: node scripts/smoke.mjs [commit]
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const sha = process.argv[2] ?? null;
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^PUBLIC_SUPABASE_URL=(.+)$/m)?.[1].trim();
const fn = `${supabaseUrl}/functions/v1`;
const HOSTS = ['https://svelte-recomp.vercel.app', 'https://slimchance.app', 'https://slimchance.vercel.app', 'https://moderly.vercel.app'];
const fails = [];
const get = async (url, init = {}) => {
  const r = await fetch(url, { redirect: 'manual', ...init, headers: { 'cache-control': 'no-cache', ...init.headers } });
  return { status: r.status, type: r.headers.get('content-type') ?? '', location: r.headers.get('location') ?? '', body: await r.text() };
};
const expect = (ok, what) => { if (!ok) fails.push(what); };

// Every address on this commit; the edge may need a moment to move over.
const seen = [];
for (const h of HOSTS) {
  let v = '';
  for (let i = 0; i < 12 && (sha ? v !== sha : !v); i++) {
    if (i) await new Promise((r) => setTimeout(r, 5000));
    try { v = JSON.parse((await get(`${h}/_app/version.json?t=${Date.now()}`)).body).version; } catch { v = ''; }
  }
  seen.push(v);
  if (sha) expect(v === sha, `${h} serves ${v || 'nothing'}, not ${sha}`);
}
if (!sha) {
  expect(seen.every((v) => v && v === seen[0]), `the addresses disagree: ${HOSTS.map((h, i) => `${h} ${seen[i] || 'nothing'}`).join(', ')}`);
  // Only ship.sh deploys, and it stamps the commit: anything else is a deploy
  // that went around the baseline.
  try { execFileSync('git', ['merge-base', '--is-ancestor', seen[0], 'origin/main'], { stdio: 'ignore' }); }
  catch { fails.push(`live build ${seen[0] || 'nothing'} is not a commit on main`); }
}

const site = HOSTS[0];
for (const [path, marker] of [['/', 'id="boot"'], ['/about/', '<title>Slim Chance'], ['/privacy.html', 'Slim Chance'],
  ['/guides/why-the-scale-went-up/', 'Slim Chance'], ['/guides/consistent-beats-accurate/', 'Slim Chance']]) {
  const r = await get(site + path);
  expect(r.status === 200 && r.body.includes(marker), `${path}: ${r.status}${r.body.includes(marker) ? '' : `, no ${marker}`}`);
}
const www = await get('https://www.slimchance.app/');
expect(www.status === 308 && www.location.startsWith('https://slimchance.app'), `www: ${www.status} to ${www.location || 'nowhere'}`);

// The first screen actually runs, at a phone's size: the HTML can be all there
// while the app itself crashes on start (it happened on a local build,
// 2026-10-30). Opening it starts no account.
// SMOKE_CHROME on GitHub (the runner's own Chrome); otherwise this laptop's.
const browsers = `${homedir()}/.cache/ms-playwright`;
const chrome = process.env.SMOKE_CHROME ?? `${browsers}/${readdirSync(browsers).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1)}/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath: chrome });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await page.goto(`${site}/`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2000);
  const text = (await page.locator('body').innerText()).trim();
  expect(!crashes.length, `the first screen threw: ${crashes.join(' / ')}`);
  expect(text.includes('Start now'), 'the first screen shows no "Start now"');
} finally {
  await browser.close();
}

const ics = await get(`${fn}/reminder-ics?t=07:30`);
expect(ics.status === 200 && ics.type.startsWith('text/calendar') && ics.body.startsWith('BEGIN:VCALENDAR'), `reminder-ics: ${ics.status} ${ics.type}`);
const coach = await get(`${fn}/coach`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
expect(coach.status === 401, `coach without a login: ${coach.status}, not 401`);

// The MCP endpoint answers an assistant the way the spec says (src/lib/mcp.ts).
const mcp = await get(`${HOSTS[1]}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
expect(mcp.status === 200 && mcp.body.includes('"slim_chance"'), `mcp tools/list: ${mcp.status}`);

if (fails.length) {
  console.error(`smoke: ${fails.length} failed\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log(`smoke: ${HOSTS.length} addresses on ${sha ?? seen[0]}; pages load, the first screen runs, functions and MCP answer.`);
