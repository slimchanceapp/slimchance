// Bringing your weigh-ins from another app, so day one has a trend instead of
// a single dot. Most people who try Slim Chance have tried something else first,
// and their history is the most valuable thing they bring: the trend, the
// "how sure", the weekly rhythm all work from the first morning.
//
// The file is read on the device; only one reading a day is saved. Formats:
// Apple Health's export.xml, JSON (Fitbit, this app's own export) and any CSV
// with a date and a weight column (Libra, Happy Scale, MyFitnessPal, Withings,
// Renpho, Garmin, Google Fit, Samsung Health, a spreadsheet). When the file
// doesn't say its unit, or its dates could be read day-first or month-first,
// the caller asks rather than guessing. Pure; see selfcheck.js.

import { KG_PER_LB } from '../units.ts';

export interface RawReading { date: string; time: string; value: number; unit: 'kg' | 'lb' | null; slashed?: [number, number] }
export interface ParsedFile {
  raw: RawReading[];
  /** The unit the file states (a header, the values themselves, Apple's unit); null when it doesn't. */
  unit: 'kg' | 'lb' | null;
  /** Some dates are like 03/04/2024 and none settles which number is the day. */
  dateOrderUnclear: boolean;
  /** Day-first when the dates settle it (a day over 12 in the first place). */
  dayFirst: boolean | null;
  format: string;
  skipped: number;
}
export interface Reading { date: string; kg: number }

const WEIGHT = /weight|body ?mass|gewicht|peso|poids|v[aá]ha|hmotnos/i;
const NOT_WEIGHT = /fat|lean|muscle|bone|water|hydration|bmi|goal|target|trend|change|diff|delta|time|date|visceral|protein/i;
const DATE = /date|time|day|datum|fecha|created|measured|start|when/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** One CSV line into cells, quotes respected ("Weight (kg)", "Jan 5, 2024"). */
export function csvCells(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** A weight cell: "83.4", "83,4", "183.6 lbs", "83.4 kg". */
export function weightCell(s: string, delim = ','): { value: number; unit: 'kg' | 'lb' | null } | null {
  const t = s.trim().toLowerCase();
  const m = t.match(/^(\d{1,3}(?:[.,]\d+)?)\s*(kg|kgs|lb|lbs|pounds?)?$/);
  if (!m) return null;
  if (m[1].includes(',') && delim === ',') return null; // "83,4" can't be one cell of a comma file
  const value = Number(m[1].replace(',', '.'));
  const unit = !m[2] ? null : m[2].startsWith('k') ? 'kg' : 'lb';
  return Number.isFinite(value) && value > 0 ? { value, unit } : null;
}

/**
 * A date cell, as written (the exporting app's own local day). `slashed` keeps
 * the two leading numbers of 03/04/2024 so the caller can settle the order.
 */
export function dateCell(s: string, dayFirst: boolean | null = null): { date: string; time: string; slashed?: [number, number] } | null {
  const t = s.trim().replace(/^"|"$/g, '');
  const time = (t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/) ?? [])[0] ?? '';
  let m: RegExpMatchArray | null;
  const ok = (y: number, mo: number, d: number) => y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return ok(y, mo, d) ? { date: `${y}-${pad(mo)}-${pad(d)}`, time } : null;
  }
  if ((m = t.match(/^(\d{10}|\d{13})$/))) {
    const dt = new Date(m[1].length === 10 ? +m[1] * 1000 : +m[1]);
    return { date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` };
  }
  if ((m = t.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{2,4})/))) {
    const a = +m[1], b = +m[3];
    let y = +m[4]; if (y < 100) y += 2000;
    // Dots are day-first everywhere they're used (05.01.2024).
    const df = m[2] === '.' ? true : a > 12 ? true : b > 12 ? false : dayFirst ?? false;
    const [d, mo] = df ? [a, b] : [b, a];
    return ok(y, mo, d) ? { date: `${y}-${pad(mo)}-${pad(d)}`, time, slashed: m[2] === '.' ? undefined : [a, b] } : null;
  }
  // "Jan 5, 2024", "5 January 2024", "January 5 2024"
  const words = t.toLowerCase();
  const mi = MONTHS.findIndex((mn) => new RegExp(`\\b${mn}`).test(words));
  if (mi >= 0) {
    const nums = (words.replace(/\d{1,2}:\d{2}(:\d{2})?/, '').match(/\d+/g) ?? []).map(Number);
    const y = nums.find((n) => n >= 1990 && n <= 2100);
    const d = nums.find((n) => n >= 1 && n <= 31);
    if (y && d && ok(y, mi + 1, d)) return { date: `${y}-${pad(mi + 1)}-${pad(d)}`, time };
  }
  return null;
}

/** Apple Health body-mass records in a piece of export.xml. Returns what's
 *  left after the last complete record, to prepend to the next piece. */
export function appleRecords(chunk: string): { raw: RawReading[]; rest: string } {
  const raw: RawReading[] = [];
  const re = /<Record\b[^>]*type="HKQuantityTypeIdentifierBodyMass"[^>]*>/g;
  let m: RegExpExecArray | null, end = 0;
  while ((m = re.exec(chunk))) {
    const tag = m[0];
    const attr = (k: string) => (tag.match(new RegExp(`\\b${k}="([^"]*)"`)) ?? [])[1] ?? '';
    const d = dateCell(attr('startDate'));
    const value = Number(attr('value'));
    const u = attr('unit').toLowerCase();
    if (d && value > 0) raw.push({ date: d.date, time: d.time, value, unit: u === 'lb' ? 'lb' : u === 'kg' ? 'kg' : null });
    end = re.lastIndex;
  }
  // Every complete record before `end` is read; what follows holds at most a
  // tag cut in half by the piece boundary (records are well under 4 KB).
  return { raw, rest: chunk.slice(Math.max(end, chunk.length - 4096)) };
}

