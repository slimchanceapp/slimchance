// Health signals' door (book chapter 5, decision 0006): sleep, resting heart
// rate, HRV and steps, each read against the person's own normal; the morning
// read; "getting fitter?"; sleep against training. The rest of the app reads
// it through these names, and reaches Health Connect only through
// ./healthConnect.ts, ./writeBack.ts and ./watches.ts; a check fails if a file
// outside src/lib/health reaches past them. Pure: data in, data out.
export { fitness } from './fitness.ts';
export type { Fitness } from './fitness.ts';
export { readyToday } from './readiness.ts';
export { signalTrend, together, watchAgreement } from './signals.ts';
export type { SignalKind, SignalTrend } from './signals.ts';
export { sleepPerformance } from './sleepPerformance.ts';
