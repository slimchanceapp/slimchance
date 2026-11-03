// Daily readiness score (Oura/WHOOP-style, hardware-free) and training
// load balance (acute:chronic workload ratio, WHOOP-style injury-risk
// signal). Both are pure math over manually-entered biometrics + the
// workout log that already exists -- no wearable required.

export interface BiometricEntry {
  date: string;
  sleep_hours?: number | null;
  sleep_quality?: number | null; // 1-5
  resting_hr?: number | null;
  hrv?: number | null;
}

export interface ReadinessResult {
  score: number; // 0-100
  label: 'Low' | 'Fair' | 'Good' | 'Great';
  factors: string[];
}

/**
 * Composite readiness score from whichever inputs are available today.
 * Weighting mirrors the published rationale behind Oura's Readiness Score
 * and WHOOP's Recovery Score (HRV weighted most heavily, then resting HR
 * trend, then sleep) -- but works gracefully with partial data: if the
 * user only logs sleep, the score is computed from sleep alone.
 */
export function computeReadiness(
  today: BiometricEntry | undefined,
  recentHistory: BiometricEntry[], // last ~14 days, for personal baselines
  targetSleepHours = 8
): ReadinessResult | null {
  if (!today) return null;
  const factors: string[] = [];
  const parts: Array<{ weight: number; score: number }> = [];

  if (today.sleep_hours != null) {
    const sleepScore = Math.min(100, (today.sleep_hours / targetSleepHours) * 100);
    parts.push({ weight: 0.35, score: sleepScore });
    factors.push(`Sleep: ${today.sleep_hours}h vs ${targetSleepHours}h target`);
  }
  if (today.sleep_quality != null) {
    parts.push({ weight: 0.15, score: (today.sleep_quality / 5) * 100 });
    factors.push(`Sleep quality: ${today.sleep_quality}/5`);
  }
  if (today.hrv != null) {
    const baseline = average(recentHistory.map((r) => r.hrv).filter((v): v is number => v != null));
    const hrvScore = baseline ? Math.min(100, Math.max(0, (today.hrv / baseline) * 100)) : 70;
    parts.push({ weight: 0.35, score: hrvScore });
    factors.push(baseline ? `HRV: ${today.hrv}ms vs ${baseline.toFixed(0)}ms baseline` : `HRV: ${today.hrv}ms (no baseline yet)`);
  }
  if (today.resting_hr != null) {
    const baseline = average(recentHistory.map((r) => r.resting_hr).filter((v): v is number => v != null));
    // Lower RHR than baseline = better recovery; higher = worse.
    const rhrScore = baseline ? Math.min(100, Math.max(0, 100 - (today.resting_hr - baseline) * 5)) : 70;
    parts.push({ weight: 0.15, score: rhrScore });
    factors.push(baseline ? `Resting HR: ${today.resting_hr} vs ${baseline.toFixed(0)} baseline` : `Resting HR: ${today.resting_hr}bpm`);
  }

  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = Math.round(parts.reduce((s, p) => s + (p.weight / totalWeight) * p.score, 0));
  const label = score >= 80 ? 'Great' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Low';
  return { score, label, factors };
}

/** Readiness as words for Today's "Body" row (the owner, 2026-11-03: "I use
 *  my watch a lot but I don't see you pulling data from it to make sense for
 *  me"): how hard to train today, and the numbers behind it beside the
 *  person's own normal of the last two weeks. */
