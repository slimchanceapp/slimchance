# Slim Chance

**Better odds than the name suggests.**

Slim Chance is a calm weight-loss app for people doing it on their own. It measures you
against yourself: a trend instead of the daily scale, a week of food instead of a
perfect day, and a plan for the moments that undo most diets (the evening, the
Friday, the weekend), handed to you when you pick up your phone rather than on a
clock. No streaks, no guilt, no red.

The name is the joke; the odds are real. A coin landing on its edge is the textbook slim
chance (it's the mark), and every morning the app tells you yours: the odds in ten that
your weight is really coming off. It was called Moderly until 30 October 2026.

**Get it:** Slim Chance is an iPhone and Android app, on its way to the App Store
and Google Play. Until then, open [slimchance.app](https://slimchance.app) to start,
or install the Android app from
[Releases](https://github.com/slimchanceapp/slimchance/releases/tag/recompos-app-latest). No account needed to start. **How it works:**
[slimchance.app/about](https://slimchance.app/about/).

<p>
<img src="https://slimchance.app/about/today.webp" alt="Today: the weight trend, and ten coins for the odds it's coming off" width="250">
<img src="https://slimchance.app/about/scale-up.webp" alt="When the scale jumps, Slim Chance explains why from your own data" width="300">
<img src="https://slimchance.app/about/keep-hero.webp" alt="Keep-it-off mode: days inside your range" width="300">
</p>

Made-up data. More at [slimchance.app/about](https://slimchance.app/about/).

## What it does

- **Your trend, not today's number.** One line through your morning weigh-ins, with how
  sure it is, as odds in ten. Set a next stop and the app says what it means, for example leaving a
  BMI band, and only calls it reached when the trend stays there.
- **A week of food, learned from your own log.** Log the way you do; rough is fine. The
  week's budget comes from your log and your scale together, so whatever the log
  leaves out (oil, a handful of nuts) cancels out. Search, barcodes, or a photo with
  an AI estimate.
- **Keep it off.** At the goal, Slim Chance asks to keep it there or aim lower. Keeping
  it, the budget is your maintenance, a ceiling sits a kilo above, and Today counts
  the days the trend stayed inside that range (a rate, never a streak). Over the
  ceiling, your own plan comes back with one gentle step down.
- **When the scale jumps, it says why**, from your own log: a bigger day, the
  weekend, a first workout after a break, or nothing it can see.
- **Period-aware weight, if you want it:** mark the first day of each period; after
  three cycles Slim Chance learns your own water swing and explains those mornings.
- **Plans for the hard moments.** Write what you'll do on a Friday night or a late
  evening; the evening notification hands it back at that moment, with a line from
  Epictetus or Marcus Aurelius.
- **A morning briefing at your first unlock.** The weather where you are, the day's
  session and food, and buttons to log your weight from the notification (Android).
- **Training that respects your body.** Your own weekly plan, or a guided six-week
  return after a back injury, paced by how it feels each morning.
- **Health Connect** on Android: steps, sleep and workouts from your watch.
- **For anyone:** start without an account and save it later; kilograms, pounds or
  stone; a walking week if you don't go to a gym. For adults (18+).
- **Bring your history:** import weigh-ins from Apple Health, Libra, Happy Scale,
  MyFitnessPal, Withings, Fitbit, Google Fit, Samsung Health or any CSV, so the trend
  starts on day one. Read on the device; one reading a day; undoable.

## Use it from an AI assistant

Slim Chance is also an MCP server, free and without an account: `https://slimchance.app/mcp`
(Streamable HTTP). Add it wherever your assistant takes MCP servers or custom connectors, or in
Gemini CLI: `gemini extensions install https://github.com/slimchanceapp/slimchance`. Then paste
dated morning weights and ask whether the weight is really moving; the assistant answers in your
language.

- `slim_chance`: the trend, the rate per week with its 95% range, and the chance in 10 that the
  weight is really moving the way you want. Needs 7 readings in 5 weeks.
- `body_signals`: resting heart rate, steps, sleep and HRV, each with its own trend and what it
  means beside the scale.

Nothing sent to the tools is stored; calls are counted per day by tool, assistant name and country.

## Principles

- Measured against yourself, never against an average person's day.
- Honest numbers: a trend with its uncertainty; nothing invented.
- Quiet by default: a notification only when it is true and useful; never an alarm.
- No streaks to lose, and never red for a bad week.
- Your data is yours.

## Privacy

- Your data lives in a Supabase (Postgres) database. Row-level security means each
  account can read and change only its own rows.
- No ads, no third-party trackers, no data sold.
- AI is used only when you ask for it (an estimate from a photo or a description, a
  recipe). It goes to Google Gemini; words (never photos) may go to free fallback
  providers when Gemini is busy. Body-fat estimates from photos stay off until the
  key is on Gemini's paid tier (set the `GEMINI_TIER=paid` secret), because on the
  free tier Google may read what is sent.
- Trials (no email yet) unused for 30 days are deleted, nightly.
- Export everything at any time: Settings → Export my data.

## Run your own

Slim Chance is a SvelteKit (Svelte 5) app with a Supabase backend, shipped to Android as a
thin Capacitor shell that loads the web app.

You need Node 24 or newer, a [Supabase](https://supabase.com) project and the Supabase
CLI.

1. `git clone https://github.com/slimchanceapp/slimchance && cd slimchance/svelte-recomp && npm install`
2. Copy `.env.example` to `.env` and fill in your project's URL and publishable key.
3. Apply the SQL files in `supabase/migrations/` to your project, in order.
4. Deploy the edge functions in `supabase/functions/`. Optional secrets:
   `GEMINI_API_KEY` (the free fallbacks work without it), and for web push
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
5. `npm run dev`. Before any commit, run `npm run verify`: the self-check suite, the
   type check and the build.

Setting up from scratch hasn't been tested end to end yet. If a step fails, please
open an issue.

## Repository

- `svelte-recomp/` is the app (the folder keeps the project's first name). Most of the
  logic in `src/lib` is pure and tested by `scripts/selfcheck.js`.
- `supabase/` holds the migrations and the edge functions.
- `svelte-recomp/android/` is the Capacitor Android shell and its native plugins.

## License

[AGPL-3.0](LICENSE). You can use, study, change and share Slim Chance; if you run a changed
version for other people, share your changes too. The fonts are under the SIL Open
Font License (`svelte-recomp/static/fonts/OFL.txt`); the exercise photos come from
free-exercise-db (public domain).