/** The readings of a whole Apple export, as a parsed file. */
export function appleParsed(raw: RawReading[], skipped = 0): ParsedFile {
  const units = new Set(raw.map((x) => x.unit));
  return { raw, unit: units.size === 1 ? raw[0]?.unit ?? null : null, dateOrderUnclear: false, dayFirst: null, format: 'Apple Health', skipped };
}

function fromRows(rows: string[][], delim: string, unitHint: 'kg' | 'lb' | null): { raw: RawReading[]; unit: 'kg' | 'lb' | null; skipped: number } {
  // The header: the first row (of the first few) naming a weight column and,
  // preferably, a date one (Samsung's first line names only the data type).
  const isW = (c: string) => WEIGHT.test(c) && !NOT_WEIGHT.test(c.replace(WEIGHT, ''));
  const top = rows.slice(0, 6);
  let h = top.findIndex((r) => r.some(isW) && r.some((c) => DATE.test(c) && !isW(c)));
  if (h < 0) h = top.findIndex((r) => r.some(isW));
  let wi = -1, di = -1, unit = unitHint;
  if (h >= 0) {
    const head = rows[h];
    const score = (c: string): number => (!WEIGHT.test(c) ? -1 : /^(body ?)?weight\b/i.test(c) ? 2 : NOT_WEIGHT.test(c.replace(WEIGHT, '')) ? -1 : 1);
    const scores = head.map(score);
    // The best-named weight column; the first of equals (Google Fit: average before max).
    wi = scores.reduce<number>((best, sc, i) => (sc > (best < 0 ? -1 : scores[best]) ? i : best), -1);
    di = head.findIndex((c, i) => i !== wi && DATE.test(c));
    const hu = head[wi] ?? '';
    if (/\b(kg|kgs|kilo)/i.test(hu)) unit = 'kg';
    else if (/\b(lb|lbs|pound)/i.test(hu)) unit = 'lb';
  } else {
    // No header: a date and a weight, in that order.
    h = -1; di = 0; wi = 1;
  }
  const raw: RawReading[] = [];
  let skipped = 0;
  for (const r of rows.slice(h + 1)) {
    const d = di >= 0 ? dateCell(r[di] ?? '') : null;
    const w = weightCell(r[wi] ?? '', delim);
    if (!d || !w) { if (r.some((c) => c)) skipped++; continue; }
    raw.push({ date: d.date, time: d.time, value: w.value, unit: w.unit ?? unit, slashed: d.slashed });
  }
  const units = new Set(raw.map((x) => x.unit).filter(Boolean));
  return { raw, unit: units.size === 1 ? [...units][0] as 'kg' | 'lb' : unit, skipped };
}