export function readyToday(today: BiometricEntry | undefined, history: BiometricEntry[]):
  { word: ReadinessResult['label']; advice: string; detail: string; tone: 'good' | 'ok' | 'warn' } | null {
  const r = computeReadiness(today, history);
  if (!r || !today) return null;
  const normal = (k: 'resting_hr' | 'hrv') => average(history.map((h) => h[k]).filter((v): v is number => v != null));
  const bits: string[] = [];
  if (today.sleep_hours != null) bits.push(`slept ${(+today.sleep_hours).toFixed(1)} h`);
  const rhr = normal('resting_hr');
  if (today.resting_hr != null) bits.push(`resting ${Math.round(today.resting_hr)}${rhr ? ` (normal ${Math.round(rhr)})` : ''}`);
  const hrv = normal('hrv');
  if (today.hrv != null) bits.push(`HRV ${Math.round(today.hrv)}${hrv ? ` (normal ${Math.round(hrv)})` : ''}`);
  const advice = r.label === 'Great' || r.label === 'Good' ? 'Ready for a hard session.' : r.label === 'Fair' ? 'Train, but keep it moderate.' : 'An easy day: a walk or light work.';
  return { word: r.label, advice, detail: bits.join(' · '), tone: r.label === 'Low' ? 'warn' : r.label === 'Fair' ? 'ok' : 'good' };
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// — Per-muscle recovery windows (BASE hours to full recovery) —
// Evidence-based, trained-individual, moderate-volume baselines. Trained
// lifters doing habitual work recover far faster than the old flat 72h:
// myofibrillar MPS returns to ~baseline by ~36h in trained subjects
// (MacDougall 1995), and 2×/week frequency beating 1×/week (Schoenfeld
// 2016 meta) proves muscles are ready well inside 72h. Larger, high-EIMD
// groups still sit higher; small/endurance groups recover fastest.
// Actual window = base × exerciseModifier() (see below) so a low-damage
// isolation move (leg extension) recovers much faster than a high-eccentric
// compound (RDL) hitting the same muscle.
export const MUSCLE_RECOVERY_HOURS: Record<string, number> = {
  Quads: 60, Hamstrings: 60, Glutes: 54, Back: 54,
  Chest: 54, Shoulders: 42, Triceps: 42, Biceps: 42, Calves: 42,
  Core: 30,
};

/**
 * Exercise-type recovery modifier (multiplies the base per-muscle window).
 * Heavy-eccentric compounds load the muscle at long lengths → most damage →
 * slowest recovery (Proske & Morgan 2001); machine/isolation moves have a
 * short eccentric ROM → least damage → fastest. This is what makes an RDL
 * legitimately need ~72h for hamstrings while a leg extension needs ~45h for
 * quads, instead of a misleading flat 72h for both.
 */
export function exerciseModifier(name: string): number {
  const n = (name || '').toLowerCase();
  // High-eccentric / long-length compounds → longer recovery.
  if (/\brdl\b|romanian|dead\s?lift|deadlift|nordic|good\s?morning|stiff.?leg|\bsquat\b|split squat|lunge|weighted (pull|chin)|pull.?up|chin.?up/.test(n)) return 1.25;
  // Isolation / machine / short-ROM → shorter recovery.
  if (/extension|curl|\bfly|flye|pushdown|press.?down|kickback|raise|pec deck|cable|machine|crunch|lateral|rear delt|calf/.test(n)) return 0.75;
  // Standard compound (bench, row, OHP, hip thrust, leg press, pulldown).
  return 1.0;
}

export type RecoveryStatus = 'fatigued' | 'recovering' | 'ready' | 'none';

/**
 * Recovery state for a muscle given how long ago it was last trained and
 * that muscle's recovery window. Returns a 0–100% recovery estimate and
 * the hours remaining until "ready", so the UI can SHOW the reason
 * ("Ready in ~32h") rather than an opaque label.
 */
export function recoveryState(hoursAgo: number | null, windowH: number): {
  status: RecoveryStatus; pct: number; readyInH: number;
} {
  if (hoursAgo == null) return { status: 'none', pct: 0, readyInH: 0 };
  const pct = Math.max(0, Math.min(100, Math.round((hoursAgo / windowH) * 100)));
  const readyInH = Math.max(0, Math.round(windowH - hoursAgo));
  let status: RecoveryStatus;
  if (hoursAgo >= windowH) status = 'ready';
  else if (hoursAgo >= windowH * 0.5) status = 'recovering';
  else status = 'fatigued';
  return { status, pct, readyInH };
}

// — Training load (session-RPE method, Foster et al. 2001) —
export interface WorkoutLoadEntry { date: string; loadAU: number; }

/**
 * Session RPE training load: duration (minutes) × RPE (1-10). This is a
 * validated, widely-used sports-science method for quantifying training
 * stress without needing HR data. We approximate duration from the
 * number of sets logged (assume ~3 min/set incl. rest) since we don't
 * currently capture session duration directly.
 */
export function sessionLoad(setCount: number, rpe: number, minutesPerSet = 3): number {
  return setCount * minutesPerSet * rpe;
}

export interface AcwrResult {
  acuteAvg: number; // last 7 days daily average load
  chronicAvg: number; // last 28 days daily average load
  ratio: number | null;
  zone: 'undertrained' | 'sweet-spot' | 'caution' | 'high-risk' | 'no-data';
}

/**
 * Acute:Chronic Workload Ratio -- compares the last 7 days of training
 * load to the last 28 days. A ratio consistently above ~1.5 is
 * associated with meaningfully higher injury risk in the sports-science
 * literature; 0.8-1.3 is generally considered the "sweet spot".
 */
export function acuteChronicRatio(loads: WorkoutLoadEntry[], today: string): AcwrResult {
  const dayMs = 86400000;
  const todayTime = new Date(today + 'T00:00:00').getTime();
  const inWindow = (date: string, days: number) => {
    const t = new Date(date + 'T00:00:00').getTime();
    const diff = (todayTime - t) / dayMs;
    return diff >= 0 && diff < days;
  };

  const acute = loads.filter((l) => inWindow(l.date, 7));
  const chronic = loads.filter((l) => inWindow(l.date, 28));

  const acuteAvg = acute.reduce((s, l) => s + l.loadAU, 0) / 7;
  const chronicAvg = chronic.reduce((s, l) => s + l.loadAU, 0) / 28;

  if (chronic.length < 3) return { acuteAvg, chronicAvg, ratio: null, zone: 'no-data' };

  const ratio = chronicAvg > 0 ? acuteAvg / chronicAvg : null;
  let zone: AcwrResult['zone'] = 'no-data';
  if (ratio != null) {
    if (ratio < 0.8) zone = 'undertrained';
    else if (ratio <= 1.3) zone = 'sweet-spot';
    else if (ratio <= 1.5) zone = 'caution';
    else zone = 'high-risk';
  }
  return { acuteAvg, chronicAvg, ratio, zone };
}
