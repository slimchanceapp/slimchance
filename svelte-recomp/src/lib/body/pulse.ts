// The Today hero: the weight trend, and how far it is to the next stop.
//
// It used to be a 0–100 "recomp score" (fat loss, strength, protein and
// recovery, weighted) that its one daily user never read. While that score
// couldn't be worked out, the hero fell back to a new account's checklist, so
// someone months in saw a grey "4 / 4 first-week steps" and asked what it
// meant. The trend is the number the scale, the food and the training all
// answer to, and the next stop is the one near enough to watch move.
//
// Pure, unit-tested in selfcheck.js. stores/body.ts derives it once
// (`pulse`), for the hero and the page's glow alike, so they can't disagree.
import { chanceOf, goalDirection, type Pace, type WeightVerdict } from './insights.ts';
import type { MilestoneState } from './milestone.ts';
import { changeWord, dwt, dwtNum, unitWord, weightUnit, wt, wtShort } from '../units.ts';

/** Never 'bad': a bad week is amber. "Blown" is the thought that makes it so. */
export type PulseTone = 'good' | 'ok' | 'warn' | 'na';

export interface PulseInput {
  weight: WeightVerdict | null;
  pace: Pace;
  firstKg: number | null;
  goalKg: number | null;
  next: MilestoneState | null;
  /** The loss a week the plan is built for (stores/body target), when it is
   *  one: names what a too-noisy trend can't show yet. */
  planKgPerWeek?: number | null;
  /** Keeping it off (user_settings.keep_since): the range and how the trend
   *  has kept to it. null while losing toward the goal. */
  keep?: KeepInput | null;
}

export interface KeepInput {
  goalKg: number;
  /** The ceiling now (line.ts), else a kilo over the goal. */
  ceilingKg: number;
  /** Days since keeping began (sixty at most) with a trend, and how many of
   *  them it sat at or under the ceiling. A rate, never a streak: a day over
   *  costs one day. */
  inside: number;
  days: number;
  since: string;
}

export interface Pulse {
  /** The trend, else the latest weigh-in; null before the first. */
  kg: number | null;
  caption: string;
  /** How far from where the stop was set to the stop (else from the first
   *  weigh-in to the goal), 0–100; null when there's nothing to measure. */
  pct: number | null;
  tone: PulseTone;
  story: string;
  stats: Array<{ v: string; l: string }>;
  /** The odds on Today, as ten coins: how likely it is that the trend is
   *  really going the goal's way. null before there is a line. */
  odds: Odds | null;
}

export interface Odds {
  /** Coins lit, of ten. */
  lit: number;
  text: string;
}

/** A chance as coins of ten and one sentence. The middle is "too close to
 *  call", not a verdict: a first week can't know yet, and says so. No joke on
 *  the name: "Not so slim" beside a chance of slimming read backwards
 *  (2026-11-10). */
export function oddsOf(p: number | null, what: string): Odds | null {
  if (p == null) return null;
  const lit = p >= 0.95 ? 10 : p < 0.05 ? 0 : Math.min(9, Math.max(1, Math.round(p * 10)));
  const text = (lit === 10 ? `Almost certainly ${what}.`
    : lit === 0 ? `Under 1 in 10 it’s ${what} right now.`
    : lit >= 7 ? `${lit} in 10 it’s ${what}.`
    : lit >= 4 ? `${lit} in 10 it’s ${what}: too close to call.`
    : `${lit} in 10 it’s ${what} right now.`);
  return { lit, text };
}

/** Losing toward a goal under the trend, not keeping it off: then the chance
 *  is said as a chance of slimming. */
export const slimming = (goalKg: number | null, kg: number | null, keepSince: string | null): boolean =>
  goalKg != null && kg != null && goalKg < kg && !keepSince;

/** The coins lit, of ten: the chance once there are odds, and in the first
 *  week the mornings on the scale. Today's hero and the home-screen widget. */
export const coinsLit = (odds: Odds | null, mornings: number): number => odds?.lit ?? Math.min(10, mornings);

/** The one sentence on the chance: Today's hero and the home-screen widget.
 *  Said of the chance, never of the body: "Slim, for now" read as "you're
 *  slim" next to a weight (the owner, 2026-11-03). */
