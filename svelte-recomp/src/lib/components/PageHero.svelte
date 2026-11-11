<script lang="ts">
  // Every tab opens the same way: its name, the scoreboard readout for the
  // page's ONE number, one sentence saying what that number means, and a short
  // row of supporting numbers. Then it gets out of the way of the page's
  // action. Today passes extra content (the score's ingredients, the first-week
  // steps) as children, and its streak as `aside`.
  import type { Snippet } from 'svelte';
  import Readout from './Readout.svelte';
  import type { Odds } from '$lib/body';

  type Tone = 'good' | 'ok' | 'warn' | 'bad' | 'na';
  let {
    title, sub = '', tone = 'na', pct = null, value = '', unit = '', caption = '',
    story = '', stats = [], odds = null, aside, children
  } = $props<{
    title: string; sub?: string; tone?: Tone; pct?: number | null;
    value?: string | number; unit?: string; caption?: string; story?: string;
    stats?: Array<{ v: string | number; l: string }>; aside?: Snippet; children?: Snippet;
    odds?: Odds | null;
  }>();
</script>

<section class="phero">
  <header class="phero-top">
    <div>
      <h1 class="page-hd">{title}</h1>
      {#if sub}<div class="phero-sub">{sub}</div>{/if}
    </div>
    {@render aside?.()}
  </header>

  {#if value !== '' || odds}<Readout {value} {unit} {caption} {pct} {tone} {odds} />{/if}

  {#if story}<p class="phero-story">{story}</p>{/if}

  {@render children?.()}

  {#if stats.length}
    <div class="phero-stats">
      {#each stats as s}
        <div><b>{s.v}</b><span>{s.l}</span></div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .phero{margin-bottom:16px}
  .phero-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:10px}
  .phero-top .page-hd{margin:0}
  .phero-sub{font-size:0.8125rem;color:var(--muted);margin-top:3px}
  .phero-story{font-size:1rem;font-weight:700;line-height:1.4;color:var(--text);margin:10px 2px 0;text-wrap:pretty}
  .phero-stats{display:grid;grid-template-columns:repeat(3,1fr);margin-top:12px;
    border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:9px 0}
  .phero-stats>div{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
    border-left:1px solid var(--border);padding:0 4px;min-width:0}
  .phero-stats>div:first-child{border-left:none}
  .phero-stats b{font-family:var(--font-display);font-size:1.5rem;font-weight:700;line-height:1;
    color:var(--text);font-variant-numeric:lining-nums tabular-nums;white-space:nowrap}
  .phero-stats span{font-size:0.6875rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    color:var(--muted);text-align:center;line-height:1.2}
</style>
