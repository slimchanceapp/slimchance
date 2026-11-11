// Training's door (book chapter 5, decision 0006): sessions, lifts and their
// progress, plates, the exercise library and plan defaults, watch workouts
// and the one definition of a trained day. The rest of the app reads Training
// only through these names and logs an activity only through ./logActivity.ts;
// a check fails if a file outside src/lib/training reaches past them, or if
// Training reaches into another area. Pure: data in, data out.
export { PLAN_TEMPLATES, buildSchedule, describeSchedule } from './data/planTemplates.ts';
export { DEFAULT_SESSIONS } from './data/workoutPlanDefaults.ts';
export type { PlanDay, PlanExercise, PlanSession } from './data/workoutPlanDefaults.ts';
export { buildGroups } from './data/workouts.ts';
export { EXERCISE_TYPES, buildActivitySessions, isSameSessionAsLogged, primaryActivity, sessionMuscleLoad, trainedDates } from './exercise.ts';
export { liftStalls } from './liftStalls.ts';
export { muscleVolume } from './muscleVolume.ts';
export { inferEquipment, nextGymWeight, roundToGymWeight } from './nextWeight.ts';
export { DEFAULT_BAR_KG, DEFAULT_PLATES_KG, calculatePlates, warmupLadder } from './plates.ts';
export { strengthTrend } from './strength.ts';
export type { StrengthLog, StrengthSet, StrengthTrend } from './strength.ts';
export { checkTrainPlan, sessionsLeft, trainingTone } from './trainPlan.ts';
export type { CheckedTrainPlan, TrainDay } from './trainPlan.ts';
export { trainingHeatmap } from './trainingHeatmap.ts';
