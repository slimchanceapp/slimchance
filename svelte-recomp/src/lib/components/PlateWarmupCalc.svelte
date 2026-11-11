<script lang="ts">
  import { calculatePlates, warmupLadder, DEFAULT_BAR_KG, DEFAULT_PLATES_KG } from '$lib/training';

  let { targetKg = 60 }: { targetKg?: number } = $props();

  let open = $state<'plates' | 'warmup' | null>(null);
  // Seed the editable field from the target, and re-seed whenever the target
  // changes (opening the calc for a different lift) — while still letting the
  // user type over it. Reading the prop inside an effect (not the $state
  // initialiser) keeps it reactive instead of frozen at the first value.
  let weightInput = $state('');
  $effect(() => { weightInput = String(targetKg); });

  const parsedWeight = $derived(parseFloat(weightInput) || 0);
  const plateResult = $derived(calculatePlates(parsedWeight));
  const warmupSets = $derived(warmupLadder(parsedWeight));

  // Colors matching standard Olympic plate color-coding, purely visual.
  const PLATE_COLOR: Record<number, string> = {
    25: '#e53e3e', 20: '#3b82f6', 15: '#eab308', 10: '#22c55e', 5: '#e5e7eb', 2.5: '#9ca3af', 1.25: '#6b7280',
  };
</script>

<div class="calc-toggles">
  <button class="btn bg_ bsm" onclick={() => open = open === 'plates' ? null : 'plates'}>🏋 Plates</button>
  <button class="btn bg_ bsm" onclick={() => open = open === 'warmup' ? null : 'warmup'}>📈 Warm-up</button>
</div>

{#if open}
  <div class="calc-panel">
    <label class="flbl" for="calc-weight">Target weight (kg)</label>
    <input id="calc-weight" type="number" inputmode="decimal" bind:value={weightInput} style="margin-bottom:10px">

    {#if open === 'plates'}
      {#if parsedWeight <= DEFAULT_BAR_KG}
        <div class="calc-empty">Just the bar ({DEFAULT_BAR_KG}kg) — no plates needed.</div>
      {:else}
        <div class="plate-row">
          {#each plateResult.perSide as plate}
            <div class="plate-disc" style="background:{PLATE_COLOR[plate] ?? '#888'}">{plate}</div>
          {/each}
        </div>
        <div class="calc-note">
          Per side, heaviest first &middot; {DEFAULT_BAR_KG}kg bar
          {#if !plateResult.exact}
            <br><span class="calc-warn">Closest achievable: {plateResult.achievedKg}kg (target {parsedWeight}kg)</span>
          {/if}
        </div>
      {/if}
    {:else}
      {#if warmupSets.length === 0}
        <div class="calc-empty">Weight too light for a warm-up ladder — just get after it.</div>
      {:else}
        {#each warmupSets as ws, i}
          <div class="warmup-step">
            <span class="ws-idx">Set {i + 1}</span>
            <span class="ws-pct">{ws.pct.toFixed(0)}%</span>
            <span class="ws-weight">{ws.weight}kg</span>
            <span class="ws-reps">× {ws.reps}</span>
          </div>
        {/each}
        <div class="warmup-step final">
          <span class="ws-idx">Work</span>
          <span class="ws-pct">100%</span>
          <span class="ws-weight">{parsedWeight}kg</span>
          <span class="ws-reps">— go</span>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .calc-toggles{display:flex;gap:8px;margin-top:6px}
  .calc-panel{margin-top:8px;padding:10px;background:var(--bg3);border-radius:10px}
  .calc-panel input{background:var(--bg2)}
  .calc-empty{font-size:0.75rem;color:var(--muted);text-align:center;padding:8px 0}
  .calc-warn{color:#ffd166}
  .plate-row{display:flex;align-items:flex-end;gap:4px;flex-wrap:wrap;margin-bottom:6px}
  .plate-disc{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.6875rem;font-weight:800;color:#0e1117;box-shadow:inset 0 0 0 2px rgba(255,255,255,.25)}
  .calc-note{font-size:0.6875rem;color:var(--muted);text-align:center}
  .warmup-step{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:0.75rem;border-bottom:1px solid var(--border)}
  .warmup-step.final{font-weight:800;color:var(--amber)}
  .ws-idx{width:44px;color:var(--muted);flex-shrink:0}
  .ws-pct{width:38px;color:var(--muted)}
  .ws-weight{flex:1;font-weight:700}
  .ws-reps{color:var(--muted)}
</style>
