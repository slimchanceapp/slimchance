// Body weight in the person's own unit.
//
// Every weight is STORED in kilograms (see profile.ts: mixing storage units is
// how weight histories get corrupted). This is the one place that turns a kg
// value into what the person reads, and what they type back into kg. The unit
// is set from the profile (stores/live.ts); remembering it on the device, so
// the first frame after a reload is already in the right unit, is the shell's
// job (stores/units.ts, restored in routes/+layout.ts). Since 2026-11-10 this
// module touches no storage: 15 pure modules used to depend on it, the MCP
// server among them, which runs where there is no browser.
//
// Stone users read their weight as "13 st 1.9 lb" and every change in pounds
// ("down 1.3 lb a week"), as UK scales and slimming clubs do.
//
// Lifting loads on the Train tab stay in kg for now: plates are a separate
// question from body weight. Pure apart from the current unit; see
// selfcheck.js.

export type Units = 'metric' | 'imperial' | 'stone';
export type WeightUnit = 'kg' | 'lb' | 'st';

export const KG_PER_LB = 0.45359237;
const LB_PER_ST = 14;
/** Where the shell remembers the unit on the device (stores/units.ts). */
export const UNIT_MEMORY_KEY = 'recompos.units';

export const weightUnitOf = (units: string | null | undefined): WeightUnit =>
  units === 'imperial' ? 'lb' : units === 'stone' ? 'st' : 'kg';

let current: WeightUnit = 'kg';

/** Called with the profile's `units` whenever the profile loads or changes. */
export function setUnits(units: string | null | undefined): void {
  current = weightUnitOf(units);
}

/** The unit the device remembered ('kg', 'lb' or 'st'), before the profile loads. */
export function restoreUnit(remembered: string | null | undefined): void {
  current = remembered === 'lb' || remembered === 'st' ? remembered : 'kg';
}

export const weightUnit = (): WeightUnit => current;
/** Height is asked in feet and inches by everyone who weighs in pounds or stone. */
export const usesFeet = (): boolean => current !== 'kg';

const lb = (kg: number) => kg / KG_PER_LB;
const fix = (n: number, dp: number) => {
  const s = n.toFixed(dp);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
};

/** The word for a body weight in this unit: kg · lb · st. */
export const unitWord = (u: WeightUnit = current): string => u;
/** The word for a change in weight: kg, or lb for both pounds and stone. */
export const changeWord = (u: WeightUnit = current): string => (u === 'kg' ? 'kg' : 'lb');

/** A body weight without its unit: "83.4", "183.9", "13 st 1.9". */
export function wtNum(kg: number | null | undefined, dp = 1, u: WeightUnit = current): string {
  if (kg == null || !Number.isFinite(kg)) return '—';
  if (u === 'kg') return fix(kg, dp);
  if (u === 'lb') return fix(lb(kg), dp);
  // Stone: whole stones and the pounds left, the pounds rounded first so 13 st
  // 14.0 lb can never be shown (it rolls over to 14 st 0.0).
  const totalLb = Math.round(lb(kg) * 10 ** dp) / 10 ** dp;
  const st = Math.floor(totalLb / LB_PER_ST + 1e-9);
  return `${st} st ${fix(totalLb - st * LB_PER_ST, dp)}`;
}

/** A goal or a stop, which people set as round numbers: "95", "209.5",
 *  "15 st", "15 st 4", without a trailing ".0". */
export function wtShort(kg: number | null | undefined, u: WeightUnit = current): string {
  return wtNum(kg, 1, u).replace(/\.0$/, '').replace(/ 0$/, '');
}

/** The same with its unit: "95 kg", "209.5 lb", "15 st", "15 st 4 lb". */
export function wtShortU(kg: number | null | undefined, u: WeightUnit = current): string {
  const s = wtShort(kg, u);
  if (s === '—') return s;
  return u === 'kg' ? `${s} kg` : u === 'lb' ? `${s} lb` : /st \d/.test(s) ? `${s} lb` : s;
}

/** A body weight with its unit: "83.4 kg", "183.9 lb", "13 st 1.9 lb". */
export function wt(kg: number | null | undefined, dp = 1, u: WeightUnit = current): string {
  if (kg == null || !Number.isFinite(kg)) return '—';
  return `${wtNum(kg, dp, u)} ${u === 'kg' ? 'kg' : 'lb'}`;
}

/** The size of a change, no sign: "0.4" (kg) or "0.9" (lb). */
export function dwtNum(kgDelta: number, dp = 1, u: WeightUnit = current): string {
  return fix(Math.abs(u === 'kg' ? kgDelta : lb(kgDelta)), dp);
}

