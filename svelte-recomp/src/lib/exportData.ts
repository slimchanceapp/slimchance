// YOUR DATA IS YOURS.
//
// The app asks people to hand it a year of their life — every weigh-in, every
// meal, every set — and until now there was no way to get any of it back out.
// For anything health-related that is table stakes, not a feature: an app you
// cannot leave is an app you should think twice about joining.
//
// Exports EVERYTHING the signed-in user owns, straight from the local Dexie
// mirror (which RLS already guarantees contains only their rows), in two shapes:
//   JSON — complete and re-importable, every table, every column
//   CSV  — one file per table, for a spreadsheet or a doctor
//
// Pure string-building here; the file-delivery half lives in shareFile.ts,
// because a browser download and an Android share sheet are different mechanics.

/** Every table the app syncs — deliberately the same list as stores/sync.ts, so
 *  a table added there but forgotten here shows up as a failing check. */
export const EXPORT_TABLES = [
  'alarms', 'daily_logs', 'checks', 'tracks', 'weights', 'steps', 'sessions',
  'user_settings', 'workout_schedule', 'workout_sessions_custom',
  'workout_logs', 'food_logs', 'biometrics', 'recipes_custom', 'activity_sessions',
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

export interface ExportBundle {
  app: 'Slim Chance';
  /** Bumped only if the SHAPE changes, so a future importer knows what it has. */
  formatVersion: 1;
  exportedAt: string;
  userId: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
  totalRows: number;
}

export function buildBundle(
  userId: string,
  tables: Record<string, unknown[]>,
  now: Date = new Date()
): ExportBundle {
  const counts: Record<string, number> = {};
  let totalRows = 0;
  for (const t of EXPORT_TABLES) {
    const rows = tables[t] ?? [];
    counts[t] = rows.length;
    totalRows += rows.length;
  }
  return {
    app: 'Slim Chance',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    userId,
    tables: Object.fromEntries(EXPORT_TABLES.map((t) => [t, tables[t] ?? []])),
    counts,
    totalRows,
  };
}

/**
 * RFC 4180 CSV. Quotes every field containing a comma, quote, or newline and
 * doubles embedded quotes — a food name with a comma in it ("Chicken, grilled")
 * would otherwise silently shift every later column by one, which is the kind of
 * corruption nobody notices until the data matters.
 */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  // Union of keys across all rows: a column absent from row 1 but present later
  // must still get a header, or its values land under the wrong heading.
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  const lines = [cols.map(csvCell).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n');
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `slim-chance-export-2026-08-11.json` — sortable, and says what it is at a glance. */
export function exportFilename(ext: 'json' | 'csv', now: Date = new Date(), table?: string): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return table ? `slim-chance-${table}-${d}.${ext}` : `slim-chance-export-${d}.${ext}`;
}

/** A short human summary of what just left the app — shown after an export so
 *  "it worked" is a number, not a hope. */
export function summariseBundle(b: ExportBundle): string {
  const notable = EXPORT_TABLES
    .filter((t) => b.counts[t] > 0)
    .sort((a, z) => b.counts[z] - b.counts[a])
    .slice(0, 3)
    .map((t) => `${b.counts[t]} ${t.replace(/_/g, ' ')}`);
  if (notable.length === 0) return 'Nothing to export yet — log something first.';
  return `${b.totalRows} rows — ${notable.join(', ')}${b.totalRows > 0 ? '…' : ''}`;
}
