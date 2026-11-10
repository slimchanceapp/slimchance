# Show HN (draft, 10 Nov 2026)

Post on Tue 17 Nov, around 15:00 Bratislava time (morning in the US), from a
"Slim Chance" account. Stay near for the first two hours to answer comments:
answers matter more than the post. Nothing about who builds it beyond "I".

**Title** (80 characters at most):

Show HN: Slim Chance – weight-loss app that shows the odds you're really losing

**URL:** https://slimchance.app/?from=hn

**Text:**

Daily weight is mostly water, so most apps either show you noise or hide the
number. Slim Chance does something in between: it fits a trend to your
morning weigh-ins, allowing for the way a salty dinner lingers for days, and
shows the chance that the trend is really going your way, as ten coins.

We checked that chance against a known truth: about 67,000 simulated people
on nine kinds of scale, with missed mornings and water swings. It lands
within about one coin of the truth, the first two weeks included (an earlier
version was overconfident there; the eval caught it).

The calorie budget is learned from your own scale and your own log, in the
log's units, so a log that always misses the olive oil still works. It never
asks you to log more.

AI reads food photos and labels (Google's open Gemma model), and a coach can
plan your next days from foods you already eat. The model never does the
maths: the app checks every number it returns and refuses a plan that breaks
its rules. The same trend maths is an MCP server anyone's assistant can call
(slimchance.app/mcp, listed in the official MCP registry).

SvelteKit PWA in thin Android and iPhone shells, Supabase with row-level
security, no trackers, AGPL-3.0: https://github.com/slimchanceapp/slimchance

It's free and there's no sign-up to try it (start, and save an account
later). I'd most like to hear from people who have lost weight before and
regained it, and from anyone who can poke holes in the statistics.

**First comment** (post right after, to seed the thread):

How the chance works, briefly: a line through the last weeks' weigh-ins,
with day-to-day carry-over in the noise, so ten noisy mornings don't count
as ten independent ones. The chance is the share of plausible lines that go
the goal's way. Chapter 4 of the repo's book (docs/learn) walks through the
eval that found and fixed the early overconfidence.
