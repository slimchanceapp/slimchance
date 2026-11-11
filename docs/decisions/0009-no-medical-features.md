# 0009: Slim Chance has no medical features

**Date:** 2026-11-11. **Follows:** [0003](0003-mission-and-who-first.md) (what
Slim Chance is for).

## Decision
- **Slim Chance is a health and fitness app, not a medical one.** It tracks
  activity, food and weight, period-aware weight and sleep. It does not manage
  medication and does not run injury rehabilitation.
- **The GLP-1 companion left the app** (the screen, the Today row, the
  Settings link and its logic). Its empty tables stay in the database for the
  separate medication app the platform direction already planned.
- **The Back Rebuild offer and its cards left the app**, so no new program
  can start. Its program logic is inert and will be retired with its readers.
- **The Google Play declaration says health and fitness only**, and a check
  fails if a medication log or a rehab offer comes back.

## Why
- Google Play rejected the first closed-test submission: medical features
  (medication and treatment management, physical therapy and rehabilitation)
  may only be published by an organization account, and ours is personal.
  The declaration was accurate, so the fix had to be in the app, not the form.
- Nobody was using either: no one had ever logged a medication, and no
  program was running (the owner's back has been fine since 3 Nov).
- Both pulled away from what the app is for: people losing weight on their
  own, calmly. A medication log is the medication app's job.

## What would change it
An organization developer account (a legal entity with a D-U-N-S number), and
a medical feature people actually ask for.