/** A change with its unit, no sign: "0.4 kg", "0.9 lb". Callers say which way. */
export function dwt(kgDelta: number, dp = 1, u: WeightUnit = current): string {
  return `${dwtNum(kgDelta, dp, u)} ${changeWord(u)}`;
}

/** A body weight in this unit as one plain number, for an input or a chart:
 *  kg or lb; stone users get total pounds (an input splits it itself). */
export function toUnit(kg: number, u: WeightUnit = current): number {
  return u === 'kg' ? kg : lb(kg);
}

/** Back from that plain number (kg, or pounds for lb and stone) to kg. */
export function fromUnit(n: number, u: WeightUnit = current): number {
  return u === 'kg' ? n : n * KG_PER_LB;
}

/** Whole stones and pounds, for the stone input's two boxes. */
export function toStLb(kg: number, dp = 1): { st: number; lb: number } {
  const totalLb = Math.round(lb(kg) * 10 ** dp) / 10 ** dp;
  const st = Math.floor(totalLb / LB_PER_ST + 1e-9);
  return { st, lb: Math.round((totalLb - st * LB_PER_ST) * 10 ** dp) / 10 ** dp };
}

export const fromStLb = (st: number, lbs: number): number => (st * LB_PER_ST + lbs) * KG_PER_LB;

/**
 * What someone typed, in their unit, as kg; null when it isn't a weight.
 * Accepts a comma decimal ("83,4"), an explicit unit that overrides theirs
 * ("83 kg", "183 lb", "13st 2lb"), and for stone "13 2" or "13st 2". A single
 * number from a stone user is stones up to 40 and pounds above that (nobody
 * weighs 41 stone and types it that way; plenty type 249).
 */
export function parseWt(text: string | number | null | undefined, u: WeightUnit = current): number | null {
  if (text == null) return null;
  const t = String(text).trim().toLowerCase().replace(/,/g, '.');
  if (!t) return null;
  const num = (s: string) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);
  let kg: number;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilos?)$/))) kg = Number(m[1]);
  else if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)$/))) kg = Number(m[1]) * KG_PER_LB;
  else if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:st|stone)\s*(?:(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)?)?$/))) kg = fromStLb(Number(m[1]), m[2] ? Number(m[2]) : 0);
  else if (u === 'st' && (m = t.match(/^(\d+)\s+(\d+(?:\.\d+)?)$/))) kg = fromStLb(Number(m[1]), Number(m[2]));
  else {
    const n = num(t);
    if (!Number.isFinite(n)) return null;
    kg = u === 'kg' ? n : u === 'lb' ? n * KG_PER_LB : n <= 40 ? n * LB_PER_ST * KG_PER_LB : n * KG_PER_LB;
  }
  kg = Math.round(kg * 100) / 100;
  return kg >= 20 && kg <= 400 ? kg : null;
}

/** A round weight near this one, rounded in the person's own unit (a stop at
 *  95 kg, 210 lb or 15 st), returned in kg. `step` is in that unit. */
export function roundIn(kg: number, step: number, u: WeightUnit = current): number {
  const n = u === 'kg' ? kg : u === 'lb' ? lb(kg) : lb(kg) / LB_PER_ST;
  const r = Math.round(n / step) * step;
  return u === 'kg' ? r : u === 'lb' ? r * KG_PER_LB : r * LB_PER_ST * KG_PER_LB;
}

/** The round weight at or below this one in the person's unit (95 kg, 210 lb,
 *  15 st), in kg; `step` is in that unit. */
export function floorIn(kg: number, step: number, u: WeightUnit = current): number {
  const n = u === 'kg' ? kg : u === 'lb' ? lb(kg) : lb(kg) / LB_PER_ST;
  const r = Math.floor(n / step) * step;
  return u === 'kg' ? r : u === 'lb' ? Math.round(r * KG_PER_LB * 100) / 100 : Math.round(r * LB_PER_ST * KG_PER_LB * 100) / 100;
}

/** The step people count down in: 5 kg, 10 lb, a stone. */
export const roundStep = (u: WeightUnit = current): number => (u === 'kg' ? 5 : u === 'lb' ? 10 : 1);

/** Heights: cm, or feet and inches. */
export function ht(cm: number | null | undefined): string {
  if (!cm) return '—';
  if (!usesFeet()) return `${Math.round(cm)} cm`;
  const totalIn = Math.round(cm / 2.54);
  return `${Math.floor(totalIn / 12)} ft ${totalIn % 12} in`;
}