export function chanceSentence(odds: Odds | null, losing: boolean): string {
  return !odds ? 'Each morning on the scale lights a coin.'
    : !losing ? odds.text
    : odds.lit >= 8 ? 'Your chance of slimming looks great. Right on track!'
    : odds.lit >= 4 ? 'Your chance of slimming is a coin toss. Every morning sharpens it.'
    : 'Your chance of slimming is low right now.';
}

export function pulse(i: PulseInput): Pulse {
  const w = i.weight;
  const trend = w?.trendKg ?? null;
  if (i.keep && trend != null) return keeping(i.keep, w!, trend);
  const kg = trend ?? w?.latestKg ?? null;
  const stop = i.next && !i.next.reached ? i.next : null;
  const target = stop ? stop.kg : i.goalKg;
  const from = stop ? (stop.fromKg ?? i.firstKg) : i.firstKg;
  const dir = goalDirection(kg, target ?? 0);
  // A rate is worth saying once the line through the mornings is sure of it,
  // or (on a cut) sure enough to judge against the plan: a flat month is too
  // noisy for its exact rate yet certainly not the plan's pace, and "30 more
  // mornings" was no answer to someone sixty mornings in.
  const sure = w != null && trend != null && (w.state === 'answerable' || (dir === 'lose' && w.state === 'too-noisy' && i.pace !== 'too-early'));
  const rate = sure ? w!.rateKgPerWeek : null;

  const toGo = kg != null && target != null ? kg - target : null;
  // In stone the number itself says "st", and the distance reads in pounds.
  const st = weightUnit() === 'st';
  const u = st ? '' : `${unitWord()} `;
  const goal = target != null ? wtShort(target) : '';
  const caption = trend == null ? (kg != null ? (st ? 'not a trend yet' : `${unitWord()} · not a trend yet`) : '')
    : toGo == null ? `${u}trend`
    : Math.abs(toGo) < 0.05 ? `${u}trend · at ${goal}`
    : `${u}trend · ${st ? dwt(toGo) : dwtNum(toGo)} to ${goal}`;
  const pct = trend != null && target != null && from != null && Math.abs(from - target) >= 0.1
    ? Math.max(0, Math.min(100, ((from - trend) / (from - target)) * 100))
    : null;

  let tone: PulseTone = 'na';
  let story: string;
  if (rate == null) {
    const n = w?.weighInsNeeded;
    const plan = i.planKgPerWeek != null && i.planKgPerWeek > 0 ? i.planKgPerWeek : null;
    story = kg == null ? 'Weigh in tomorrow morning, before food or drink: the trend starts there.'
      // Before the first line there are no odds yet: say when they come, the
      // reason to step on the scale again tomorrow.
      : n && w?.state === 'not-enough' ? `${n} more morning${n === 1 ? '' : 's'} on the scale and you get your first odds.`
      : n && n <= 7 ? `${n} more morning${n === 1 ? '' : 's'} on the scale and the trend can say how fast it’s moving.`
      // Months of mornings, a gentle plan and a swinging scale: what IS known.
      : trend != null && plan != null && (w?.n ?? 0) >= 14
        ? `Holding around ${wt(trend, 0)}. A ${dwt(plan)}-a-week loss takes a few more weeks of mornings to show through the day-to-day swings.`
      : 'A few more weeks of mornings on the scale and the trend can say how fast it’s moving.';
  } else {
    const r = dwt(rate);
    const toward = toGo != null && (dir === 'lose' ? rate > 0 : dir === 'gain' ? rate < 0 : false);
    const weeks = toward && Math.abs(rate) >= 0.05 ? Math.ceil(Math.abs(toGo!) / Math.abs(rate)) : null;
    const eta = weeks != null && weeks <= 156 ? ` At that pace, ${goal} in about ${weeks} week${weeks === 1 ? '' : 's'}.` : '';
    if (dir === 'gain') {
      tone = w!.hiKgPerWeek < 0 ? 'good' : w!.loKgPerWeek > 0 ? 'warn' : 'ok';
      story = rate < 0 ? `Up ${r} a week.${eta}` : rate > 0.05 ? `Down ${r} a week, and the goal is up.` : 'The trend isn’t climbing yet.';
    } else if (dir === 'maintain') {
      tone = Math.abs(rate) <= 0.25 ? 'good' : 'warn';
      story = tone === 'good' ? 'Holding at your goal.' : `${rate > 0 ? 'Down' : 'Up'} ${r} a week, away from your goal.`;
    } else {
      tone = i.pace === 'on-pace' || i.pace === 'faster' ? 'good' : i.pace === 'slower' ? 'ok'
        : i.pace === 'stalled' || i.pace === 'gaining' ? 'warn' : 'na';
      story = i.pace === 'stalled' ? 'The trend is flat right now.'
        : rate < 0 ? `Up ${r} a week right now.`
        : i.pace === 'faster' ? `Down ${r} a week, faster than the plan. Keep the protein up.${eta}`
        : i.pace === 'slower' ? `Down ${r} a week, slower than the plan.${eta}`
        : `Down ${r} a week.${eta}`;
    }
  }

  const lost = i.firstKg != null && kg != null ? i.firstKg - kg : null;
  const stats = [
    { v: lost == null ? '—' : `${lost >= 0 ? '−' : '+'}${dwtNum(lost)}`, l: `${changeWord()} so far` },
    { v: rate == null ? '—' : `${rate >= 0 ? '−' : '+'}${dwtNum(rate, 2)}`, l: `${changeWord()} / week` },
    stop && i.goalKg != null && kg != null
      ? { v: dwtNum(kg - i.goalKg), l: `${changeWord()} to ${wtShort(i.goalKg)}` }
      : { v: i.goalKg != null ? wtShort(i.goalKg) : '—', l: st ? 'goal' : `goal ${unitWord()}` },
  ];
  const odds = dir === 'gain' ? oddsOf(chanceOf(w, 'gain'), 'going up')
    : dir === 'maintain' ? oddsOf(chanceOf(w, 'hold'), 'holding')
    : oddsOf(chanceOf(w, 'lose'), 'coming off');
  return { kg, caption, pct, tone, story, stats, odds };
}

