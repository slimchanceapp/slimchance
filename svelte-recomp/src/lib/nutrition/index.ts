// Nutrition's door (book chapter 5, decision 0006): food, the week's budget,
// the learned burn, meal plans and the patterns in a food log. The rest of the
// app reads Nutrition only through these names, saves food only through
// ./foodLog.ts and looks foods up only through ./foodSources.ts; a check fails
// if a file outside src/lib/nutrition reaches past them, or if Nutrition reaches
// into any area but Body's door. Pure: everything here is data in, data out.
export { cleanName, estimateLocally, historyFoods, scale, searchLocal, sourceOf, sum, times, validGtin } from './food.ts';
export type { Candidate, Macros, NewFood } from './food.ts';
export { weekBudget, weekShape } from './week.ts';
export type { WeekBudget, WeekShape } from './week.ts';
export { weeklyMaintenance } from './adaptiveTdee.ts';
export type { AdaptiveTdee } from './adaptiveTdee.ts';
export { ACTIVITY_LABELS, CUT_FLOOR, burnFloor, calcTdee, projectGoal, projectGoalWithTdee, projectionSummary, resolveCalorieTarget } from './tdee.ts';
export type { ActivityLevel, LiveTargetResult } from './tdee.ts';
export { checkPlan, mealAsFoods, planDayKcal, planFoods, todaysMeals, usualFoods } from './mealPlan.ts';
export type { CheckedPlan, PlanMeal } from './mealPlan.ts';
export { nutritionPatterns, proteinByTrainingDay } from './nutritionPatterns.ts';
export { evaluateFood } from './foodCoach.ts';
export { frequentFoods, groupIntoMeals, notYetLogged, proteinFillers, repeatDay, usualBreakfast, usualMeals } from './quickAdd.ts';
export type { QuickFood } from './quickAdd.ts';
export { parseCalorieTarget, waterTargetLitres } from './tdee.ts';
