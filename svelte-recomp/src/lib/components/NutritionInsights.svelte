<script lang="ts">
  // Nutrition PATTERNS across weeks, on the Food tab: how reliably protein
  // lands and whether weekends erase the weekday deficit. Never when in the day
  // food lands: entries are made ahead of meals and after them alike. Pure +
  // unit-tested; hides itself until there are a few logged days.
  import { liveFoodLogs, liveGoal, liveWeights } from '$lib/stores/live';
  import { proteinTargetG as calcProteinTarget } from '$lib/profile';
  import { nutritionPatterns } from '$lib/nutrition';

  const _food = liveFoodLogs();
  const _goal = liveGoal();
  const _weights = liveWeights();

  const currentWeight = $derived.by(() => {
    const w = [...($_weights as any[])].sort((a, b) => a.date.localeCompare(b.date));
    return w.length ? w[w.length - 1].weight : null;
  });
  const proteinTarget = $derived(Math.max(1, calcProteinTarget($_goal ?? null, currentWeight)));

  const entries = $derived(($_food as any[]).map((f) => ({
    date: f.date,
    kcal: Number(f.kcal) || 0,
    protein_g: Number(f.protein_g) || 0,
  })));

  const pat = $derived(nutritionPatterns(entries, proteinTarget, { minDays: 5 }));

</script>

{#if pat.daysLogged >= 5}
  <div class="card">
    <div class="card-lbl">Your eating patterns</div>
    <div class="np-stats">
      <div class="np-stat">
        <div class="np-v" class:warn={pat.proteinHitPct != null && pat.proteinHitPct < 50}>{pat.proteinHitPct ?? '—'}%</div>
        <div class="np-l">days protein hit</div>
      </div>
      <div class="np-stat">
        <div class="np-v">{pat.avgProtein ?? '—'}<span class="np-sub">g</span></div>
        <div class="np-l">avg protein</div>
      </div>
      <div class="np-stat">
        <div class="np-v" class:warn={pat.weekendGapKcal != null && pat.weekendGapKcal >= 300}>{pat.weekendGapKcal != null ? (pat.weekendGapKcal >= 0 ? '+' : '') + pat.weekendGapKcal : '—'}</div>
        <div class="np-l">weekend kcal gap</div>
      </div>
    </div>
    <div class="np-insights">
      {#each pat.insights as ins}
        <div class="np-ins">• {ins}</div>
      {/each}
    </div>
    <div class="np-foot">From {pat.daysLogged} logged days. Protein target ~{proteinTarget} g/day.</div>
  </div>
{/if}

<style>
  .np-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px}
  .np-stat{background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:11px;padding:9px 6px;text-align:center}
  .np-v{font-size:1.0625rem;font-weight:800;color:var(--text)}
  .np-v.warn{color:var(--amber)}
  .np-sub{font-size:0.6875rem;font-weight:600;color:var(--muted)}
  .np-l{font-size:0.6875rem;color:var(--muted);margin-top:2px;line-height:1.2}
  .np-insights{display:flex;flex-direction:column;gap:6px}
  .np-ins{font-size:0.75rem;color:var(--text);line-height:1.45}
  .np-foot{font-size:0.6875rem;color:var(--muted);margin-top:10px}
</style>
