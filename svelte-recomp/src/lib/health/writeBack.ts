// THE WATCH STOPS BEING A ONE-WAY STREET.
//
// Health Connect has always fed this app: steps, sleep, heart rate, watch-logged
// workouts. Nothing ever went the other way. A session you logged by hand here —
// the whole point of the "watch missed one" flow — existed in RecompOS and
// nowhere else, so your own workout history disagreed with itself depending on
// which app you opened. Same for a weigh-in typed into Progress.
//
// This writes those two things back, and only those two: things the user
// explicitly entered, that no sensor produced. Nothing derived, nothing
// estimated — publishing a computed number into the platform record would
// pollute every other app that reads it.
//
// SAFETY: the plugin's insertRecords() runs in an UNGUARDED Kotlin coroutine,
// exactly like readRecords(). Writing a type whose permission was refused throws
// a SecurityException that escapes the coroutine and HARD-CRASHES the app rather
// than rejecting the promise. Every write here is gated on canWrite() first.

import { canWrite } from './permissions.ts';
import { isAndroidApp, hasPlugin } from '../platform.ts';

/** What the app knows about a session the user logged by hand. */
export interface LoggedSession {
  /** Local start time. */
  start: Date;
  end: Date;
  title: string;
  notes?: string;
  /**
   * Health Connect exercise-type code. 0 = OTHER_WORKOUT, which is what a real
   * watch reports for a gym session ("Overall fitness") — see the duplicate-
   * session guard in health/exercise.ts.
   */
  exerciseType: number;
}

export interface WriteResult {
  written: number;
  skipped: string[];
  error?: string;
}

/** Health Connect rejects a session with no duration, so give a hand-logged one
 *  a plausible length rather than a zero-width instant it will refuse. */
export const DEFAULT_SESSION_MINUTES = 45;

/**
 * Build the records to insert. Pure, so the shape — especially the zero-length
 * and ordering rules that Health Connect silently rejects on — is testable
 * without a device.
 */
export function buildRecords(
  sessions: LoggedSession[],
  weights: Array<{ time: Date; kg: number }>,
  granted: Set<string> | string[]
): { records: any[]; skipped: string[] } {
  const skipped: string[] = [];
  const records: any[] = [];

  if (sessions.length > 0) {
    if (!canWrite('ExerciseSession', granted)) {
      skipped.push('workouts (permission not granted)');
    } else {
      for (const s of sessions) {
        let end = s.end;
        // A session that ends at or before it starts is rejected outright, and a
        // hand-logged one often carries only a date.
        if (!(end instanceof Date) || !Number.isFinite(end.getTime()) || end.getTime() <= s.start.getTime()) {
          end = new Date(s.start.getTime() + DEFAULT_SESSION_MINUTES * 60_000);
        }
        records.push({
          type: 'ExerciseSession',
          startTime: s.start,
          endTime: end,
          title: s.title,
          notes: s.notes || 'Logged in Slim Chance',
          exerciseType: s.exerciseType,
        });
      }
    }
  }

  if (weights.length > 0) {
    if (!canWrite('Weight', granted)) {
      skipped.push('weigh-ins (permission not granted)');
    } else {
      for (const w of weights) {
        // A weight of zero or a negative is a parse failure upstream, not data.
        if (!(w.kg > 0) || !Number.isFinite(w.kg)) continue;
        records.push({ type: 'Weight', time: w.time, weight: { unit: 'kilogram', value: w.kg } });
      }
    }
  }

  return { records, skipped };
}

/**
 * Write hand-logged sessions and weigh-ins back to Health Connect.
 *
 * Never throws: a health-data write failing must not take down the save the user
 * actually asked for. Returns what happened so the caller can say so.
 */
export async function writeBackToHealth(
  sessions: LoggedSession[],
  weights: Array<{ time: Date; kg: number }>
): Promise<WriteResult> {
  try {
    if (!isAndroidApp()) return { written: 0, skipped: ['not the Android app'] };
    if (!hasPlugin('HealthConnect')) return { written: 0, skipped: ['no Health Connect on this phone'] };

    const { HealthConnect } = await import('@kiwi-health/capacitor-health-connect');
    const { availability } = await HealthConnect.checkAvailability();
    if (availability !== 'Available') return { written: 0, skipped: [`Health Connect ${availability}`] };

    const { WRITE_TYPES, READ_TYPES } = await import('./permissions.ts');
    const check = await HealthConnect.checkHealthPermissions({ read: READ_TYPES, write: WRITE_TYPES });
    const granted = new Set<string>(check.grantedPermissions || []);

    const { records, skipped } = buildRecords(sessions, weights, granted);
    if (records.length === 0) return { written: 0, skipped };

    await HealthConnect.insertRecords({ records });
    return { written: records.length, skipped };
  } catch (e: any) {
    console.warn('[HealthConnect] write-back failed:', e);
    return { written: 0, skipped: [], error: (e?.message || String(e)).slice(0, 160) };
  }
}
