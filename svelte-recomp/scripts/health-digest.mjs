// The daily digest (.github/workflows/health-digest.yml): the health
// function's totals as a short summary, and a failed run, which GitHub
// emails to the owner, when something needs a look: a kind of error nobody
// had before, Gemini's prepaid credit used up, a jump in new trials, the
// shared AI allowance nearly used, or the check itself failing.
// Usage: node scripts/health-digest.mjs health.json
import { readFileSync } from 'node:fs';

const TRIAL_JUMP = 40;   // new trials in a day: about ten times the usual
const AI_NEAR_CAP = 120; // of the 150 AI calls everyone shares a day (ai_take)

/** Pure, for selfcheck: the summary lines and whether to raise the alarm. */
export function digest(h) {
  if (!h || h.failed) return { lines: [`The health check itself failed: ${h?.failed ?? 'no answer'}`], alarm: true };
  const e = h.events ?? {};
  const fresh = (h.errors ?? []).filter((x) => x.new);
  // Gemini out of credit is an alarm only when nothing else can read a photo:
  // since 2026-11-10 Gemma (on Cloudflare) stands behind it.
  const broke = h.ai_credit === 'out of credit' && !(h.engines ?? []).includes('gemma');
  // A jump in new trials is a post going well or a script (2026-11-11: trials
  // share their own 60-a-day AI pool, so email accounts keep theirs either
  // way); and the shared AI allowance nearly used means tomorrow's photos may
  // fail. Normal is a handful of trials and well under 100 calls a day.
  const trials = h.signups?.trials ?? 0;
  const trialJump = trials > TRIAL_JUMP;
  const aiCalls = h.ai?.ai ?? 0;
  const aiNearCap = aiCalls >= AI_NEAR_CAP;
  const lines = [
    `Last 24 hours, since ${h.since}:`,
    `- Opened the app: ${e.open ?? 0} people; started setup: ${e.setup_1 ?? 0}; finished: ${e.setup_done ?? 0}`,
    `- Reminders: ${e.reminder_push ?? 0} by push, ${e.reminder_calendar ?? 0} by calendar, ${e.reminder_failed ?? 0} couldn't be set`,
    `- New accounts: ${h.signups ? `${h.signups.trials} trials, ${h.signups.accounts} with an email` : 'not counted'}`,
    ...(trialJump ? [`  - A JUMP IN NEW TRIALS (${trials}): a post going well, or scripted sign-ups. Trials share their own AI pool, so email accounts keep theirs.`] : []),
    `- AI calls: ${Object.entries(h.ai ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    ...(aiNearCap ? [`  - THE SHARED AI ALLOWANCE IS NEARLY USED: ${aiCalls} of 150 calls. Look at who is calling before it runs out.`] : []),
    `- Gemini credit: ${h.ai_credit ?? 'not checked'}; engines: ${(h.engines ?? []).join(', ') || 'none'}`,
    ...(broke ? ['  - USED UP: photos, label reading and the coach are down until it is topped up in AI Studio.'] : []),
    `- Errors: ${(h.errors ?? []).length} kinds seen, ${fresh.length} new`,
    ...fresh.map((x) => `  - NEW (${x.people} ${x.people === 1 ? 'person' : 'people'}, ${x.route || 'no route'}): ${x.message}`),
  ];
  // A reminder that couldn't be set is the normal path where a browser can't
  // take push (Today then offers the calendar): reported, never an alarm.
  return { lines, alarm: fresh.length > 0 || broke || trialJump || aiNearCap };
}

if (process.argv[2]) {
  let h;
  try { h = JSON.parse(readFileSync(process.argv[2], 'utf8')); } catch { h = null; }
  const { lines, alarm } = digest(h);
  console.log(lines.join('\n'));
  if (alarm) { console.error('\nSomething needs a look (above).'); process.exit(1); }
}
