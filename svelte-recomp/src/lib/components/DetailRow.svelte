<script lang="ts">
  // A row that says what it answers and opens to the answer (Progress's
  // details, 2026-10-31). Closed, its contents aren't drawn at all: a closed
  // <details> would still mount them, photos and all.
  import type { Snippet } from 'svelte';
  let { title, hint, children }: { title: string; hint: string; children: Snippet } = $props();
  let open = $state(false);
</script>

<details class="dr" bind:open>
  <summary><span class="dr-t">{title}</span><span class="dr-h">{hint}</span></summary>
  {#if open}<div class="dr-body">{@render children()}</div>{/if}
</details>

<style>
  .dr{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-md);margin:0 0 8px}
  .dr summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;padding:12px 14px;-webkit-tap-highlight-color:transparent}
  .dr summary::-webkit-details-marker{display:none}
  .dr summary::after{content:'›';grid-row:1 / span 2;grid-column:2;align-self:center;color:var(--muted);font-size:1.25rem;line-height:1;transition:transform .2s var(--ease)}
  .dr[open] summary::after{transform:rotate(90deg)}
  .dr-t{font-size:0.9375rem;font-weight:800;color:var(--text)}
  .dr-h{font-size:0.8125rem;line-height:1.4;color:var(--muted)}
  .dr-body{padding:0 8px 4px}
  .dr-body :global(.card){margin-bottom:8px}
</style>
