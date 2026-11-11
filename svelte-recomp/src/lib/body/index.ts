// Body's door (book chapter 5, decision 0006): weigh-ins, the trend under
// them, the chance it's really going the goal's way, the path, the ceiling and
// the stops on the way. The rest of the app reads Body only through these
// names, and saves a weigh-in only through ./weighIn.ts (saveWeighIn); a check
// fails if a file outside src/lib/body reaches past either, or if Body reaches
// into another area. Pure: everything here is data in, data out.
export { fitWeightLine, weightVerdict, chanceOf, paceVsPlan, diagnoseStall, goalDirection, WINDOW_DAYS, CAREFUL_CARRY } from './insights.ts';
export type { WeighIn, WeightVerdict, Pace, StallDiagnosis, GoalDirection } from './insights.ts';
export { oddsOf, pulse } from './pulse.ts';
export type { Odds, KeepInput, Pulse } from './pulse.ts';
export { suggestLine, LINE_MARGIN_KG, lineState } from './line.ts';
export type { LineState } from './line.ts';
export { slimTrack } from './slimTrack.ts';
export { nextMilestone, suggestStops, milestoneState, HELD_DAYS, heldUnder } from './milestone.ts';
export type { MilestoneSetting, MilestoneState } from './milestone.ts';
export { OFF_TREND_KG, offTrend, morningsThisWeek } from './scale.ts';
export { explainUp } from './scaleUp.ts';
export type { UpExplained } from './scaleUp.ts';
export { appleParsed, appleRecords, guessUnit, parseWeightFile, readingsFrom } from './importWeights.ts';
export type { ParsedFile, RawReading } from './importWeights.ts';
