<script lang="ts" module>
  /** px between views, so a neighbour never shows at the edge. */
  export const GAP = 32;
</script>

<script lang="ts">
  // A page's own tabs as one sliding row of views (Food: Today, History,
  // Recipes; Train: Upcoming, History): a tap on the row slides them (a swipe
  // always moves the main tabs, swipeTabs.ts). Every view is built once and
  // kept: the one shown first, the rest while the phone is idle, so a tap finds
  // the next one already there.
  //
  // The view shown is in the page's flow and never moved, so the row is as tall
  // as it, and its sheets (fixed to the screen) open on the screen: inside a
  // moved element they'd be fixed to that element instead (19 Nov: a workout's
  // sheet opened two screens to the left). The others wait beside it.
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
</script>

<div class="sv">
  {#each views as view, i}
    <div class="sv-view" class:on={i === index} inert={i !== index}
      style:transform={i === index ? null : `translateX(calc(${i - index} * (100% + ${GAP}px)))`}>
      {#if built.has(i)}{@render view()}{/if}
    </div>
  {/each}
</div>

<style>
  /* Clipped, with room for the cards' shadows; the gap keeps neighbours out of that room. */
  .sv{position:relative;overflow:clip;overflow-clip-margin:12px}
  .sv-view{position:absolute;top:0;left:0;width:100%;transition:transform .28s cubic-bezier(.2,.9,.25,1)}
  .sv-view.on{position:relative}
  @media (prefers-reduced-motion: reduce){.sv-view{transition:none}}
</style>
