# 0007: AI engines: Gemini when it can, Google's open Gemma for everyone

**Date:** 2026-11-10. **Amends:** 0004 (the cloud part; the phone-first part
stands, still unbuilt).

## Decision
- **Two engines, in order.** Gemini first, where Google allows it for that
  person and its prepaid balance has money. Behind it, Gemma 4, Google's open
  model built from Gemini 3 research, run by Cloudflare Workers AI. When Gemini
  says its balance is empty, the app stops asking it for ten minutes.
- **One rule decides who may use what** (`providersFor` in
  `supabase/functions/_shared/auth.ts`): Gemini where Google's terms allow it,
  Gemma for everyone, and the free text gateways (Kilo, Pollinations) only for
  typed food and recipes. Never a photo, the coach or anything personal.
- **No money, by design.** Gemma runs on the Workers Free plan's daily
  allowance, which fails instead of billing when used up. The owner does not
  fund Gemini; it stays first so it takes over again if credit ever returns.
- **Measured before switching on, and after every change of model:** the label
  test (`scripts/eval-label.mjs`, 60 real labels) and the food test
  (`scripts/eval-food.mjs`, 150 USDA foods), capped well under a day's
  allowance. No eval ever runs on a key that can cost money.

## Why
- An afternoon of eval runs on the app's own Gemini key used up its prepaid
  balance: photos, labels and the coach stopped for everyone. About 1,000 calls
  against the app's real use of about 200 a month.
- Google's terms (effective 2026-03-23) let an app serve users in the EU, the
  UK and Switzerland from Gemini's paid tier only, so its free tier could serve
  the owner and no one else: a worse app, which the owner rejected.
- Gemma's licence lets it serve everyone. Cloudflare runs it always warm (no
  cold starts), keeps nothing once it has answered and never trains on it.
  Modal, the first choice for running our own copy, refuses every GPU without a
  card on file, and keeping a GPU warm would cost hundreds a month.
- Measured: 53 of 60 labels within 10% on energy (one "miss" was the database
  being wrong), and a typical error of 10% on 150 typed foods, with no lean.

## What would change it
- Gemma's answers getting worse in real use, or the free allowance running out
  on ordinary days (about 1,300 label reads a day).
- Money for AI from somewhere other than the owner (a grant, credits): then
  Gemini, or a stronger model, goes in front.
- Phones that can run a good model themselves (0004).
