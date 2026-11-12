<script lang="ts">
  // The measure: each tab's one number in slim brass figures, and a rule under
  // it whose ticks light as the number gets there (twenty, every fifth long).
  // On Today the rule is the odds instead: ten coins, as many lit as the
  // chances in ten that the trend is really going the goal's way. On entry, and
  // whenever the data changes, the number counts and the ticks or coins light
  // together. Colour comes from `tone` (the verdict palette in app.css) and only
  // ever means data; no verdict yet is the brand's brass.
  import type { Odds } from '$lib/body';
  type Tone = 'good' | 'ok' | 'warn' | 'bad' | 'na';
  let { value = '', unit = '', caption = '', pct = null, tone = 'na', odds = null } = $props<{
    value?: string | number; unit?: string; caption?: string; pct?: number | null; tone?: Tone;
    odds?: Odds | null;
  }>();

  // A seven-segment display shows numbers only. Whatever trails the number
  // ("84g") becomes the painted unit beside it; a value with no number at all
  // ("—") shows dashes, as a scoreboard does between games.
  const parsed = $derived.by(() => {
    const s = String(value);
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const decimals = m[0].includes('.') ? m[0].split('.')[1].length : 0;
    return { num: parseFloat(m[0]), decimals, suffix: s.slice(m.index! + m[0].length).trim() };
  });
  const shownUnit = $derived(unit || parsed?.suffix || '');

  // A hero number is never red: a bad week is copper, "look here", not an
  // alarm (red read as guilt, and a big serif zero in red shouts).
  // easeOutCubic over 850 ms. The *From mirrors are plain locals, not state,
  // so reading them as the start point doesn't make the effect depend on the
  // values it writes.
  const DUR = 850;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let num = $state(0);
  let fill = $state(0);
  let numFrom = 0;
  let fillFrom = 0;
  $effect(() => {
    const toNum = parsed?.num ?? 0;
    const toFill = odds ? odds.lit * 10 : Math.max(0, Math.min(100, pct ?? 0));
    const n0 = numFrom, f0 = fillFrom, start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = still ? 1 : Math.min(1, (now - start) / DUR);
      num = numFrom = n0 + (toNum - n0) * ease(t);
      fill = fillFrom = f0 + (toFill - f0) * ease(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });

  const digits = $derived(parsed ? num.toFixed(parsed.decimals) : '--');
  const lit = $derived(Math.round(fill / 5));
  const CELLS = Array.from({ length: 20 }, (_, i) => i);
  const coins = $derived(Math.round(fill / 10));
  const COINS = Array.from({ length: 10 }, (_, i) => i);
</script>

<div class="ro tone-{tone === 'bad' ? 'warn' : tone}" role="img" aria-label={`${value}${unit ? ' ' + unit : ''}${caption ? ', ' + caption : ''}${odds ? '. ' + odds.text : ''}`}>
  <div class="ro-main">
    <span class="ro-num">{digits}</span>
    <span class="ro-side">
      {#if shownUnit}<span class="ro-unit">{shownUnit}</span>{/if}
      {#if caption}<span class="ro-cap">{caption}</span>{/if}
    </span>
  </div>
  {#if odds}
    <div class="ro-coins">{#each COINS as i}<i class="coin" class:on={i < coins}></i>{/each}</div>
    <p class="ro-odds">{odds.text}</p>
  {:else if pct != null}
    <div class="ro-rule">{#each CELLS as i}<i class:on={i < lit}></i>{/each}</div>
  {/if}
</div>

<style>
  .ro{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-lg);padding:14px 18px;color:var(--text)}
  .ro-main{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px}
  .ro-num{font-family:var(--font-display);font-stretch:72%;font-weight:700;font-size:5.25rem;line-height:.9;letter-spacing:-.01em;
    color:var(--band);font-variant-numeric:lining-nums tabular-nums;white-space:pre}
  .ro-side{display:flex;flex-direction:column;gap:3px;min-width:0}
  .ro-unit{font-family:var(--font-body);font-size:1.0625rem;font-weight:700;line-height:1;color:var(--text)}
  .ro-cap{font-family:var(--font-label);font-size:0.75rem;font-weight:700;line-height:1.3;
    text-transform:uppercase;letter-spacing:.09em;color:var(--muted);text-wrap:balance}
  .ro-rule{display:grid;grid-template-columns:repeat(20,1fr);align-items:end;height:14px;margin-top:12px;border-bottom:2px solid var(--border2)}
  .ro-rule i{justify-self:center;width:2px;height:7px;border-radius:1px 1px 0 0;background:var(--border2)}
  .ro-rule i:nth-child(5n){height:13px}
  .ro-rule i.on{background:var(--band)}
  .ro-coins{display:flex;justify-content:space-between;margin-top:14px;max-width:320px;--coin:18px}
  .ro-coins{perspective:300px}
  /* Each coin flips in and lands as it lights (2026-11-03, the owner: "coins
     flipping and landing"): on opening, and again when a weigh-in moves them. */
  /* Coins mean the chance and nothing else, and look the same wherever it
     shows: the gold coin of Today's hero (2026-11-10, the coin rule). */
  .ro-coins .coin.on{animation:ro-flip .55s var(--ease) both}
  @keyframes ro-flip{0%{transform:translateY(-10px) rotateY(180deg);opacity:.2}60%{transform:translateY(2px) rotateY(20deg);opacity:1}100%{transform:none}}
  .ro-odds{font-size:0.875rem;font-weight:700;line-height:1.35;color:var(--text);margin:8px 0 0}
</style>
