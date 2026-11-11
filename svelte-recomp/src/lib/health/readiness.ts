// The morning read: how hard to train today, from last night and this
// morning's watch numbers against the person's own normal range (book
// chapter 7; scripts/eval-readiness.mjs chose the rule). Pure.

export interface BiometricEntry {
  date: string;
  sleep_hours?: number | null;
  sleep_quality?: number | null; // 1-5
  resting_hr?: number | null;
  hrv?: number | null;
}

export type ReadinessLabel = 'Low' | 'Fair' | 'Good' | 'Great';

/** Readiness as words for Today's "Body" row (the owner, 2026-11-03: "I use
 *  my watch a lot but I don't see you pulling data from it to make sense for
 *  me"): how hard to train today, and the numbers behind it beside the
 *  person's own normal of the last two weeks. */
export function readyToday(today: BiometricEntry | undefined, history: BiometricEntry[]):
  { word: ReadinessLabel; advice: string; detail: string; tone: 'good' | 'ok' | 'warn' } | null {
  // Judged against the person's own normal range since 2026-11-11: the score
  // above said "ready" on 99.9% of strained mornings (scripts/eval-readiness.mjs).
  return readyFromNormal(today, history);
}

/** Readiness against the person's own normal RANGE, not their average: a
 *  morning counts only when it sits outside the spread their own mornings
 *  usually have. HRV on a log scale (it swings by ratios), resting heart rate in
 *  beats, sleep against their own usual night. No verdict on HRV or resting
 *  heart rate until 7 mornings make a normal (Oura learns for two weeks). */
/** This morning against the person's own normal: HRV (on a log scale) and
 *  resting heart rate as z-scores against their history, and sleep as hours
 *  short of their usual. Null where there's no reading or not yet a normal. */
export function normalZ(today: BiometricEntry, history: BiometricEntry[]) {
  const spread = (xs: number[], floor: number) => {
    if (xs.length < 7) return null;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    return { m, sd: Math.max(sd, floor) };
  };
  const hrvN = spread(history.map((h) => h.hrv).filter((v): v is number => v != null && v > 0).map(Math.log), 0.04);
  const rhrN = spread(history.map((h) => h.resting_hr).filter((v): v is number => v != null), 1);
  const nights = history.slice(-14).map((h) => h.sleep_hours).filter((v): v is number => v != null);
  const usualSleep = nights.length >= 5 ? nights.reduce((a, b) => a + b, 0) / nights.length : null;
  return {
    hrvN, rhrN, usualSleep,
    zHrv: hrvN && today.hrv ? (Math.log(today.hrv) - hrvN.m) / hrvN.sd : null,
    zRhr: rhrN && today.resting_hr != null ? (today.resting_hr - rhrN.m) / rhrN.sd : null,
    short: usualSleep != null && today.sleep_hours != null ? usualSleep - today.sleep_hours : null,
  };
}

export function readyFromNormal(today: BiometricEntry | undefined, history: BiometricEntry[]):
  { word: ReadinessLabel; advice: string; detail: string; tone: 'good' | 'ok' | 'warn' } | null {
  if (!today) return null;
  const { hrvN, rhrN, usualSleep, zHrv, zRhr, short } = normalZ(today, history);
  if (zHrv == null && zRhr == null && short == null) return null;
  const h = zHrv ?? 0, r = zRhr ?? 0, s = short ?? 0;
  // Without HRV (many watch apps don't pass it to Health Connect: the owner's
  // OnePlus watch, through OHealth, never has) the HRV rule could never say Low.
  // Resting heart rate and sleep decide it instead (eval-readiness, no-HRV
  // rows: 22-51% of strained mornings caught, 1-2% of ordinary ones called easy).
  const low = zHrv == null
    ? r >= 2 || (r >= 1.5 && s >= 1)
    : (h <= -1.5 && (r >= 1 || s >= 1)) || h <= -2.5 || (r >= 2.5 && h <= -0.5);
  const word: ReadinessLabel =
    low ? 'Low'
    : h <= -1 || r >= 1.5 || s >= 1.5 ? 'Fair'
    : h >= 0.5 && r <= 0 && s <= 0.3 ? 'Great'
    : 'Good';
  const bits: string[] = [];
  if (today.sleep_hours != null) bits.push(`slept ${(+today.sleep_hours).toFixed(1)} h${usualSleep != null ? ` (usual ${usualSleep.toFixed(1)})` : ''}`);
  if (today.resting_hr != null) bits.push(`resting ${Math.round(today.resting_hr)}${rhrN ? ` (normal ${Math.round(rhrN.m)})` : ''}`);
  if (today.hrv != null) bits.push(`HRV ${Math.round(today.hrv)}${hrvN ? ` (normal ${Math.round(Math.exp(hrvN.m))})` : ''}`);
  const advice = word === 'Great' || word === 'Good' ? 'Ready for a hard session.' : word === 'Fair' ? 'Train, but keep it moderate.' : 'An easy day: a walk or light work.';
  return { word, advice, detail: bits.join(' · '), tone: word === 'Low' ? 'warn' : word === 'Fair' ? 'ok' : 'good' };
}
