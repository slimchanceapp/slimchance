// Coach's door (book chapter 5, decision 0006): the AI's words and the checks
// that decide whether a word of them is shown (the evening note, Ask about your
// numbers, Talk to your coach). Builds only on Moments. Pure: data in, data out.
export { buildFacts, checkReply, eveningFrom, factsDigest } from './brain.ts';
export type { BrainReply } from './brain.ts';
export { checkAnswer } from './ask.ts';
export type { AskChecked, AskSource } from './ask.ts';
export { checkActions, describe, dayIndex, DAY_NAMES } from './chat.ts';
export type { CoachAction, ChatWeek } from './chat.ts';
