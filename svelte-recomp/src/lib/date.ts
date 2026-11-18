// Local-calendar date helpers.
//
// THE BUG THIS FIXES: the app used `new Date().toISOString().slice(0, 10)` in
// fifteen places to mean "today". That is the UTC date, not the local one — so
// anywhere east of Greenwich, every log written between local midnight and the
// UTC offset (05:30 in India, 01:00 in British summer time) was filed under
// YESTERDAY. Meanwhile the Health Connect sync always wrote the LOCAL date, so
// the watch's steps and the morning's food landed on different rows: today's
// calories looked empty, yesterday's looked double, and the adaptive-TDEE
// window fitted intake against weights that were off by a day.
//
// Every "what day is it" question in the app goes through here now, so the
// answer is the same everywhere.

/** YYYY-MM-DD for a date, in the device's own timezone. */
export function ymd(d: Date | string | number = new Date()): string {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** Today's local calendar date as YYYY-MM-DD. */
export function todayYmd(): string {
  return ymd(new Date());
}

/** Local date N days from now (negative = in the past), as YYYY-MM-DD. */
export function shiftYmd(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return ymd(d);
}

/** "2026-11-04" -> "4 Nov", with the year only when it isn't this one. */
export function dayLabel(ymdStr: string): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  if (!y || !m || !d) return ymdStr;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

/** The Monday of the week containing `d` (weeks start Monday), as YYYY-MM-DD. */
export function mondayOf(d: Date = new Date()): string {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Sunday belongs to the week that just ended
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return ymd(monday);
}
