# Slim Chance: the book

How a real app is built with AI help, and the engineering that keeps it
honest, written from this codebase rather than from a textbook. One page:
new chapters are added here, and older ones are corrected in place when the
app changes. Ask about anything that doesn't make sense; the answer goes back
into the page.

## Contents

1. [How it fits together](#chapter-1-how-it-fits-together): the layers, one weigh-in end to end, the practices, and the first bug lesson.
2. [Design: a system, not a mood](#chapter-2-design-a-system-not-a-mood): tokens, two themes, the coin rule, and how we choose.
3. [MCP: Slim Chance inside any assistant](#chapter-3-mcp-slim-chance-inside-any-assistant): the protocol, one conversation end to end, and the server we built.
4. [Evals: how we found out our chance was overconfident](#chapter-4-evals-how-we-found-out-our-chance-was-overconfident): measuring an AI and our own maths against a known truth.
5. [Domain-driven design: areas that can't break each other](#chapter-5-domain-driven-design-areas-that-cant-break-each-other): the app's own language, its map, the pure core a check now guards, and Body, the first area behind its own doors.
6. [The AI layer: engines, evidence, and an expensive lesson](#chapter-6-the-ai-layer-engines-evidence-and-an-expensive-lesson): the barcode chain, the day the AI went dark, and the two engines that replaced one.
7. [Learning from the best: MacroFactor, Oura, Duolingo](#chapter-7-learning-from-the-best-macrofactor-oura-duolingo): reading the leaders' own methods, two faults they showed us, and the tests that proved the fixes.
8. [Ask about your numbers: retrieval, a tool and a small agent](#chapter-8-ask-about-your-numbers-retrieval-a-tool-and-a-small-agent): finding the right paragraph by meaning, letting a model call our code, and the check that decides what you see.

[Glossary](#glossary) at the end. Decisions are in [docs/decisions](../decisions/README.md).

---

## Chapter 1. How it fits together
### The picture in one paragraph

Slim Chance is one web app that runs everywhere. It is written in Svelte 5 and
SvelteKit, built into static files, and served by Vercel. On a phone it runs
inside a thin native shell (Capacitor) that loads the live website, so a web
deploy updates every installed app at once; only native code (notifications,
Health Connect, the icon) needs a new phone build. Data lives twice: in a
local database on the device (IndexedDB, through Dexie), so the app works
offline and feels instant, and in Postgres on Supabase, which is the record.
A few things run on the server as edge functions (Deno): the AI coach, the
food estimate, the health digest, account deletion.

### The layers, and the rule between them

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

### One weigh-in, end to end

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

### The practices, and why each exists

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

### What is weak, honestly

- Many checks read the source code's text instead of testing behaviour, so
  they break when wording moves and can miss real bugs.
- Everything sits in one big `src/lib`; areas reach into each other. Chapter 3
  (domain-driven design) is the cure.
- Some notifications are written ahead of time on the phone and can go stale
  when data changes elsewhere.

### The bug lesson: check at the moment of use

On 10 November the evening note said "workout at 5.30pm" at 7.30pm, and
"protein to go" after protein was hit. The coach wrote its text in the
afternoon; the phone showed it in the evening. Between the moment something
is checked and the moment it is used, the world can change. Security people
call this *time-of-check to time-of-use* (TOCTOU). The cure is always the
same: re-check at the moment of use, or only say things that stay true until
then. The fix did both: times that will have passed are refused, and a note
written for a day that has since changed steps aside.

**Try it.** Open `svelte-recomp/src/lib/insights.ts`, find `chanceOf`, and
read it with chapter 2's coin rule in mind: everything the coins show comes
out of that one function.

---

## Chapter 2. Design: a system, not a mood

### What a design system is

A design system is the app's visual language written down, in four layers:

| Layer | What it is | Here |
|---|---|---|
| Tokens | Named values: colours, sizes, corners, fonts | The top of `svelte-recomp/src/app.css`: `--bg`, `--text`, `--amber`, `--r-md`, `--font-display` |
| Components | Reusable pieces built only from tokens | `Readout.svelte` (the big number), `SlimTrack.svelte` (the path), the cards |
| Patterns | How pieces combine on a screen | Every tab opens with one hero that answers its question |
| Rules | What things mean, and what is never done | The list below, guarded by checks |

Tokens are why today's new look took about forty lines. No screen says
"yellow": screens say `var(--amber)`, "the accent". The dark theme sets
`--amber` to yellow; the light theme sets the same name to blue under
`[data-theme="light"]`. Change a value once and every screen follows. (The
name `--amber` is older than both themes; renaming it in hundreds of places
would buy nothing.)

### Two themes, and how we chose them

**Deep** (navy-violet with yellow) is the dark theme and **Daylight** (white
with blue) the light one. A first launch follows the phone's own light or
dark setting; the switch in the menu overrides it. The choice is made in
`src/app.html` before the first frame is drawn, so the app never flashes the
wrong colours and then jumps.

How the choice was made matters more than the colours:

1. **Judge on the device, in context.** On 3 November black and gold looked
   fine as an idea and dull on the phone, and went back the same day. Since
   then a visual change is judged as real screens on a phone-sized window,
   with two months of made-up data, before it ships.
2. **Check that the evidence can fail.** The first screenshots of the two
   candidates came out identical to the old look. The script set the theme
   before the page existed, so the switch silently did nothing. A test that
   can't fail tells you nothing; the same lesson as a build that failed
   quietly while old screenshots looked fine.
3. **Write the decision down** ([0005](../decisions/0005-two-themes-and-the-coin-rule.md)),
   with what would change it.

### Learning from George and Happy Scale, without copying

These notes come from using the apps, not from a formal study.
- **George** (a banking app) makes money, a dry subject, feel friendly:
  saturated colour, motion that answers what you did, and kind words. We took
  the attitude: colour and motion are allowed to be happy if they mean
  something. We left out the game layer.
- **Happy Scale** (a weight app) shows a smoothed trend instead of the day's
  number and breaks the goal into milestones. We already had the trend; the
  milestones became the stops on the path to the goal.

### The rules

1. **Coins mean the chance and nothing else**, and look the same everywhere:
   Today's gold coin. Distance is a path. Counts are plain numbers. Until
   10 November, Progress showed the chance as ten marks in its hero and the
   distance as ten coins just under it ("2 of 10"). A symbol that means two
   things teaches neither.
2. **Colours mean data.** Green: on pace. Blue: fine. Orange: look here. Never
   red for a bad week: shame is what makes people quit. Orange waits until
   something is actually late: Train showed "0 of 2" in orange on a Monday
   morning, before any session was due. Found while writing this chapter,
   fixed the same day (`trainingTone` in `src/lib/week.ts`).
3. **One big thing per screen.** Today: your chance. Food: protein. Train:
   sessions this week. Progress: the trend.
4. **Words are about the chance and what you do, never about the body.**
   "Slim, for now" beside a weight read as "you are slim"; "Not so slim"
   beside a good chance read backwards. Both are gone, and checks keep them out.
5. **BMI is a number and a place on the path, never a category word.**
6. **Motion has a meaning** (coins flip in as they light, the path fills as
   it opens) **and stops for anyone who turns motion off** on their phone.
7. **Readable first.** The body font, Atkinson Hyperlegible, was designed for
   people with low vision. Every size is in `rem`, so one text-size setting
   scales the whole app.

### What is weak, honestly

- The hero's gradients and the gold coin are written as raw colours, not
  tokens, so they can't change with a theme.
- The phone's own splash screen and icon keep the old colours until the next
  phone build, which waits for the exploration to end.

**Try it.** In `src/app.css`, change `--amber` under `:root` to any colour,
run the app (`npm run dev` in `svelte-recomp`), and watch every button and
active tab follow. Then put it back.

---

## Chapter 3. MCP: Slim Chance inside any assistant

### The idea

Until now Slim Chance only worked if a stranger installed it, signed up and
weighed in for a week, and of 59 who signed up none got that far in three
days. Meanwhile millions of people already ask a general AI assistant "is my
diet working?", and we assumed a language model is bad at the sum this app
does: a trend through noisy mornings with an honest error bar. Chapter 4
tested that assumption, and it was only half true.

So the maths is now offered as a tool that any assistant can call, with no
app, no account and nothing stored. The app becomes an engine, and the
screens are only one way in. It is also the cheapest test we have of the
question in [0003](../decisions/0003-mission-and-who-first.md): does anyone
want the chance, once the sign-up wall is gone?

### What MCP is

The Model Context Protocol is an open standard for letting AI applications
use outside tools and data. The assistant is the *client*; we are a
*server*. A server can offer three kinds of thing:

| Primitive | What it is | Ours |
|---|---|---|
| Tools | Actions the model can decide to call | `slim_chance` |
| Resources | Documents the app can read into the conversation | none yet |
| Prompts | Ready-made conversation starters the person picks | none yet |

The messages are JSON-RPC 2.0: small JSON objects with a `method`, `params`
and an `id`, answered with a `result` or an `error`. Each one travels as an
HTTP POST to one address, `https://slimchance.app/mcp` (the spec calls this
transport "Streamable HTTP").

### One conversation, end to end

1. **initialize.** The client says which protocol version it speaks. We
   answer with the version we'll use, what we offer (`tools`), and a line of
   instructions for the model.
2. **notifications/initialized.** "Ready." A notification has no `id`, so
   no answer is due: we return HTTP 202 and nothing else.
3. **tools/list.** We describe `slim_chance`: a title, a description, and a
   JSON Schema for its input (dated weights, kg or lb, which way the person
   wants to go) and its output.
4. **The model decides.** Nobody presses a button. The model reads the
   description and decides whether this tool answers the person's question,
   so **the description is the interface**. Ours says what the tool needs
   (7 readings in 5 weeks), what it does, and what it is not (a forecast).
5. **tools/call.** The model sends the weights; we answer with a sentence for
   the model to relay, plus the same facts as structured data:

```json
{ "state": "answerable", "chance_in_10": 10, "chance": "Almost certainly coming off.",
  "trend": 92.1, "rate_per_week": 0.46, "rate_range": [0.2, 0.73],
  "scale_noise": 0.2, "readings_used": 8, "unit": "kg", "as_of": "2026-11-10" }
```

### The choices, and why

- **Stateless and anonymous.** Weights arrive, maths runs, the answer leaves,
  and nothing is kept. Health data is the most protected kind under European
  law; not holding it at all is the strongest protection there is.
- **No AI on our side.** The caller's assistant does the talking, so a call
  costs us a few milliseconds of arithmetic and no AI bill, and there is no
  sign-up to guard.
- **The same maths as the app.** The tool calls `weightVerdict`, `chanceOf`
  and `oddsOf`, the functions behind the coins on Today, so the app and the
  tool can't disagree. `src/lib/mcp.ts` is pure (a message in, a reply out)
  and `src/routes/mcp/+server.ts` only moves bytes. This shape has a name,
  *ports and adapters*: the core knows nothing about who is calling.
  Chapter 5 measures it.
- **Two kinds of error.** A broken message is a protocol error. A wrong
  date is a *tool* error (`isError: true`) with a sentence the model can read
  and fix, then retry, without a person seeing a failure.
- **Version negotiation.** The protocol moved on in July 2026 to a newer,
  fully stateless version. We speak the two 2025 versions most assistants
  use. A newer client gets the spec's own answer, "unsupported version, here
  is what I speak", and falls back to one we both know.
- **A rate limit at the edge.** Vercel's firewall lets one address make 60
  calls a minute; the 61st gets HTTP 429 ("too many requests") before our
  code runs. Tested: 70 quick calls, 60 answered, 10 refused.

### How it was tested

- **In the suite.** Because the handler is pure, the check plays a whole
  conversation without a network: the handshake, the list, a call with three
  weeks of noisy mornings (the true rate must land inside the range), the
  same in pounds, too few readings, bad input, a newer client.
- **With real clients.** The official MCP Inspector, versions 1 and 2,
  connected, listed the tool and called it.
- **After every deploy.** The ship script's live check asks the live server
  for its tool list; if that fails, the deploy rolls back by itself.
- **The safety net caught us.** The first commit had a product name in a
  code comment. The check that keeps assistant names out of published files
  only reads committed files, so it passed on the laptop and stopped the
  deploy. That commit is in the public history, fixed by the next one.

### What is weak, honestly

- **Listed, but not yet found.** It is in the official MCP Registry (chapter
  4 says why it waited); assistants' own directories are a separate step.
- **It remembers nothing.** Each call sends the whole history again. A
  version connected to a Slim Chance account would need sign-in (OAuth 2.1)
  and a much bigger privacy decision.
- **One tool.** The weekly budget and the learned burn are not offered yet.
- **The `Origin` header is not checked.** The spec asks servers to check it
  so websites can't reach servers running on someone's own computer. This
  one is public and keeps nothing, so a website calling it gains nothing it
  couldn't get directly. The reason is written next to the code.

**Try it.** In your AI assistant's settings, add a custom connector (some
call it an integration or an MCP server) with the address
`https://slimchance.app/mcp`. Then paste a week or two of morning weights
with their dates and ask whether your weight is really moving. Or, from a
terminal:

```sh
curl -s -X POST https://slimchance.app/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Chapter 4. Evals: how we found out our chance was overconfident

### What an eval is

An eval is a test for answers that aren't simply right or wrong: a fixed set
of cases, a known truth for each, and a score computed the same way every
time. It is how you compare two models, two prompts, or a model with and
without a tool, by evidence instead of impression.

The hard part is the known truth. For "is this person really losing
weight?" there is a clean way to get it: **make the people up.** Give each
one a true weekly rate, then add what a real scale adds: daily water that
carries over from one morning to the next, and missed mornings. The
question has a correct answer for every made-up person, so every answer can
be scored.

### The setup

`svelte-recomp/scripts/eval-trend.mjs` asks the same question three ways:

| Way | What answers |
|---|---|
| Alone | A general model (Gemini) reads the numbers and judges |
| With the tool | The same model, offered our live MCP tools; nothing tells it to use them |
| Tool only | Our own function, no model |

Each answer is a chance in 10. Two scores:
- **Brier score:** the average squared gap between the chance and what was
  true (1 if truly losing, 0 if not). 0 is perfect; always saying "5 in 10"
  scores 0.25, a coin toss.
- **Confident mistakes:** 8 or more in 10 when not truly losing, or 2 or
  less when truly losing.

### What it found

60 made-up people, 10 to 32 days each:

| | Brier | Confident mistakes |
|---|---|---|
| Model alone | **0.154** | 6 |
| Model with our tool | 0.184 | 7 |
| Our tool alone | 0.183 | 7 |

Two findings, one good and one uncomfortable:
1. **The model chose our tool for all 60 people**, from its description
   alone. The MCP side works.
2. **The model alone was better than our maths.** Split by how many mornings
   each person had, the gap is all in the short ones: with 10 mornings or
   fewer our tool scored 0.258, worse than a coin toss, while the model
   hedged with "too early to tell" and scored 0.204. From three weeks on,
   both were good.

### Finding the cause: three wrong guesses first

This is the systematic-debugging habit from chapter 1: state one guess, test
it, keep what the evidence says.

1. **"The chance is just off for short series."** Tested on 20,000 made-up
   people with our function alone, no model, at no cost. Confirmed: with
   7 to 10 mornings, when the app showed 0 to 2 coins, those people were
   truly losing almost 4 times in 10. From about 15 mornings on it was
   honest. Our existing honesty check only simulated people with 35 to 65
   days of data, so it never looked at the first two weeks, which is exactly
   when a new person sees their first coins.
2. **"The carry-over estimate is biased with few mornings."** True in theory,
   and correcting it barely helped.
3. **"It should lean on what's typical for people."** On its own this barely
   helped either, because the margin of error was still too narrow to let
   it act.

What the evidence finally showed: **over a week or two, slow water swings
look exactly like a trend**, so a series can't measure its own noise. The
fix needs two things together: start the margin of error from how noisy
real scales are, and let a plausible human rate count until the person's own
mornings outweigh it. Together they cut the overconfident answers sharply,
though not fully yet. A real series of morning weights also turned out
noisier than the simulator assumed, so with real people the problem is
probably bigger, not smaller.

### The fix, and the gate

**Not from one person's data.** The first plan leaned on one real series of
mornings for "how noisy real scales are". One person is not a population, so
the fix was chosen to be honest across a whole grid instead: nine kinds of
scale (day-to-day noise of 0.4, 0.7 or 1.0 kg; carry-over from one morning
to the next of 0.2, 0.45 or 0.7), with the 0.35% weekend swing measured in
1,421 smart-scale users in a European weight-loss trial (PLOS ONE, 2020),
and three different populations of true rates. About 67,000 made-up people
in all.

**What changed** (`src/lib/insights.ts`):
1. The margin of error assumes water carries over from day to day. A short
   series starts by assuming a lot of carry-over, the careful end, and the
   person's own mornings take over as they add up.
2. The chance weighs the line against a plausible rate centred on its own
   threshold, so no information is a coin toss and a month of mornings
   outweighs it.

**The check came first.** A new check simulates the first two weeks on all
nine scales. It failed on the old code (confident coins 2.8 coins too sure)
and passes now. The old long-series honesty check still passes. Exactly one
of the app's stored personas reads differently: a newcomer on their seventh
morning now hears "8 in 10 it's coming off" instead of "Almost certainly".

**The gate, re-run with 200 made-up people:**

| | Brier | Confident mistakes |
|---|---|---|
| Model alone | 0.174 | 21 |
| Model with our tool | 0.172 | 13 |

Average accuracy is a tie (the difference's 95% range runs from -0.018 to
+0.024), but the tool avoids 8 confident mistakes (95% range 2 to 14). With
10 mornings or fewer it now helps (0.194 against 0.208); before the fix it
hurt (0.258 against 0.204). A confident wrong answer is the one that does
damage, so the gate passed, and the server is now listed in the official
MCP Registry as `io.github.slimchanceapp/slimchance`.

Why 200 and not 60: between two runs of the same 60 people, the model alone
moved from 0.154 to 0.171 by chance. A gate needs a sample big enough that
chance can't open it.

### What is weak, honestly

- The made-up people are only as realistic as their noise. One real series
  can't stand for everyone.
- The gate's 200 people are enough for confident mistakes, not for a small
  difference in average accuracy.
- The model's answers vary from run to run, and an eval needs re-running when
  the model changes.

**Try it.** `node scripts/eval-trend.mjs 10` in `svelte-recomp` (it needs a
Gemini key in the environment) prints the three scores for ten people. Then
change `pick([10, 16, 24, 32])` to only `[32]` and watch the gap close: with
a month of mornings our maths and the model agree.

---

## Chapter 5. Domain-driven design: areas that can't break each other

### The idea

Domain-driven design (DDD) says: build the software out of the words and the
boundaries of the problem it serves, not out of technical layers alone. Four
ideas carry most of it:

- **Ubiquitous language:** one word for one thing, used the same way in
  conversation, on screen and in the code.
- **Bounded contexts:** areas with their own model and their own rules, which
  talk to each other through narrow doors.
- **Aggregates:** things that must change together or not at all.
- **Anti-corruption layers:** translators at the border, so an outside system's
  quirks don't leak into your model.

The worry it answers is the one raised on 5 November: blast radius. A change
in one place shouldn't break another.

### Our language, and where each word lives

The app already has a language, and each word has exactly one home in the
code. Chapter 1's "one source of truth" rule is this idea under another name.

| Word | Means | Its one home |
|---|---|---|
| Weigh-in | One morning's reading, saved with a typo guard | `saveWeighIn`, `body/weighIn.ts` |
| Trend | Where the weight really is under the daily water noise | `weightVerdict`, `body/insights.ts` |
| The chance (coins) | How likely the trend is really going the goal's way | `chanceOf`, `body/insights.ts`; words in `body/pulse.ts` |
| The path | How far from the start to the goal | `body/slimTrack.ts` |
| The budget | The week's calories, not the day's | `weekBudget`, `nutrition/week.ts` |
| Learned burn | What this body burns, learned from the log and the scale | `weeklyMaintenance`, `nutrition/adaptiveTdee.ts` |
| The floor | The least anyone is ever planned to eat | `CUT_FLOOR`, `nutrition/tdee.ts` |
| A trained day | Lifting logged, or 30+ minutes of watch-recorded sport | `trainedDates`, `training/exercise.ts` |
| A stall | The trend has ruled out the plan's pace | `diagnoseStall`, `body/insights.ts` |
| Moments | The morning briefing and the evening hold | `stores/moments.ts` |

### The map

| Area | What it knows | Core (pure) | Shell (talks to the world) |
|---|---|---|---|
| Body (`src/lib/body`) | Weigh-ins, trend, chance, path, ceiling, stops | `insights` `pulse` `line` `slimTrack` `milestone` `scale` `scaleUp` `importWeights`, read through `index.ts` | `weighIn`, `stores/body` |
| Nutrition (`src/lib/nutrition`) | Food, the week's budget, the learned burn, meal plans | `food` `week` `adaptiveTdee` `tdee` `mealPlan` `nutritionPatterns` `foodCoach` `quickAdd`, read through `index.ts` | `foodLog`, `foodSources`, the food edge functions |
| Training (`src/lib/training`) | Sessions, lifts, plates, the exercise library, watch workouts, the trained day | `strength` `liftStalls` `plates` `trainPlan` `nextWeight` `muscleVolume` `trainingHeatmap` `exercise`, read through `index.ts` | the Train screen, `logActivity` |
| Health signals | Sleep, resting heart rate, HRV, steps | `signals` `readiness` `fitness` | `health/*` (Health Connect), Apple Health |
| Coach | The AI's words, checked | `brain` `coach` | `stores/brain`, the coach edge function |
| Moments | Briefing, evening hold, kind words, the journal and the month's letter | `briefing` `hold` `cheer` `kind` `lessons` `journal` | `stores/moments`, the Android receiver |
| Medication | Doses, effects, the doctor report | `meds` | the Medication screen |
| Identity and data | Accounts, the device's copy, sync | `profile` `exportData` | `db/*`, `stores/sync`, `stores/live` |
| Metrics | Are we helping? | `fit` | `events`, the Numbers page, `owner_metrics` |
| The outside world | Other people's AI assistants | `mcp` | `routes/mcp/+server.ts` |
| Shared kernel | Units and dates, which every area speaks | `units` `date` | `stores/units` |

Two DDD ideas are already here under other names:
- **Aggregates.** Rows that belong together (a meal, a seeded plan) go
  through `upsertRecords`: one request, all or nothing. A half-saved meal is
  exactly what an aggregate exists to prevent.
- **An anti-corruption layer.** `supabase/functions/_shared/llm.ts` puts three
  AI providers behind one door, and `checkReply` refuses model text that
  breaks the app's rules. Gemini's quirks stop at that border.

### Measuring the core

The rule from chapter 1 is "logic is pure": data in, data out. A small
analysis checked every module in `src/lib`, following each import, and
counted the ones that reach nothing outside: no storage, network, browser,
database or stores.

The first count was 38 of 71. The surprise was why: `units.ts`, which turns
kilograms into pounds or stone, read the person's unit from browser storage
the moment it was imported. So 15 otherwise pure modules secretly depended
on a browser, including the MCP server, which runs on a server with no
browser at all. It worked only because the read was wrapped in a `try`.

This is a *hidden dependency*, the kind DDD's boundaries exist to expose. The
fix kept the behaviour (a pounds user never sees kilograms flash on a
reload) but moved the memory out of the core: `units.ts` now only holds the
current unit, `stores/units.ts` remembers it on the device, and the root
loader restores it before the first frame. A throwaway account on the live
site confirmed pounds on the very first frame after a reload.

The count is now **53 of 71**. The other 18 are adapters (haptics,
notifications, the database, sharing, the weather cache), which is where
side effects belong.

### The boundary, enforced

The 53 are listed in `svelte-recomp/scripts/pure-core.txt`, and a check fails
when any of them stops being pure, naming the import that did it. Put the old
`units.ts` back and it fails at once: "coach.ts left the pure core: units.ts
uses localStorage". Like the regression baseline, the list may grow, and
taking a module off needs a reason in the commit.

### The first area moves: Body

On 2026-11-11 Body got its own folder, `src/lib/body`, with **two doors**.
`index.ts` is for reading (the trend, the chance, the path) and is pure.
`weighIn.ts` is the one way to save a weigh-in, and it touches the database.
They are separate on purpose: one door that also handed out `saveWeighIn`
would drag the database into every pure module that only reads a trend, and
the pure-core check would fail them all.

A check now guards the border in both directions. Outside `body/`, a file
may import only those two doors. Inside, Body may use only itself and the
**shared kernel** (`units`, `date`). The check was proven by breaking it three
ways: an outside file reaching past the door, a type reaching past it, and
Body reaching into Coach. Each failed with the file and the import named.
(The first try at the third probe was wrong itself: it asked Coach for a
name that had just moved, so the whole suite crashed. That still fails
verify, but for the wrong reason, so it was rerun with a real name.)

**What the move found:**
1. **Body leaned on Coach.** The odds' words asked the Coach area which way
   the goal is (`goalDirection`). That's Body's own language, so it moved
   into Body, and Coach now depends on Body, not the other way round.
2. **Strangers in Body's file.** "Protein on training days" is Nutrition's;
   "does the watch agree" and "what heavy sessions cost the next morning" are
   Health signals'. They moved to `nutritionPatterns` and `signals`. The last
   one has tests but no screen uses it: dead code, and a candidate to delete.
3. **One idea written three times.** Lose, gain or maintain was its own type
   in three files. Now there's one, owned by Body.
4. **The tests weren't enough on their own.** Every check passed, but the
   type check caught two inline type imports still pointing at the old file.
   That is why verify runs both.

**How we know nothing else changed:**

| What | Before | After |
|---|---|---|
| Checks (including the personas snapshot of what people read) | all pass | all pass, snapshot unchanged |
| JavaScript a phone may download | 1,075,462 bytes | 1,075,458 bytes |
| Each page's own file | | the same size, all 11 |
| The trend maths, 2,000 runs on 400 mornings | about 690–700 ms | about 690–700 ms |

Moving code between folders doesn't change what runs. The real risk to
speed in a modular monolith is a door that makes pages download more, so
that is now measured on every verify: `scripts/bundle-check.mjs` sums all the
JavaScript and what the first screen needs, against
`scripts/bundle-budget.json`. A deliberate increase raises the budget with a
reason in the commit, the same way the baseline grows.

### The second area: Nutrition

The same day, Nutrition followed: food, the week's budget, the learned burn,
meal plans and the patterns in a food log, in `src/lib/nutrition`. Its door
was written from what the rest of the app actually imports, and it has two
shell doors: `foodLog.ts` saves food, `foodSources.ts` looks it up. It may
build on Body's door and nothing else, and the border check is now one rule
for every area, so each new area costs one line.

Nutrition had no wrong-way dependency, but its door gave away three
strangers: `week.ts` also held the weekly journal, last month's letter and
the colour of Train's hero. They moved to `journal.ts` and `trainPlan.ts`.

And the size check earned its keep. The first home I gave the month letter
was the weekly review module. Everything still passed, but the first screen
grew by 3.6 KB: the morning moments load at startup and read the letter, so
the whole weekly review came along. The total had shrunk, so only the
first-screen number showed it. The letter got its own small module, and the
first screen ended 160 bytes lighter than before. The check's slack was 1%,
which let the slip pass; it is 0.2% now.

| What | Before | After |
|---|---|---|
| Checks and the personas snapshot | all pass | all pass, snapshot unchanged |
| JavaScript in all | 1,036,715 bytes | 1,036,688 bytes |
| JavaScript for the first screen | 700,144 bytes | 699,984 bytes |
| The learned budget, 300 runs on 120 days | about 250 ms | about 250 ms |

**Try it.** Add `import { weightVerdict } from './body/insights.ts';` to the
top of `src/lib/week.ts` and run `node scripts/selfcheck.js`: "week.ts
reaches past Body's door". Then take it out.

### The third area: Training

Training followed the same afternoon: lifts and their progress, plates, the
exercise library and plan defaults, watch workouts and the one definition of
a trained day, behind `src/lib/training/index.ts`, with `logActivity.ts` as
the one way to log an activity. Training builds on no other area at all; a
probe that had it read Nutrition's door failed, as it should.

The move found two things. The watch-workout maths (`exercise.ts`) is pure
logic, but it lived in `health/`, the folder for adapters, so the purity
check had never been allowed to look at it; in Training it joined the pure
core and passed. And `data/checklist.ts`, an old evening checklist, had no
importer anywhere: dead code, deleted.

Same behaviour (every check, snapshot unchanged), same speed (building a
year of watch workouts: about 4.2 s per 200 runs before and after), and the
size moved by 39 bytes in all, 15 on the first screen: module names.

### Can the repo rebuild its own database?

A boundary in the code is worth little if the database underneath can't be
rebuilt from the repo. So on 2026-11-11 every migration was replayed, in
order, on an empty copy of the database (Supabase's own Postgres image, in a
throwaway container): `sh scripts/replay-migrations.sh`.

16 of 37 failed. Seven tables, settings and food logs among them, had been
made by hand in the dashboard in July, before every change went through a
migration. The later migrations altered tables that, as far as the repo
knew, didn't exist. Self-hosting from the repo was impossible, and so was
recovery from it.

The fix read each table's exact definition from production's catalog and
wrote it down as a migration of "the table as it first was". The later
migrations add the rest, as they did in production. It is safe to run twice,
so on production it changed nothing.

Then the replayed database was compared with production, line by line:
columns, keys, checks, indexes, row security, policies, functions and who may
call them, triggers, scheduled jobs and the storage bucket. That is **drift
detection**, and it found four more hand-made things: a column, two indexes,
and four policies that duplicated others exactly. A second migration recorded
the first three and removed the duplicates. Now all 39 migrations rebuild
exactly what production enforces, 468 lines compared, and GitHub replays
them whenever one changes.

**Try it.** `sh scripts/replay-migrations.sh` (it needs Docker). Then add
`create table public.scratch (id int);` to a migration file and run it with
`--drift`: the comparison names the table production doesn't have.

### Why not split it into services

Microservices draw the boundaries with a network: each area becomes its own
program with its own deploy. That buys independence for large teams and costs
everything else: latency, failures between services, versioning, a pipeline
per service. One person working with an AI gains none of it. The blast radius
here comes from logic leaking across layers, and a check stops that for free.

So the decision ([0006](../decisions/0006-modular-monolith-with-a-guarded-core.md))
is a *modular monolith*: one app, one deploy, areas named, the core guarded.
Files move into an area's own folder only once a check shows that area's
boundary holds, one area at a time. That incremental move has a name, the
*strangler* pattern, after a vine that slowly replaces the tree it grows on.

### What is weak, honestly

- **The map is a table, not folders.** Everything still sits flat in
  `src/lib`, so nothing stops Body from importing Training directly.
  The next check should cover imports between areas, not only purity.
- **`stores/body.ts` is a hub.** It joins Body, Nutrition and Training into
  the numbers every screen shares. Useful, and also the place where a change
  ripples furthest.
- **A concept in the wrong place.** `trainedDates`, the one definition of a
  trained day, is pure logic living among the Health Connect adapters in
  `health/exercise.ts`. It's the natural first move.
- **Purity is measured by what a file says, not what it does.** A module
  could still reach the outside through a function passed in. The check
  catches the common leaks, not every possible one.

**Try it.** Add `localStorage.getItem('x');` inside any function in
`src/lib/pulse.ts`, run `node scripts/selfcheck.js` in `svelte-recomp`, and
read which check fails and why. Then take the line out.

---

## Chapter 6. The AI layer: engines, evidence, and an expensive lesson

### The barcode chain

A scanned barcode is looked up in order, cheapest and most trusted first:

1. **Your own history.** A product you logged before is known even when no
   database is.
2. **Open Food Facts**, the open database, by its product address, then by its
   search index. US barcodes are 12 digits and Open Food Facts files them as 13
   with a leading zero, so both forms are tried.
3. **USDA FoodData Central**, the US government's database of branded foods,
   when Open Food Facts has nothing. Only the number is sent.
4. **A photo of the label**, read by the AI, saved with the barcode so your
   next scan finds it instantly.

Step 3 was decided by measurement, not by guess. Of 250 random US packaged
foods drawn from USDA's database, Open Food Facts knew 184 with calories (74%),
7 without, and 59 not at all. So about one US scan in four (95% range 21% to
32%) used to end in "not found" and now doesn't. The sample came from the part
of USDA's list its API lets you page through (about the first 50,000 of
450,000 products, sorted by name); a product's name shouldn't decide whether
Open Food Facts knows it, but it is a limit worth saying.

### The day the AI went dark

On 10 November photo reading, label reading and the coach stopped working for
everyone. The cause was mine. The evals in chapter 4 ran about 1,000 requests
through the app's own Gemini key in one afternoon; the whole app makes about
200 a month. Gemini runs on a prepaid balance, and it hit zero.

Three engineering lessons, each now a rule with a check:

- **A shared resource is shared state.** A prepaid balance behaves like a
  database every feature writes to. Anything that can drain it (a test, a
  script, a stranger) needs its own limit. Evals now refuse the app's key and
  stop after a set number of calls; the daily allowances fit real use (25 a
  person, 150 a day in all).
- **An error message must be true.** The app said "try again in a minute"
  when nothing would change in a minute. Errors now say what is really
  happening ("paused") and offer what still works.
- **Find out before the users do.** The owner found the outage; nothing
  alarmed. The daily health check now asks the AI for one token and emails
  the owner when nothing can read a photo.

### Two engines and one rule

Gemini's free tier wasn't a way out: Google's terms let an app serve users in
the EU, the UK and Switzerland from the paid tier only, so the free tier could
have served the owner and no one else. That would have made the app worse,
which was rejected.

The answer was a second engine. **Gemma 4** is Google's open model, built from
Gemini 3 research, under a licence that lets it serve anyone. Cloudflare runs
it: always warm, so there are no cold starts, on a free daily allowance that
fails instead of billing, and it keeps nothing once it has answered and never
trains on what it is sent.

A detour worth recording: the first plan was to run Gemma ourselves on Modal's
free monthly credits. Modal refuses every GPU without a card on file, which
the reviews I had read did not say. Keeping a GPU warm all day would have cost
hundreds a month. The lesson: check billing facts at the source, never in a
summary.

One rule now decides which engine may answer each request
(`providersFor`, `supabase/functions/_shared/auth.ts`):

| Request | May go to |
|---|---|
| A photo, a label, a body-fat photo, the coach | Gemini (where Google allows), then Gemma. Never a free gateway |
| Typed food, a recipe | Gemini, Gemma, then the free text gateways (Kilo, Pollinations) |

When Gemini answers "balance empty", the app remembers that for ten minutes,
so Gemma answers without first waiting for a refusal. This is the
*anti-corruption layer* of chapter 5 at work: the rest of the app never knows
which engine answered.

### Measuring before switching on

Gemma served nobody until two tests passed:

- **Labels:** 60 real nutrition-label photos from Open Food Facts, 12 each from
  Slovakia, Czechia, Germany, the UK and the US. Energy came back within 10% on
  53 and within 5% on 49; protein within 1 g on 52; about 2 seconds each.
- **Typed food:** 150 USDA foods with a portion. Typical error 10%, with no
  lean high or low; 11 off by more than half.

Then I looked at two of the misses by eye. On a pasta label printed in about
twenty languages Gemma read 539 kcal where it says 359: a real miss. On a
Slovak product, Gemma read 648 kcal and the label says 648, but the database
said 847. **The test data was wrong, not the model.** An eval is only as good
as its truth, so read the failures before believing the score.

### What is weak, honestly

- **Gemini wasn't measured on the same tests.** Its balance was empty, so
  "as good as before" is a claim about Gemma against the truth, not against
  Gemini.
- **The free allowance has a ceiling:** about 1,300 label reads a day. A busier
  day pauses photos until midnight UTC.
- **The food test uses USDA's wording** ("Chicken, broilers or fryers,
  breast…"), not the way people type.
- **USDA's barcode lookups use a shared demo key**, which other users of the
  same key can rate-limit.

**Try it.** With the Cloudflare key loaded, `node scripts/eval-label.mjs 10`
in `svelte-recomp` reads ten labels and prints the scores. Add `EVAL_ROWS=1`
to see each label's truth beside Gemma's answer.

---

## Chapter 7. Learning from the best: MacroFactor, Oura, Duolingo

Learning from the best is not copying their screens. It is reading how they
say their method works, finding the same idea in our own code, writing down
where we differ and whether on purpose, and then changing only what a test
on many simulated people shows is better. This chapter did that three times.
Two of the three found a real fault in Slim Chance.

### MacroFactor: a budget learned from your own scale

MacroFactor is the reference for our core idea. Its own help pages say the
expenditure estimate is "a deterministic calculation based on your calorie
intake and change in trend weight", the same identity as
`src/lib/adaptiveTdee.ts` (chapter 1). Side by side:

| | MacroFactor | Slim Chance |
|---|---|---|
| The identity | logged intake + trend weight change | the same |
| A day not logged | skipped; updates pause below 4 logged days a week | skipped |
| Food a log always leaves out | absorbed: "your targets account for your usual logging habits" | absorbed: the target is in the log's own units |
| Weekly change | smoothed; a stall of a week or two is treated as water | smoothed (α 0.35), at most one 300 kcal step |
| After a big day | warns against eating less the next day | spreads it over the week, never under the floor |
| A half-logged day | "one of the only things that can have a significant negative impact"; detected and left out | **counted as a full day if over 800 kcal** |

The last row was a fault. A forgotten dinner (a 1,000 kcal day beside usual
2,000 kcal days) passed our fixed 800 kcal cut and pulled the learned burn
down, the unsafe way: it ends in "eat even less".

**The test.** `scripts/eval-partial.mjs` makes 6,000 people with a known true
burn: a real day-to-day spread in what they eat, a weekend lift, a log that
always misses a share, days not logged at all, half-logged days, and a scale
whose water lingers. Each rule's learned budget is compared with what a
perfect log in the same units would have taught:

| Rule for which days count | Bias | Typical error | Budgets >200 kcal too low |
|---|---|---|---|
| Fixed 800 kcal (before) | −24 | 133 kcal | 14.1% |
| 55% of the person's usual day (now) | +6 | 130 kcal | 9.9% |
| 60% of the usual day | +21 | 131 kcal | 8.3% |
| Judged by the person's own spread (MAD) | about −12 | 134 kcal | about 12.5% |
| A perfect detector | +1 | 118 kcal | 8.5% |

The surprise came from running each rule at one spread at a time. For steady
eaters 60% looked best; for very variable eaters it threw away real light
days and set budgets 119 kcal too high. A rule judged by each person's own
spread never backfired but barely helped, because the half-logged days
inflate the spread they're judged by. Across a mixed population, the cut at
55% of the person's usual day was the one that came close to perfect. It
errs high for the most variable eaters (slower loss), never low. The owner's
own budget didn't move: none of his days falls under the cut.

### Oura: readiness against your own normal

Oura's readiness score is built from contributors (resting heart rate, HRV
balance, sleep, previous-day activity, body temperature). The "balance" ones
compare a 14-day average with a two-month one, and the app takes about two
weeks to learn a person's normal before it judges. Sports science's
HRV-guided training works the same way: HRV swings 10 to 20% from one morning
to the next with nothing wrong, so a morning is judged against the person's
own normal range, never their average alone.

Our readiness, behind Today's Body row and the coach's training plan, scored
HRV as today divided by a 14-day average and sleep against a fixed 8 hours,
then needed a score under 40 to say "easy day".

**The test.** `scripts/eval-readiness.mjs` makes 3,000 people with their own
HRV, resting heart rate, sleep and spreads, and now and then a strained spell
of 2 to 4 days (HRV lower, resting rate higher, sleep shorter):

| | "Easy day" on ordinary mornings | Strained mornings caught as easy | Caught as at least moderate |
|---|---|---|---|
| Before | 0.0% | 0.0% | 0.1% |
| Own normal range (now) | 1.0% | 55% | 87% |

The old score was blind: it said "ready" on almost every morning, strained or
not. Now HRV is judged on a log scale against the person's own spread,
resting heart rate in beats, sleep against their usual night, and nothing is
judged until 7 mornings make a normal. Honest limit: the strained spells are
our model of illness and overreaching. Real proof needs real mornings with
known sick days.

### Duolingo: the first week

Duolingo is the reference for coming back. What its published talks and
second-hand write-ups agree on: the shortest path to a first win; a small act
of commitment during setup (choosing a daily goal kept people even when the
choice was never used); reminders at the person's own time; progress you can
see; a widget on the home screen. Its streaks, points and leagues are the
part we leave on purpose (no game layer: kind words for what people do,
never for the scale).

We already have the calm versions: morning two explains the scale's jump
from the person's own data; setup asks the time of the morning weigh-in,
which is the commitment; the reminder comes at that time; Progress shows the
way to the goal as a path. The new idea worth building is an Android
home-screen widget: today's odds and a weigh-in tap. It's a native change, so
it waits for a build.

### The method, in six steps

1. Read the leader's own documentation, not reviews of it.
2. Find the same idea in our code.
3. Write down where we differ, and whether that's on purpose.
4. Build a test with a known truth over thousands of simulated people.
5. Change only what wins across the whole range, not just at one setting.
6. Keep the test in the repo, so the claim can be rechecked by anyone.

**Try it.** `node scripts/eval-partial.mjs`, then
`SPREAD=0.35 node scripts/eval-partial.mjs`: watch the 60% rule go from best
to worst. Then `node scripts/eval-readiness.mjs`, and in
`src/lib/readiness.ts` loosen the `h <= -1.5` threshold in `readyFromNormal`
to see false alarms climb.

Sources: MacroFactor help centre on
[how expenditure is calculated](https://help.macrofactorapp.com/dashboard/expenditure),
[how often to log food](https://help.macrofactorapp.com/en/articles/110-how-frequently-do-i-need-to-log-my-nutrition-for-the-expenditure-algorithm-and-weekly-coaching-updates),
[partial logging](https://help.macrofactorapp.com/en/articles/241-what-is-partial-logging) and
[weekly adjustments](https://help.macrofactorapp.com/en/articles/222-how-does-macrofactor-make-adjustments-for-a-weight-gain-or-weight-loss-goal);
Oura on [the readiness score](https://support.ouraring.com/hc/en-us/articles/360025589793);
Duolingo retention write-ups ([Lazyweb](https://lazyweb.com/research/duolingo-retention-experiments),
second-hand, so treated as hints rather than facts).

## Chapter 8. Ask about your numbers: retrieval, a tool and a small agent

Progress has a box (when the AI coach is on): ask anything about your weight,
food or training. "Am I actually losing weight?" "Was I faster in my first
month?" "Do I need to log the oil?" Three techniques answer it, and a fourth
decides whether you see the answer at all.

### Retrieval: the right paragraph, found by meaning

Our guides and FAQ are cut into 23 passages. Each one is turned into an
**embedding**: a list of 384 numbers that places its meaning in space, made by
a small open model (`bge-small-en-v1.5` on Cloudflare). Passages about the
same thing land near each other. `scripts/build-knowledge.mjs` does this once
and saves `supabase/functions/_shared/knowledge.json`.

When you ask, your question is embedded the same way, and
`_shared/knowledge.ts` measures how close it sits to every passage (the
**cosine** of the angle between the two lists). The three closest, if they're
close enough (0.5), go to the model with your question. That is **RAG**: the
model writes from our text, handed to it now, not from what it remembers.

**How we know it finds the right one.** `scripts/eval-retrieval.mjs` asks 15
questions the way people ask them, each with the passage that answers it:
14 of 15 had it in the top three (**recall@3**), and its average rank was
close to first (**mean reciprocal rank** 0.93). The miss teaches the most:
"What does the app do when my weight jumps?" found "My weight jumps before my
period" first. The words matched; the meaning didn't. Small embedding models
lean on shared words. We left it: one miss in 15, and the fix (a bigger model,
or mixing word search with meaning search) costs more than it buys today.

### A tool: the model asks, our code answers

Some questions need a calculation: is the trend really going down, and how
fast? A model shouldn't do that sum, and here it isn't allowed to. It gets
one **tool**, `slim_chance`, and it may only say which dates to look at. The
function then fetches your real weigh-ins for those dates and calls our own
MCP server (chapter 3), the same door any assistant uses. The answer (the
chance in 10, the pace, the scale's noise) goes back to the model.

Why dates only: a tool that took weights as input would let the model make
some up. With dates, the worst it can do is pick the wrong dates, and then it
gets a true answer about those dates.

### The agent: a loop, not a single call

An **agent** is a model in a loop that can act. Ours is about 40 lines
(`supabase/functions/ask/agent.ts`):

```
question + your 14-day facts + 3 passages
   -> model: "call slim_chance from 2026-09-11 to 2026-10-11"
   -> our code runs it, hands back the result
   -> model: (maybe another call)  ...  -> {"answer": "...", "sources": [...]}
```

At most three turns, and the last one has no tools, so it must answer with
what it has. The eval and the live function run this same loop: the model
and the tool are passed in, so the test can't drift from the real thing.

### The check: the AI proposes, the app decides

Nothing reaches you until `src/lib/ask.ts` has read it:

- **Every measurement is grounded:** each number must be in your facts or a
  tool result (within 1%). Small whole counts (days, mornings) are free; a
  small decimal like "down 2.7 kg" is a measurement and must be found.
- **The never-say list** from the coach: no guilt, no starving, no asking you
  to log more.
- **Medicine goes to your doctor:** mentioning it is allowed only as a
  referral, and never with a go-ahead to stop or change anything.
- **Sources are real:** a guide is cited only if it was retrieved for this
  question.

A refused answer is asked for once more, with the reason attached ("refused
because: ..."). A second refusal shows nothing.

### What the eval found

`scripts/eval-ask.mjs` asks eight questions of a simulated person, each with
what a good answer needs (the tool, a particular guide, or neither). The first
run passed 6 of 8, and both failures were **our check being wrong**, not the
model:

1. "Please consult your doctor regarding any changes to your medication" was
   refused by a flat rule against the word "medication". The right answer was
   being blocked. Now medicine is allowed when it sends you to a doctor.
2. "If you start logging it, your numbers will adjust" was refused as a
   nudge to log more. But that sentence is **our own guide**, nearly word for
   word. A clause that opens with "if you" is now left out of that rule;
   "try logging the oil" is still refused.

Then two real misses:

3. "Was I losing faster in my first month?" got "I don't have your data from
   your first month." True: the model saw only 14 days and didn't know when
   your weigh-ins began, so it couldn't pick dates. Now it's told the range.
4. The test itself was wrong. The simulated weigh-ins had a 2 kg jump three
   weeks ago (a formula slip), while the hand-written facts said "losing 0.3
   kg a week", so the tool and the facts disagreed. Fixed to one smooth line.

Writing the check's own test turned up one more: "down 2.7 kg since
August", a number found nowhere, passed, because every number under 14 was
free. That's how only whole counts came to be free.

Final: **8 of 8**, one of them after the retry, in 21 model calls on
Cloudflare's free allowance. Live, from a throwaway trial account (deleted
afterwards): 3 to 6 seconds per answer.

### What is weak, honestly

- **Eight questions is a small eval.** It shows the parts work together, not
  how often answers are good across many people and many questions. It grows
  with each question people really ask, graded the same way.
- **The check grounds numbers, not claims.** A sentence can quote a true
  number and still misread it. The next step is a second model as a judge, or
  pulling out each claim and checking it.
- **One more thing to fail:** the tool call crosses the internet to our own
  server, and every asker shares that server's per-address limit, because all
  the calls leave from Supabase's few addresses.
- **Nothing is kept,** so we can't learn from real answers. That is on
  purpose (privacy), and it means the eval's questions are written by hand.

**Try it.** `node scripts/eval-retrieval.mjs` and read the scores beside each
passage. Then in `src/lib/ask.ts`, delete the `if you` line and run
`node scripts/eval-ask.mjs`: watch the oil question get refused for quoting
our own guide.

## Glossary

- **Design token:** a named value (a colour, a size) that every screen uses
  by name, so it can be changed in one place.
- **Functional core, imperative shell:** pure logic in the middle (numbers
  in, numbers out), with everything that touches the network or the screen
  kept at the edges. It makes the logic easy to test.
- **Regression baseline:** the list of every promise the app makes, each a
  named check, which only grows.
- **Row-level security (RLS):** rules inside the database that let each
  person read and write only their own rows, whatever the app asks for.
- **TOCTOU (time of check to time of use):** the gap between checking
  something and using it, in which the world can change.
- **Calibration:** a chance is calibrated when things it calls 7 in 10
  happen about 7 times in 10.
- **Eval (evaluation):** a set of test cases for an AI's output, graded the
  same way every time, so two models or two prompts can be compared.
- **RAG (retrieval-augmented generation):** the model is handed the relevant
  facts (your own history, a food database) when it writes, instead of
  relying on what it memorised.
- **MCP (Model Context Protocol):** an open standard that lets any AI
  assistant use an app's functions as tools.
- **ADR (architecture decision record):** one short file per decision: what,
  why, and what would change it. Ours are in `docs/decisions/`.
- **JSON-RPC:** a tiny convention for calling functions with JSON messages:
  a method name and parameters in, a result or an error out.
- **JSON Schema:** a description of what a piece of JSON must look like,
  which machines (and models) can read.
- **Stateless:** keeps nothing between calls; every call carries all it needs.
- **Rate limit:** a cap on how often one caller may call, enforced before the
  code runs.
- **Ports and adapters:** a core that knows nothing about the outside, with
  thin adapters (a screen, an HTTP route, an MCP server) plugged into it.
- **Brier score:** the average squared gap between a predicted chance and
  what happened; 0 is perfect, 0.25 is a coin toss.
- **Gate:** a release step that waits on a measured result.
- **Prior:** what is plausible before looking at this person's data (how
  noisy scales are, how fast people really lose), which their own data
  outweighs as it accumulates.
- **Bounded context:** an area of the app with its own model and rules,
  talking to other areas through narrow doors.
- **Ubiquitous language:** one word for one thing, everywhere: in talk, on
  screen and in the code.
- **Aggregate:** things that must change together or not at all, saved as one.
- **Anti-corruption layer:** a translator at the border with an outside
  system, so its quirks don't leak in.
- **Modular monolith:** one app and one deploy, with areas kept apart inside.
- **Strangler pattern:** replacing a structure piece by piece while it keeps
  running.
- **Prepaid credit:** money loaded in advance and spent per request; when it
  reaches zero, every request stops.
- **Open-weights model:** a model whose weights are published, so anyone may
  run it (Gemma); the opposite of one only its maker serves (Gemini).
- **Fallback chain:** engines tried in order, each when the one before it
  fails.
- **Serverless:** someone else keeps the machines running and you pay (or
  not) per request, so nothing of yours has to stay warm.
- **Half-logged day (partial logging):** a day where only part of what was
  eaten was logged. It teaches a learned budget a burn that's too low.
- **Median absolute deviation (MAD):** a measure of spread that a few odd
  values can't drag much: the middle of how far each value sits from the middle.
- **Normal range:** where a person's own mornings usually land; a morning
  outside it is a signal, one inside it is noise.
- **Migration:** one file of database changes, applied once, in order, and
  kept forever, so the database's whole history can be replayed.
- **Schema drift:** a difference between what the migrations build and what
  production really has, usually from a change made by hand.
- **Idempotent:** safe to run twice; the second run changes nothing.
- **False alarm and catch rate:** how often a warning fires when nothing is
  wrong, and how often it fires when something is. A useful warning has few of
  the first and many of the second.
- **Embedding:** a list of numbers that stands for a text's meaning, so texts
  that mean similar things get similar lists.
- **Cosine similarity:** how closely two embeddings point the same way, from
  -1 to 1; the measure used to find the nearest passages.
- **Recall@k:** how often the right answer is among the top k results.
- **Mean reciprocal rank (MRR):** the average of 1 divided by the right
  answer's position (first = 1, second = 0.5); 1 is perfect.
- **Tool (function) calling:** a model answering "run this function with these
  arguments" instead of text; our code runs it and hands back the result.
- **Agent:** a model in a loop that can act through tools, deciding each step
  from what the last one returned.
- **Grounding:** tying every claim in an answer to a source it was given;
  here, every number to the facts or a tool result.
- **Guardrail:** a check outside the model that decides whether its output is
  used.
