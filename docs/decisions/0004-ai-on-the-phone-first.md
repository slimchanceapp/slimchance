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
