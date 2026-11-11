// Personas: made-up people run through the app's pure logic, so a change in
// what someone would read shows up as a diff of scripts/personas.snap.json.
// Each one comes from something that broke for a real person. selfcheck.js
// compares; after a change that was meant: node scripts/personas.mjs --update,
// and the snapshot's diff goes into the commit. A fixed day and a seeded
// wobble keep every run the same.
import './clock.mjs';
import { writeFileSync } from 'node:fs';
import { weightVerdict, paceVsPlan } from '../src/lib/body/insights.ts';
import { pulse } from '../src/lib/body/pulse.ts';
import { dayOnePlan } from '../src/lib/dayOne.ts';
import { explainUp } from '../src/lib/body/scaleUp.ts';
import { fitness } from '../src/lib/fitness.ts';
import { weeklyReview } from '../src/lib/weeklyReview.ts';
import { situationalNudges } from '../src/lib/situational.ts';
import { trainedDates } from '../src/lib/health/exercise.ts';
import { strengthTrend } from '../src/lib/strength.ts';
import { morningsThisWeek } from '../src/lib/body/scale.ts';
import { SITES, nextDose, sitesByRest, reportText } from '../src/lib/meds.ts';
import { kindWord } from '../src/lib/kind.ts';
import { lessonFor } from '../src/lib/lessons.ts';

const TODAY = '2026-11-04'; // a Wednesday
const asOf = Date.parse(`${TODAY}T12:00:00`);
const pad = (n) => String(n).padStart(2, '0');
const day = (k) => { const d = new Date(asOf); d.setDate(d.getDate() - k); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
let seed = 1;
const wobble = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));
const hero = (p) => pick(p, ['caption', 'tone', 'story']);

/** 2026-10-26 and 28: the gym on a watch as "Overall fitness", no sets typed,
 *  and the weekly review said "Only 0 logged lifting days". */
function watchGymGoer() {
  seed = 7;
  const weights = [];
  for (let k = 59; k >= 0; k--) if (k % 9 !== 4) weights.push({ date: day(k), weight: +(113.6 - (59 - k) * 0.013 + wobble() * 1.1).toFixed(1) });
  const restingHr = [];
  for (let k = 59; k >= 0; k--) restingHr.push({ date: day(k), bpm: Math.round(50 + wobble() * 6) });
  const steps = new Map();
  for (let k = 1; k <= 59; k++) steps.set(day(k), Math.round(8500 + wobble() * 6000));
  const activity = [
    ...[0, 2, 7, 9].map((k) => ({ date: day(k), duration_min: 50, kind: 'other', source: 'watch' })),
    ...[30, 33, 37, 40, 44, 47].map((k) => ({ date: day(k), duration_min: 110, kind: 'sport', source: 'watch' })),
  ];
  const trained = trainedDates([], activity, []);
  const w = weightVerdict(weights, asOf);
  return {
    trend: { state: w.state, trendKg: w.trendKg, kgPerWeek: +w.rateKgPerWeek.toFixed(2) },
    hero: hero(pulse({ weight: w, pace: paceVsPlan(w, 0.5), firstKg: weights[0].weight, goalKg: 100, next: null, planKgPerWeek: 0.5 })),
    fitness: fitness({ today: TODAY, restingHr, steps, trained, strength: strengthTrend([], { asOf }), since: day(59) }),
    week: pick(weeklyReview({ today: TODAY, weights, intake: [], steps: [...steps].map(([date, count]) => ({ date, count })), sleep: [],
      workouts: [], trained, learnedTdee: null, proteinTargetG: 180, goalKg: 100 }), ['sessions', 'headline', 'adjustments']),
    nudges: situationalNudges({ nowMinutes: 8 * 60, proteinG: 0, proteinTargetG: 180, kcal: 0, kcalTargetKcal: null, foodEntriesToday: 0,
      isTrainingDay: true, workoutLoggedToday: trained.has(TODAY), watchTrains: true, daysSinceWeighIn: 0,
      session: { label: 'Heavy Lower Body', time: '17:30', sport: null } }).map((n) => n.key),
  };
}

/** 2026-10-30: a stranger's second morning read 0.6 kg up, and the goal moved
 *  a week, the budget moved, and the app spoke of a log they didn't have. */
