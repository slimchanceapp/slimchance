// Per-entry food coaching.
//
// The Fuel page tracked numbers but never TALKED. After you log a meal the app
// knows exactly what you have left in the day's budget and whether protein is on
// track — so it should just tell you: what's spare, what to eat next, and (the
// question that actually matters) whether today's intake is why the scale isn't
// moving. This turns the running totals into one honest, actionable sentence.
//
// Pure + framework-free, so it's unit-tested in selfcheck.js.
import type { GoalDirection as Direction } from '../body/index.ts';

export type FoodTone = 'good' | 'ok' | 'warn' | 'bad' | 'na';
export type { Direction };

export interface FoodEvalInput {
  /** Today's share of the week's budget; null when no goal is set yet. */
  calorieTarget: number | null;
  /** Calories logged so far today. */
  kcalSoFar: number;
  /** ~1.8 g/kg goal-weight protein target. 0 when unknown. */
  proteinTarget: number;
  proteinSoFar: number;
  carbsSoFar?: number;
  fatSoFar?: number;
  /** Which way they're trying to move — changes whether "over budget" is bad. */
  direction: Direction;
  /** The rest of the week after today, so going past today's share can say
   *  what it costs instead of calling the day lost. */
  weekAfter?: { days: number; perDay: number } | null;
}

export interface FoodEval {
  tone: FoodTone;
  /** Short lead line, e.g. "312 kcal and 40 g protein to go". */
  headline: string;
  /** One actionable coaching sentence — what to actually eat/do next. */
  detail: string;
  spareKcal: number | null;
  spareProtein: number;
}

const round = (n: number) => Math.round(n);

/** Low-calorie, high-protein foods to reach for when protein is short but the
 *  calorie budget is nearly gone — the exact bind most cutters hit at night. */
const LEAN_PROTEIN = 'lean protein — 0% Greek yoghurt, a scoop of whey, egg whites, or a chicken breast';
/** When there's genuine room to eat, keep it protein-forward but real food. */
const BALANCED_PROTEIN = 'a protein-forward plate — chicken/fish/tofu/eggs with veg';

/**
 * Evaluate today's running totals against the plan and return one honest,
 * actionable verdict. The whole point is to speak in "eat this / stop here",
 * never to parrot a number the totals already show.
 */
export function evaluateFood(i: FoodEvalInput): FoodEval {
  const spareProtein = Math.max(0, round(i.proteinTarget - i.proteinSoFar));
  const proteinHit = i.proteinTarget > 0 && i.proteinSoFar >= i.proteinTarget - 5;

  // No calorie target yet → can only speak to protein.
  if (!i.calorieTarget || i.calorieTarget <= 0) {
    if (i.proteinTarget <= 0) {
      return {
        tone: 'na', spareKcal: null, spareProtein,
        headline: 'Set a goal to unlock targets',
        detail: 'Add your height, age and goal weight on Progress → Body & Goals and I can coach every entry.',
      };
    }
    return {
      tone: proteinHit ? 'good' : 'ok', spareKcal: null, spareProtein,
      headline: proteinHit ? 'Protein target hit 💪' : `${spareProtein} g protein to go`,
      detail: proteinHit
        ? 'Protein is locked in — the lever that decides whether a deficit costs fat or muscle.'
        : `Aim your next entry at ${LEAN_PROTEIN}.`,
    };
  }

  // No advice by the clock (breakfast, "late"): when someone eats is theirs
  // to decide. A fasting morning or a 21:00 shake is often the plan.
  const spareKcal = round(i.calorieTarget - i.kcalSoFar);

  // — Past today's share of the week. Only a question when they're trying to
  //   LOSE; a surplus is the plan when gaining. Never "the day is blown": that
  //   thought is what turns one big meal into a big weekend. The week absorbs
  //   it, and saying exactly how much it costs is what keeps the next meal sane.
  if (spareKcal < 0 && i.direction !== 'gain') {
    const over = -spareKcal;
    const w = i.weekAfter;
    const cost = w && w.days > 0
      ? `The week absorbs it: about ${w.perDay.toLocaleString()} a day for the next ${w.days} day${w.days === 1 ? '' : 's'}. No making up for it tonight.`
      : 'That’s the week. Monday starts clean — one big day is noise on the trend.';
    return {
      tone: 'warn', spareKcal, spareProtein,
      headline: `${over} kcal past today’s share`,
      detail: `${cost}${proteinHit ? '' : ` Still short on protein: if you eat, make it ${LEAN_PROTEIN}.`}`,
    };
  }

  // — Comfortably done — protein in, calories within ~100 of target.
  if (proteinHit && spareKcal <= 100) {
    return {
      tone: 'good', spareKcal, spareProtein,
      headline: 'Dialled in for today ✅',
      detail: `Protein target met and you’re on budget${spareKcal > 0 ? ` with ${spareKcal} kcal to spare` : ''}. Stop here — this is what a fat-loss day looks like.`,
    };
  }

  // — Protein short but the calorie budget is nearly gone: the classic bind.
  if (!proteinHit && spareProtein > 15 && spareKcal < proteinGapKcal(spareProtein)) {
    return {
      tone: 'warn', spareKcal, spareProtein,
      headline: `${spareProtein} g protein short, only ${Math.max(0, spareKcal)} kcal left`,
      detail: `Tight budget. Spend what’s left on ${LEAN_PROTEIN} — it buys the most protein per calorie.`,
    };
  }

  // — Room to eat well: real spare on both. Coach a protein-forward choice.
  if (spareKcal > 100) {
    const protLine = proteinHit
      ? `Protein’s handled, so these ${spareKcal} kcal are yours — carbs around training, healthy fats otherwise.`
      : `Put ${spareProtein} g of that toward protein: ${BALANCED_PROTEIN}.`;
    return {
      tone: 'ok', spareKcal, spareProtein,
      headline: `${spareKcal} kcal${spareProtein > 0 ? ` and ${spareProtein} g protein` : ''} to go`,
      detail: protLine,
    };
  }

  // — Fallback: on budget, protein a touch short.
  return {
    tone: 'ok', spareKcal, spareProtein,
    headline: spareProtein > 0 ? `${spareProtein} g protein to go` : 'On budget',
    detail: spareProtein > 0
      ? `Nearly there — one hit of ${LEAN_PROTEIN} closes the gap without blowing the calories.`
      : 'Balanced and on target. Keep the portions steady.',
  };
}

/** Rough calories a lean-protein serving costs to close a protein gap (~5 kcal
 *  per gram via lean sources), used to decide if the budget can even fit it. */
function proteinGapKcal(gap: number): number {
  return gap * 5;
}