/**
 * Keeping it off: the trend against the ceiling, how the days have gone, and
 * the odds that it's holding (not creeping up). Over the ceiling is amber and
 * points at the plan (CommitmentAlerts shows it), never red.
 */
function keeping(k: KeepInput, w: WeightVerdict, trend: number): Pulse {
  const st = weightUnit() === 'st';
  const u = st ? '' : `${unitWord()} `;
  const under = k.ceilingKg - trend;
  const caption = under >= 0
    ? `${u}trend · ${st ? dwt(under) : dwtNum(under)} under your ceiling`
    : `${u}trend · ${st ? dwt(under) : dwtNum(under)} over your ceiling`;
  // Positive is losing; known once the line through the mornings is sure.
  const rate = w.state === 'answerable' || w.state === 'too-noisy' ? w.rateKgPerWeek : null;
  const creeping = rate != null && w.hiKgPerWeek < 0;
  const tone: PulseTone = under < 0 ? 'warn' : creeping ? 'ok' : 'good';
  const since = new Date(`${k.since}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  let story = under < 0 ? 'Over your ceiling. Your plan for this is below; the budget is one step under your usual week until you’re back.'
    : k.days >= 7 ? `Inside your range on ${k.days === k.inside ? 'every one' : k.inside} of the last ${k.days} days.`
    : `Keeping it off since ${since}.`;
  if (under >= 0 && creeping) story += ` The trend is creeping up ${dwt(rate!)} a week: still under your ceiling, and this is what it’s for.`;
  const stats = [
    { v: wtShort(k.goalKg), l: st ? 'goal' : `goal ${unitWord()}` },
    { v: wtShort(k.ceilingKg), l: 'ceiling' },
    { v: k.days ? `${k.inside}/${k.days}` : '—', l: 'days inside' },
  ];
  return { kg: trend, caption, pct: null, tone, story, stats, odds: oddsOf(chanceOf(w, 'hold'), 'holding') };
}