/** Read a whole file's text (CSV, TSV, JSON or a small Apple export). */
export function parseWeightFile(text: string): ParsedFile {
  const t = text.replace(/^﻿/, '');
  let raw: RawReading[] = [], unit: 'kg' | 'lb' | null = null, skipped = 0, format = 'CSV';
  if (/<HealthData\b|HKQuantityTypeIdentifierBodyMass/.test(t.slice(0, 200000)) || /^\s*<\?xml/.test(t)) {
    return appleParsed(appleRecords(t).raw);
  } else if (/^\s*[[{]/.test(t)) {
    format = 'JSON';
    let j: any; try { j = JSON.parse(t); } catch { j = null; }
    const list: any[] = Array.isArray(j) ? j : Array.isArray(j?.tables?.weights) ? j.tables.weights : Array.isArray(j?.weights) ? j.weights : [];
    // 'Moderly': the app's name until 30 Oct 2026; its exports still come in.
    if (j?.app === 'Slim Chance' || j?.app === 'Moderly') { format = 'Slim Chance export'; unit = 'kg'; }
    for (const o of list) {
      if (!o || typeof o !== 'object') { skipped++; continue; }
      const dk = Object.keys(o).find((k) => DATE.test(k) && !/created|updated/i.test(k)) ?? Object.keys(o).find((k) => DATE.test(k));
      const wk = Object.keys(o).find((k) => /^(weight|weight_kg|weightkg|kg|bodymass|body_mass)$/i.test(k));
      const d = dk ? dateCell(String(o[dk]) + (o.time ? ` ${o.time}` : '')) : null;
      const w = wk != null ? weightCell(String(o[wk])) : null;
      if (!d || !w) { skipped++; continue; }
      raw.push({ date: d.date, time: d.time, value: w.value, unit: w.unit ?? (wk && /kg/i.test(wk) ? 'kg' : unit), slashed: d.slashed });
    }
  } else {
    const lines = t.split(/\r?\n/);
    // Libra-style comments: "#Units:kg", and a header written as a comment.
    const hint = (t.match(/^#\s*units?\s*[:=]\s*(kg|lb)/im) ?? [])[1] as 'kg' | 'lb' | undefined;
    const body = lines.filter((l) => l.trim() && !(/^#/.test(l) && !WEIGHT.test(l))).map((l) => l.replace(/^#\s*/, ''));
    const first = body.find((l) => /[,;\t]/.test(l)) ?? '';
    const delim = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
    format = delim === '\t' ? 'TSV' : 'CSV';
    const res = fromRows(body.map((l) => csvCells(l, delim)), delim, hint ?? null);
    raw = res.raw; unit = res.unit; skipped = res.skipped;
  }
  // 03/04/2024: settled when any date has a day over 12 in one of the places.
  const slashed = raw.filter((x) => x.slashed);
  const dayFirst = slashed.some((x) => x.slashed![0] > 12) ? true : slashed.some((x) => x.slashed![1] > 12) ? false : null;
  return { raw, unit, dateOrderUnclear: slashed.length > 0 && dayFirst == null, dayFirst, format, skipped };
}

/**
 * The readings to save: one a day (the earliest that day, which is the
 * morning one), in kg, oldest first, plausible weights only. `unit` is used
 * where the file didn't say; `dayFirst` settles 03/04-style dates.
 */
export function readingsFrom(p: ParsedFile, unit: 'kg' | 'lb', dayFirst: boolean): Reading[] {
  const byDay = new Map<string, { time: string; kg: number; i: number }>();
  const order = p.dayFirst ?? dayFirst;
  p.raw.forEach((r, i) => {
    let date = r.date;
    if (r.slashed) {
      // Every 03/04-style date in the file read in one order: the one its
      // other dates settle, else the one the person chose.
      const [a, b] = r.slashed, y = date.slice(0, 4);
      const [d, mo] = order ? [a, b] : [b, a];
      if (mo > 12 || d > 31) return;
      date = `${y}-${pad(mo)}-${pad(d)}`;
    }
    const u = r.unit ?? unit;
    const kg = Math.round((u === 'lb' ? r.value * KG_PER_LB : r.value) * 100) / 100;
    if (!(kg >= 25 && kg <= 350)) return;
    const prev = byDay.get(date);
    if (!prev || (r.time && prev.time && r.time < prev.time)) byDay.set(date, { time: r.time, kg, i });
  });
  return [...byDay].map(([date, v]) => ({ date, kg: v.kg })).sort((a, b) => a.date.localeCompare(b.date));
}

/** A guess for a file that doesn't say: pounds when the typical reading is
 *  over 150 (few adults weigh 150 kg; many weigh 150 lb), else the person's
 *  own setting. Shown as a choice, never applied silently. */
export function guessUnit(p: ParsedFile, own: 'kg' | 'lb'): 'kg' | 'lb' {
  if (p.unit) return p.unit;
  const v = p.raw.map((r) => r.value).sort((a, b) => a - b);
  const median = v[Math.floor(v.length / 2)] ?? 0;
  return median > 150 ? 'lb' : median < 60 ? 'kg' : own;
}
