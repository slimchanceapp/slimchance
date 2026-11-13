// Metrics' door (book chapter 5, decision 0006): are we helping? The "is it
// for you?" question and what it asks. Events are counted only through
// ./events.ts (note_event: one row per person, event and day, no trackers);
// a check fails if a file outside src/lib/metrics reaches past either. Pure.
export { FIT_ANSWERS, FIT_REASONS, fitAskDue } from './fit.ts';
export { isAutomated } from './automated.ts';
