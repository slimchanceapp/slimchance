<script lang="ts" module>
  /** px between views in the strip, so a neighbour never shows at the edge. */
  export const GAP = 32;
</script>

<script lang="ts">
  // A page's own tabs as one sliding strip (Food: Today, History, Recipes;
  // Train: Upcoming, History): a tap on the row slides them (a swipe always moves
  // the main tabs, swipeTabs.ts). Every
  // view is built once and kept: the one shown first, the rest while the phone
  // is idle, so a tap finds the next one already there. The strip is as tall as
  // the view shown.
  import type { Snippet } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { untrack } from 'svelte';

  let { index, views }: { index: number; views: Snippet[] } = $props();

  const built = new SvelteSet<number>();
  $effect(() => { const i = index; untrack(() => built.add(i)); });
  $effect(() => {
    const all = () => views.forEach((_, i) => built.add(i));
    const w = window as any;
    const id = w.requestIdleCallback ? w.requestIdleCallback(all, { timeout: 2500 }) : setTimeout(all, 800);
    return () => (w.requestIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id));
  });

  const els: HTMLElement[] = $state([]);
  let height = $state(0);
  $effect(() => {
    const el = els[index];
    if (!el) return;
    const ro = new ResizeObserver(() => (height = el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  });
</script>

<div class="sv" style:height={height ? `${height}px` : null}>
  <div class="sv-track" style:--sv-gap={`${GAP}px`} style:transform={`translateX(calc(${-index} * (100% + ${GAP}px)))`}>
    {#each views as view, i}
      <div class="sv-view" bind:this={els[i]} inert={i !== index}>
        {#if built.has(i)}{@render view()}{/if}
      </div>
    {/each}
  </div>
</div>

<style>
  /* Clipped, with room for the cards' shadows; the gap keeps neighbours out of that room. */
  .sv{overflow:clip;overflow-clip-margin:12px}
  /* A tap on the row slides the views too; a swipe sets its own timing inline. */
  .sv-track{display:flex;align-items:flex-start;gap:var(--sv-gap);transition:transform .28s cubic-bezier(.2,.9,.25,1)}
  @media (prefers-reduced-motion: reduce){.sv-track{transition:none}}
  .sv-view{flex:0 0 100%;min-width:0}
</style>
