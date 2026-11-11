# We tested whether our app's odds were honest. At first, they weren't.

*Substack draft, 11 Nov 2026. Link tag: `?from=substack`.*

Slim Chance tells you the chance your weight is really going your way, as
ten coins. A number like that is a promise: when it says 7 in 10, it should
be right about 7 times in 10. So we tested the promise.

## Making up people, on purpose

To check a chance you need the truth, and with real people you never know
it: nobody can tell you exactly how fast someone was really losing fat in a
given fortnight. So we made people up. Each got a true weekly rate, then
everything a real scale adds: water that swings by a kilo and lingers for
days, and mornings people skip.

Because we knew each made-up person's truth, every answer could be scored.
We asked the same question three ways: our own maths, a general AI model
reading the numbers, and the same model allowed to call our maths as a tool.

## The uncomfortable result

Over three weeks and more, all three were good. In the first ten mornings,
our maths was worse than a coin toss. It was too sure, too early: it would
show two coins for someone who was in fact losing weight, or eight for
someone who wasn't. The AI model, reading the same numbers, more often said
"too early to tell", and that was the better answer.

It was the worst place to be wrong. The first two weeks are exactly when
people decide whether an app is for them.

## The fix

Three guesses were wrong before the fourth was right. The cause: our maths
assumed each morning was a fresh fact, when in the first days the water from
one morning is still in the next. With few mornings, it couldn't yet tell
water from fat, and it pretended it could.

The fix gives it a sensible starting belief about how much mornings carry
over, and lets the person's own data take over as it comes in. Then we
checked again: about 67,000 made-up people, on nine kinds of scale, from
quiet to very noisy. The coins now land within about one coin of the truth,
the first two weeks included. And the check runs every time we change the
maths, so the promise has to keep holding.

## What it means if you use it

In your first days, Slim Chance will often say it's too early to tell. That
isn't the app being vague; it's the app being honest. After a week or two of
mornings, the coins mean what they say.

It's free, with no ads and no trackers, and the code and the test are open
for anyone to check.

[Try it at slimchance.app](https://slimchance.app/?from=substack)
