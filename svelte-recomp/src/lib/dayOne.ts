// DAY ONE — what the app can honestly say before it has any data.
//
// The Pulse orb is the face of RecompOS, and on a brand-new account it rendered
// "—" at 0% fill with "-- kg lost" underneath. With no weigh-ins there is no
// trend to show (and the app will not invent one), but that left the
// single most prominent element in the app blank at the exact moment a new user
// decides whether to come back. Seven of the eight accounts that ever wrote a
// row wrote between one and four and never returned.
//
// The fix is not to fake the score. It is to answer a DIFFERENT question — one
// that IS fully answerable from what onboarding already collected: not "how is
// the recomp going" (unknowable on day one) but "what is the plan, and what do
// I do first". Height, age, sex, activity and goal give a real calorie target,
// a real protein target and a real date, with no logs at all.
//
// Once the steps are done, or the scale has drawn a trend, this disappears and
// the trend takes over — see TodayPulse.svelte.

// Explicit .ts extensions: scripts/selfcheck.js imports this module directly under
// node's type-stripping, which does not resolve extensionless specifiers. tsconfig
// sets rewriteRelativeImportExtensions, so the build rewrites these normally.
import { projectGoal, type ActivityLevel } from './nutrition/index.ts';
import { ageFrom, type Profile } from './profile.ts';
import { shiftYmd } from './date.ts';
import { dwt } from './units.ts';

/** Protein per kg of GOAL bodyweight — the muscle-retention lever in a deficit. */
const PROTEIN_G_PER_KG = 1.8;

export interface FirstStep {
  key: 'weigh' | 'food' | 'plan' | 'train';
  label: string;
  hint: string;
  href: string;
  done: boolean;
}

export interface DayOnePlan {
  targetKcal: number;
  proteinG: number;
  maintenanceKcal: number;
  /** Which way the weight has to move — the plan reads completely differently
   *  for someone rebuilding after illness than for someone cutting. */
  direction: 'lose' | 'gain' | 'maintain';
  kgToChange: number;
  weeksToGoal: number;
  /** YYYY-MM-DD the projection lands on, so the goal is a date and not a vibe. */
  goalDate: string;
  goalKg: number;
  perWeekKg: number;
  headline: string;
  steps: FirstStep[];
  stepsDone: number;
}

export interface DayOneInput {
  profile: Partial<Profile> | null | undefined;
  currentWeightKg: number | null;
  weighInCount: number;
  foodLogCount: number;
  workoutLogCount: number;
  /** Days in the saved week: a chosen week, even a walking one, ticks the step. */
  scheduleDays?: number;
  /** Plans written for the hard moments (user_settings.plans). */
  planCount?: number;
  now?: Date;
}

/**
 * The plan, or null when the profile can't support one (onboarding incomplete).
 * Never throws and never guesses a missing field — a partial profile returns
 * null rather than a projection built on an assumed height.
 */
export function dayOnePlan(input: DayOneInput): DayOnePlan | null {
  const p = input.profile;
  const now = input.now ?? new Date();
  const age = ageFrom(p?.birth_year, now);
  const heightCm = p?.height_cm ?? null;
  const sex = p?.sex ?? null;
  const goalKg = p?.goal_kg ?? null;
  // Fall back to the profile's start weight when they haven't weighed in yet:
  // onboarding asks for a weight, so this is a real number, not an assumption.
  const weightKg = input.currentWeightKg ?? p?.start_kg ?? null;

  if (!age || !heightCm || (sex !== 'male' && sex !== 'female') || !goalKg || !weightKg) return null;
  if (heightCm < 100 || heightCm > 250 || weightKg <= 0 || goalKg <= 0) return null;

  const activity = (p?.activity_level ?? 'moderate') as ActivityLevel;
  const proj = projectGoal({ weightKg, heightCm, age, gender: sex, activityLevel: activity }, goalKg);

  const perWeekKg = proj.weeksToGoal > 0 ? proj.kgToChange / proj.weeksToGoal : 0;
  const goalDate = shiftYmd(proj.weeksToGoal * 7, now);

  // The first week asks for what keeps people, in the order it pays off. Of
  // the accounts that ever logged anything, seven in eight left after one to
  // four food entries: a full day of food was the second thing asked, and the
  // last thing most people did. So food is one meal, roughly, and the habit
  // the whole app stands on (the scale) and the plan for the hard moment come
  // first. "Connect your watch" left the list: without a watch it could never
  // be ticked, and an unfinishable step is a small reproach every morning.
  const steps: FirstStep[] = [
    {
      key: 'weigh', label: 'Weigh in on three mornings', href: '/',
      hint: 'Same time, before food or drink. One morning is noise; a week of them makes the trend.',
      done: input.weighInCount >= 3,
    },
    {
      key: 'plan', label: 'Write one plan for your hardest moment', href: '/',
      hint: 'The weekend, a Friday night, late evenings: decide now what you’ll do then.',
      done: (input.planCount ?? 0) > 0,
    },
    {
      key: 'food', label: 'Log one meal — rough is fine', href: '/recipes',
      hint: 'Guess the portion or snap a photo. The app learns from how you log, not from perfect logs.',
      done: input.foodLogCount > 0,
    },
    {
      key: 'train', label: 'Choose how you move', href: '/workouts',
      hint: proj.direction === 'gain'
        ? 'Lifting is what turns the extra calories into muscle instead of fat.'
        : 'A walk a day counts. Lifting twice a week keeps the muscle while the fat goes.',
      done: input.workoutLogCount > 0 || (input.scheduleDays ?? 0) > 0,
    },
  ];

  const stepsDone = steps.filter((s) => s.done).length;

  const weeksPhrase = `${proj.weeksToGoal} week${proj.weeksToGoal === 1 ? '' : 's'}`;
  const headline =
    proj.direction === 'maintain'
      ? `You're at your goal weight. Hold ${Math.round(proj.tdee)} kcal a day and keep the lifts heavy.`
      : proj.direction === 'gain'
        // Never "kg to go" without saying which way — the same sentence read as
        // a cut to someone who had been told to put weight back on.
        ? `${dwt(proj.kgToChange)} to gain. At ${dwt(perWeekKg)} a week that's about ${weeksPhrase}.`
        : `${dwt(proj.kgToChange)} to lose. At ${dwt(perWeekKg)} a week that's about ${weeksPhrase}.`;

  return {
    targetKcal: proj.targetIntakeKcal,
    proteinG: Math.round(goalKg * PROTEIN_G_PER_KG),
    maintenanceKcal: proj.tdee,
    direction: proj.direction,
    kgToChange: proj.kgToChange,
    weeksToGoal: proj.weeksToGoal,
    goalDate,
    goalKg,
    perWeekKg,
    headline,
    steps,
    stepsDone,
  };
}

function fmtKg(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}

/** "2026-11-04" -> "4 Nov". A date makes a goal real in a way "12 weeks" never does. */
export function goalDateLabel(ymdStr: string): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  if (!y || !m || !d) return ymdStr;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}
