# 1. How it fits together

## The picture in one paragraph

Slim Chance is one web app that runs everywhere. It is written in Svelte 5 and
SvelteKit, built into static files, and served by Vercel. On a phone it runs
inside a thin native shell (Capacitor) that loads the live website, so a web
deploy updates every installed app at once; only native code (notifications,
Health Connect, the icon) needs a new phone build. Data lives twice: in a
local database on the device (IndexedDB, through Dexie), so the app works
offline and feels instant, and in Postgres on Supabase, which is the record.
A few things run on the server as edge functions (Deno): the AI coach, the
food estimate, the health digest, account deletion.

## The layers, and the rule between them

| Layer | Where | Its one job |
|---|---|---|
| Screens | `src/routes/*/+page.svelte`, `src/lib/components/` | Show things and take taps. No maths. |
| Stores | `src/lib/stores/` | Fetch and combine: live database queries, the derived numbers every screen shares. |
| Logic | `src/lib/*.ts` (pure modules) | Decide. Takes plain data in, gives plain data out, never touches the network or the screen. |
| Local database | Dexie (IndexedDB), `src/lib/db/` | The device's copy, offline-first. |
| Sync | `src/lib/stores/sync.ts` | Moves rows between the device and Postgres; one request for rows that belong together. |
| Server | `supabase/` (migrations, edge functions) | The record, row-level security, and anything that needs a secret (AI keys). |
| Phone shells | `android/`, `ios/` | Notifications, Health Connect / Apple Health, the number-pad weigh-in. |

The rule: **logic is pure**. Because `src/lib/insights.ts` (the trend and the
chance) only takes numbers and returns numbers, the test suite can run 9,000
simulated people through it in seconds. This pattern has a name: *functional
core, imperative shell*.

## One weigh-in, end to end

1. You type 92.3 in the card on Today (`WeightInput.svelte`).
2. `saveWeighIn` (`src/lib/weighIn.ts`) is the only way a weigh-in is saved.
   It asks before saving a reading far from your trend (a typo guard).
3. `upsertRecord` writes it to the device database and to Postgres. Postgres
   checks row-level security: you can only write rows with your own user id.
4. The device database tells everyone listening (`liveWeights()`), and
   `stores/body.ts` recomputes: the trend, the chance, the budget. This file
   is the **one source of truth**: no screen fits its own trend.
5. `weightVerdict` and `chanceOf` (`src/lib/insights.ts`) turn your mornings
   into a rate and a chance; `pulse.ts` turns those into words and a colour.
6. Today's card redraws: the number rolls up, the coins flip in.
7. `stores/moments.ts` rewrites tomorrow's morning note and tonight's
   evening note, and hands them to the phone (`MomentReceiver.java`), which
   shows each at your first unlock in its window.

## The practices, and why each exists

- **One source of truth.** Every concept is worked out in one place; a check
  fails if a screen goes around it. When two screens each decided "did they
  train?", one was wrong (October 2026).
- **A regression baseline.** Every promise is a named check in
  `scripts/selfcheck.js`; the list of names (`baseline.txt`) only grows, and
  a check that stops running fails the suite. Every bug becomes a check first.
- **A ship gate.** `npm run ship` refuses unsaved work, runs everything,
  deploys with the commit as the version, checks the live site, and rolls
  back by itself if that check fails. This is continuous delivery.
- **Watching the live app.** A live check every three hours, a daily health
  digest (totals only), a nightly test of both phones, all on GitHub.
- **Least privilege.** Keys live outside the repo; database tools are
  read-only; changes go through migrations.
- **Never trust the AI's output.** The coach's text and meal plans are
  checked by the app before anyone sees them: no number it wasn't given, no
  plan under the safe floor.
- **Honest numbers, tested like code.** The chance is checked for
  calibration against simulated people with a known truth.
- **Decisions written down** (`docs/decisions/`), so a choice is questioned
  once, deliberately.

## What is weak, honestly

- Many checks read the source code's text instead of testing behaviour, so
  they break when wording moves and can miss real bugs.
- Everything sits in one big `src/lib`; areas reach into each other. Lesson 3
  (domain-driven design) is the cure.
- Some notifications are written ahead of time on the phone and can go stale
  when data changes elsewhere.

## The bug lesson: check at the moment of use

On 10 November the evening note said "workout at 5.30pm" at 7.30pm, and
"protein to go" after protein was hit. The coach wrote its text in the
afternoon; the phone showed it in the evening. Between the moment something
is checked and the moment it is used, the world can change. Security people
call this *time-of-check to time-of-use* (TOCTOU). The cure is always the
same: re-check at the moment of use, or only say things that stay true until
then. The fix did both: times that will have passed are refused, and a note
written for a day that has since changed steps aside.
