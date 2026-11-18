// Bringing someone else in — the one thing this app has never allowed.
//
// RecompOS is entirely single-player. There is no partner view, no coach, no way
// to tell anyone how the week went short of a screenshot. That matters because
// accountability is one of the few interventions with real evidence behind it,
// and because the person doing this is usually not doing it in isolation.
//
// What this does NOT do is build a sharing PLATFORM. No new table, no share
// links, no cross-account reads, no relaxing of the row-level security that was
// audited watertight — punching a hole in that to send someone a weight number
// would be a terrible trade. It formats the week as plain text and hands it to
// the OS share sheet, so the user picks the recipient and the app never learns
// who it was. Nothing leaves the device unless a human taps send.

import type { WeeklyReview } from './weeklyReview.ts';
import { dwt } from './units.ts';
import { dayLabel } from './date.ts';

export interface ShareOptions {
  /** Include the raw bodyweight. Off by default — a weight is the single most
   *  sensitive number here, and progress reads fine as a delta. */
  includeWeight?: boolean;
  /** What to call the sender; omitted entirely when blank. */
  name?: string | null;
}

/**
 * The week as something a human would actually send a friend. Only lines the
 * data supports: a section with nothing behind it is left out rather than
 * padded with "no data", because a summary full of blanks reads as failure
 * even in a week that went fine.
 */
export function weeklySummaryText(review: WeeklyReview, opts: ShareOptions = {}): string {
  const lines: string[] = [];
  const who = opts.name?.trim() ? `${opts.name.trim()}'s week` : 'My week';
  lines.push(`${who} · ${dayLabel(review.weekStart)}–${dayLabel(review.weekEnd)}`);
  lines.push('');

  if (review.weightChangeKg != null) {
    const kg = dwt(review.weightChangeKg);
    lines.push(
      review.weightChangeKg < -0.05 ? `⬇ Down ${kg}`
      : review.weightChangeKg > 0.05 ? `⬆ Up ${kg}`
      : '➡ Weight held steady'
    );
  }
  if (review.sessions > 0) {
    lines.push(`🏋 ${review.sessions} session${review.sessions === 1 ? '' : 's'}${review.tonnageKg > 0 ? ` · ${review.tonnageKg.toLocaleString()} kg moved` : ''}`);
  }
  if (review.avgProtein != null) {
    lines.push(`🍗 ${Math.round(review.avgProtein)} g protein/day${review.proteinDaysMet > 0 ? ` · target hit ${review.proteinDaysMet}/${review.proteinDaysLogged} days` : ''}`);
  }
  if (review.avgSteps != null) lines.push(`👟 ${review.avgSteps.toLocaleString()} steps/day`);
  if (review.avgSleep != null) lines.push(`😴 ${review.avgSleep} h sleep/day`);

  if (opts.includeWeight === true && review.avgIntake != null) {
    lines.push(`🔥 ${Math.round(review.avgIntake)} kcal/day average`);
  }

  if (review.wins.length > 0) {
    lines.push('');
    lines.push(`✅ ${review.wins[0]}`);
  }
  if (review.adjustments.length > 0) {
    lines.push(`🎯 Next week: ${review.adjustments[0]}`);
  }

  lines.push('');
  lines.push('via Slim Chance');
  // A thin week would otherwise stack the section blanks into a gap that reads
  // as something missing rather than something absent.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Weight is deliberately opt-in, so the guard is worth asserting rather than
 * trusting: nothing in the default output should contain a bodyweight.
 */
export function summaryLeaksWeight(text: string, bodyweightKg: number | null): boolean {
  if (bodyweightKg == null) return false;
  // Match the number as a standalone token so a coincidental "90 g protein"
  // isn't flagged, but a real "90.4 kg" is.
  const whole = String(Math.round(bodyweightKg));
  return new RegExp(`\\b${whole}(\\.\\d+)?\\s*kg\\b`).test(text);
}

/** Format the week, hand it to the OS share sheet, and resolve to the one line
 *  to show the user about where it went. */
export async function shareWeek(review: WeeklyReview, opts: ShareOptions = {}): Promise<string> {
  const { deliverText, deliveryMessage } = await import('./shareFile.ts');
  return deliveryMessage(await deliverText('My week — Slim Chance', weeklySummaryText(review, opts)), 'Summary');
}
