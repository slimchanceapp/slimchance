// The forecast where the phone is, for the morning briefing (briefing.ts).
//
// Approximate position only (the manifest asks for nothing finer), rounded to
// two decimals — about a kilometre — before it leaves the phone, and kept on
// this device: it is never written to the database. Open-Meteo needs no key
// and no account.
import { parseForecast, type DayForecast } from './briefing.ts';

const CACHE = 'recompos.weather';
const DENIED = 'recompos.weather.denied';
const FRESH_MS = 60 * 60 * 1000;

interface Cached { at: number; lat: number; lon: number; days: DayForecast[] }

function read<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function write(key: string, v: unknown): void {
  try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

function position(): Promise<{ lat: number; lon: number } | 'denied' | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
      (e) => resolve(e.code === e.PERMISSION_DENIED ? 'denied' : null),
      { enableHighAccuracy: false, maximumAge: 3 * 60 * 60 * 1000, timeout: 20_000 },
    );
  });
}

let inflight: Promise<DayForecast[] | null> | null = null;

/**
 * The next three days here, at most an hour old. Asks for location once on
 * its own; after a "no" it only asks again when `ask` is set (the user tapped
 * "Use my location"), and falls back to the last place it knew.
 */
export function forecastHere(ask = false): Promise<DayForecast[] | null> {
  const cached = read<Cached>(CACHE);
  if (!ask && cached && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.days);
  // Cleared in .finally, which always runs after this assignment.
  inflight ??= load(ask, cached).finally(() => { inflight = null; });
  return inflight;
}

async function load(ask: boolean, cached: Cached | null): Promise<DayForecast[] | null> {
  try {
    let at: { lat: number; lon: number } | null = cached ? { lat: cached.lat, lon: cached.lon } : null;
    if (ask || !read<boolean>(DENIED)) {
      const p = await position();
      if (p === 'denied') write(DENIED, true);
      else if (p) { at = p; write(DENIED, null); }
    }
    if (!at) return cached?.days ?? null;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lon}`
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min&hourly=precipitation_probability'
      + '&timezone=auto&forecast_days=3';
    const res = await fetch(url);
    if (!res.ok) return cached?.days ?? null;
    const days = parseForecast(await res.json());
    if (!days.length) return cached?.days ?? null;
    write(CACHE, { at: Date.now(), ...at, days } satisfies Cached);
    return days;
  } catch {
    return cached?.days ?? null;
  }
}

/** Location was refused, so the weather can't follow the phone. */
export function locationRefused(): boolean {
  return !!read<boolean>(DENIED);
}
