# 0004: AI runs on the phone first, and never does the maths

**Date:** 2026-11-10. **Amended by** [0007](0007-ai-engines-gemini-then-gemma.md): in the cloud,
Google's open Gemma now stands behind Gemini. The phone-first part below stands, still unbuilt.

## Decision
- **The phone's own model comes first.** Where the phone ships one (Gemini
  Nano on recent Android phones through ML Kit's Prompt API, Apple's
  on-device model on recent iPhones, Chrome's built-in model on the web), the
  text jobs try it before the cloud: the evening note, the morning line,
  reading a typed meal. The cloud chain (`supabase/functions/_shared/llm.ts`:
  Gemini, then two free fallbacks) stays behind it for every other phone and
  for photos.
- **A job moves to the phone only when it passes the same tests.** Each job
  gets a golden set of cases graded by the checks the app already runs on AI
  output (`checkReply` and friends). The phone model and the cloud run the
  same set; the better pass rate takes the job.
- **The AI is the voice, the reader and the planner, never the calculator.**
  The trend, the chance, the budget and the floor stay plain, tested maths.
  The model calls those functions as tools: the same tools the MCP server
  will offer outside assistants.
- **Learning is memory and feedback, not retraining on the phone.** The app's
  statistics already learn (burn, eating rhythm, trained days). The model
  reads the person's own history when it writes (retrieval), and every
  correction (an edited photo estimate) becomes a new test case.

## Not doing
- **Shipping our own model inside the app.** Even a small one is 125 to
  600 MB, and the app is a thin shell that loads the website. A download that
  size pushes out the people on cheap phones whom the mission is for.
- **Running the app through a model.** A model can give a different number
  each time; a chance that changes on a re-ask is not an honest chance
  (0002), and a test can't pin a dice roll.

## Why
The owner asked (2026-11-10) for a free AI that lives in the app and updates
over the air. The phone makers already ship that, update it themselves and
keep the data on the device. What they don't ship is a model that does
arithmetic reliably, so the split above keeps both promises.

## What would change it
Small models passing our golden sets as often as the cloud on mid-range
phones, and the Android WebView running them reliably: then an optional
model download becomes worth its size.

## Next step (2026-11-11)
- **What exists:** ML Kit's GenAI Prompt API (beta) reaches Gemini Nano
  through Android's AICore on phones with recent Snapdragon, Dimensity and
  Tensor chips: check the model's status (available, downloadable or
  unavailable), download it, warm it up, generate. There is a per-app
  quota, and it is validated for English. It needs native code, so it means
  a new app build and a Play review.
- **First, a probe:** Diagnostics shows whether this phone has a model,
  shipped in one native build with the home-screen widget, after the
  morning-briefing test (both touch the moments machinery).
- **Then the test that decides:** the evening note's golden set
  (`scripts/eval-coach.mjs`) run on the phone through a hidden Diagnostics
  button, graded by `checkReply`, against the cloud's pass rate. The job
  moves only if the phone does at least as well.
- Sources: [Prompt API, get started](https://developers.google.com/ml-kit/genai/prompt/android/get-started),
  [Android Developers blog, May 2025](https://android-developers.googleblog.com/2025/05/on-device-gen-ai-apis-ml-kit-gemini-nano.html).
- **2026-11-11, later:** the owner's phone is a Pixel 7, which isn't on
  Google's lists for on-device Gemini Nano (the Prompt API appears to need
  Pixel 9 or 10 class phones), and neither are the cheap phones the mission
  is for. The probe waits for a supported phone to test on; the cloud chain
  (Gemma, free) serves everyone meanwhile.