function strangerMorningTwo() {
  const weights = [{ date: day(1), weight: 92.4 }, { date: day(0), weight: 93.0 }];
  const w = weightVerdict(weights, asOf);
  const profile = { birth_year: 1990, height_cm: 175, sex: 'female', activity_level: 'moderate', goal_kg: 80, start_kg: 92.4 };
  const plan = dayOnePlan({ profile, currentWeightKg: w.trendKg ?? w.meanKg, weighInCount: 2, foodLogCount: 0, workoutLogCount: 0, scheduleDays: 0, planCount: 0, now: new Date(asOf) });
  return {
    trend: { state: w.state, meanKg: w.meanKg, weighInsNeeded: w.weighInsNeeded },
    hero: hero(pulse({ weight: w, pace: paceVsPlan(w, null), firstKg: 92.4, goalKg: 80, next: null })),
    plan: { headline: plan?.headline ?? null, targetKcal: plan?.targetKcal ?? null, goalDate: plan?.goalDate ?? null,
      steps: (plan?.steps ?? []).map((s) => `${s.done ? '[x]' : '[ ]'} ${s.label}: ${s.hint}`) },
    scaleUp: explainUp({ today: TODAY, kg: 93.0, prev: { date: day(1), kg: 92.4 }, trendKg: null, trendPrevKg: null, scatterKg: 0,
      intake: new Map(), weekdayOffsets: null, trained: new Set() }),
    mornings: morningsThisWeek(weights, TODAY),
  };
}

/** 2026-10-31: what Today says on a newcomer's seventh morning, the moment
 *  the first week is built for: the odds (or how many mornings to go), a kind
 *  word only if earned, and the lesson of the day. */
function newcomerDaySeven() {
  seed = 3;
  const weights = [];
  for (let k = 6; k >= 0; k--) weights.push({ date: day(k), weight: +(88.0 - (6 - k) * 0.15 + wobble() * 0.8).toFixed(1) });
  const w = weightVerdict(weights, asOf);
  const p = pulse({ weight: w, pace: paceVsPlan(w, 0.5), firstKg: weights[0].weight, goalKg: 78, next: null, planKgPerWeek: 0.5 });
  const mornings = morningsThisWeek(weights, TODAY);
  return {
    trend: { state: w.state, trendKg: w.trendKg },
    meaning: p.odds?.text ?? (w.state === 'not-enough' ? p.story : null),
    mornings,
    kind: kindWord(weights.map((x) => x.date), TODAY, mornings),
    lesson: lessonFor({ today: TODAY, firstWeighIn: weights[0].date, odds: p.odds != null, stalled: false, seen: new Set() })?.title ?? null,
  };
}

/** The GLP-1 companion (2026-10-30): a weekly dose stepped up once, a few
 *  feelings, one blood test, and the report a doctor would read. */
function glp1User() {
  const med = { id: 'm', name: 'semaglutide', dose: 0.5, unit: 'mg', every_days: 7, weekday: 3, time: '09:00', started: day(56), stopped: null };
  const events = [];
  for (let k = 56; k >= 0; k -= 7) events.push({ id: `d${k}`, med_id: 'm', kind: 'dose', date: day(k), dose: k > 28 ? 0.25 : 0.5, site: SITES[((56 - k) / 7) % SITES.length] });
  events.push(
    { id: 'e1', med_id: 'm', kind: 'effect', date: day(54), symptom: 'Nausea', severity: 2 },
    { id: 'e2', med_id: 'm', kind: 'effect', date: day(27), symptom: 'Nausea', severity: 1 },
    { id: 'e3', med_id: 'm', kind: 'effect', date: day(26), symptom: 'Constipation', severity: 1 },
    { id: 'l1', med_id: null, kind: 'lab', date: day(20), test: 'HbA1c', value: 6.1, unit: '%', ref_low: 4, ref_high: 5.6 },
  );
  const trend = [];
  for (let k = 63; k >= 0; k--) trend.push({ date: day(k), trendKg: +(104 - (63 - k) * 0.12).toFixed(1) });
  return {
    next: nextDose(med, events, TODAY),
    sites: sitesByRest(events).slice(0, 2),
    report: reportText({ med, events, today: TODAY, trend, proteinAvgG: 95, proteinTargetG: 130,
      training: 'Trained 3 days in the last four weeks, as in the four before.', unit: 'kg' }).split('\n'),
  };
}

export function runPersonas() {
  return {
    'a watch-only gym-goer': watchGymGoer(),
    'a stranger on morning two': strangerMorningTwo(),
    'a GLP-1 user': glp1User(),
    'a newcomer on their seventh morning': newcomerDaySeven(),
  };
}

if (process.argv.includes('--update')) {
  writeFileSync(new URL('./personas.snap.json', import.meta.url), JSON.stringify(runPersonas(), null, 2) + '\n');
  console.log('personas: snapshot updated; review its diff before committing.');
}
