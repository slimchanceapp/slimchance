# 0006: One app with a guarded pure core; boundaries before folders

**Date:** 2026-11-10.

## Decision
- **One app, not services.** Slim Chance stays a single codebase and a single
  deploy (a *modular monolith*).
- **A pure core, guarded.** The modules that hold the domain's logic take data
  in and give data out, and reach nothing outside: no storage, network,
  browser, database or stores, directly or through an import. They are listed
  in `svelte-recomp/scripts/pure-core.txt` (53 of 71 today), and a check fails
  when one stops being pure. Side effects live in adapters: screens, stores,
  sync, the MCP route, the phone shells, the AI provider chain.
- **The areas are named before they get folders.** The context map in the
  book (chapter 5) names each area and its modules. Files move into an area's
  own folder only once a check shows that area's boundary holds, one area at a
  time (the *strangler* way), starting with Body.

## Why
- The worry raised on 2026-11-05 was blast radius: a change in one place
  breaking another. Here that happens through logic leaking into the wrong
  layer, not through deployment, so the boundary that matters is in the code.
- The pure core is why the MCP server took a day: the maths could be called
  from a server without knowing about screens or storage.
- A check costs minutes; moving a hundred files costs days and breaks every
  open line of thought. Checks first, folders when they're earned.
- The first measurement found a real leak: `units.ts` read browser storage
  when imported, so 15 core modules (the MCP server among them) depended on
  it. Fixed the same day, and the check now fails if it comes back.

## What would change it
A second developer working in parallel, or one area needing its own deploy or
its own limits (for example the MCP server under heavy outside traffic).

## Progress
- **2026-11-11: Body moved** into `svelte-recomp/src/lib/body`, behind
  `index.ts` (reading) and `weighIn.ts` (saving a weigh-in), with a check on
  both directions of its border. Same behaviour (all checks and the personas
  snapshot unchanged), same size (1,075,462 bytes of JavaScript before,
  1,075,458 after), same speed (the trend maths timed in both trees). Book
  chapter 5 has what the move found.
- **2026-11-11: Nutrition moved** into `svelte-recomp/src/lib/nutrition`
  behind `index.ts`, with `foodLog.ts` and `foodSources.ts` as its shell
  doors; it builds only on Body's door. The border check became one rule for
  every area. Same behaviour, same speed; the first screen ended 160 bytes
  lighter after the size check caught a 3.6 KB slip on the way.
- **2026-11-11: Training moved** into `svelte-recomp/src/lib/training`
  behind `index.ts`, with `logActivity.ts` as its shell door; it builds on no
  other area. The watch-workout maths left `health/` and joined the pure
  core; a dead checklist file was deleted. Same behaviour, speed and size.
- **2026-11-11: Health signals moved** into `svelte-recomp/src/lib/health`
  beside the Health Connect adapters, behind `index.ts`; Health Connect is
  reached only through `healthConnect.ts`, `writeBack.ts` and `watches.ts`.
  Muscle recovery went to Training first; dead load code went. Built output
  byte-for-byte unchanged.
- **2026-11-11: Metrics moved** into `svelte-recomp/src/lib/metrics`: the
  "is it for you?" question behind `index.ts`, events counted only through
  `events.ts`. **Identity and data stays the platform** (`db/`, `stores/`):
  every area reads and writes through it, so a border around it would guard
  nothing. Left: Moments and Coach, as one slice (each reads the other).
