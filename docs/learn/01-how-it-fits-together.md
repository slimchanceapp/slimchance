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
4. Domain-driven design: cutting the app into areas that can't break each other (coming).
5. AI you can trust: retrieval, checks, evaluations, and AI on the phone (coming; the decision so far is [0004](../decisions/0004-ai-on-the-phone-first.md)).

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
diet working?", and a language model is bad at exactly the sum this app does
well: a trend through noisy mornings with an honest error bar.

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
  Chapter 4 builds on it.
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

- **Nobody knows it exists.** It is not listed in the public MCP registry
  yet; listing it is an outward step for the owner to approve.
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
