<script lang="ts">
  // The way to the goal on Progress (src/lib/slimTrack.ts): a path from the
  // first weigh-in to the goal, filled as far as the trend has come, with a
  // stop at every tenth. Not coins: coins mean the chance (the coin rule,
  // 2026-11-10). The healthy-weight line is a mark on the path and a number,
  // never a category word.
  import { body } from '$lib/stores/body';
  import { slimTrack } from '$lib/body';
  import { wtShortU } from '$lib/units';
  const t = $derived(slimTrack({ startKg: $body.firstKg, goalKg: $body.goalKg, currentKg: $body.currentKg, heightCm: $body.profile?.heightCm ?? null }));
  const next = $derived(t?.stops.find((s) => s.next) ?? null);
  const pct = $derived(t ? Math.round(t.at * 100) : 0);
</script>

{#if t}
  <section class="card st" aria-label="Your way to {wtShortU($body.goalKg!)}: {pct}% of the way">
    <div class="st-head"><span class="card-lbl">Your way to {wtShortU($body.goalKg!)}</span><span class="st-n"><b>{pct}%</b> of the way</span></div>
    <div class="st-path">
      <span class="st-fill" style="width:{t.at * 100}%"></span>
      {#each t.stops as s, i}<i class:passed={s.passed} style="left:{(i + 1) * 10}%" title={wtShortU(s.kg)}></i>{/each}
      {#if t.healthyAt != null}<span class="st-healthy" style="left:{t.healthyAt * 100}%" title="Healthy weight starts here"></span>{/if}
    </div>
    <div class="st-ends"><span>{wtShortU($body.firstKg!)} start</span><span>{wtShortU($body.goalKg!)} goal</span></div>
    <p class="st-next">{#if next}Next stop: <b>{wtShortU(next.kg)}</b>.{:else}You’re at your goal.{/if}</p>
    {#if t.bmi != null}
      <p class="st-bmi">BMI {t.bmi}{#if t.healthyKg != null}{' · '}the healthy range starts at {wtShortU(t.healthyKg)}{#if t.healthyAt != null}, the green mark on your path{/if}{/if}.</p>
    {/if}
  </section>
{/if}

<style>
  .st-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px}
  .st-head .card-lbl{margin:0}
  .st-n{font-size:0.8125rem;color:var(--muted)}
  .st-n b{font-family:var(--font-display);font-size:1.25rem;color:var(--text)}
  .st-path{position:relative;height:12px;border-radius:6px;background:var(--bg3);margin:4px 0}
  .st-fill{position:absolute;left:0;top:0;bottom:0;border-radius:6px;background:linear-gradient(90deg,var(--blue),var(--green));transform-origin:left;animation:st-grow .9s var(--ease) both}
  /* Stops are ticks across the path, never round: round is a coin. */
  .st-path i{position:absolute;top:-3px;width:2px;height:18px;margin-left:-1px;border-radius:1px;background:var(--border2)}
  .st-path i:last-of-type{width:4px;margin-left:-4px}
  .st-path i.passed{background:var(--bg2)}
  .st-healthy{position:absolute;top:-6px;width:4px;height:24px;margin-left:-2px;border-radius:2px;background:var(--led-good)}
  .st-ends{display:flex;justify-content:space-between;font-size:0.75rem;color:var(--muted);margin-top:8px}
  .st-next{font-size:0.875rem;line-height:1.45;color:var(--text);margin:10px 0 0}
  .st-bmi{font-size:0.8125rem;line-height:1.45;color:var(--muted);margin:6px 0 0}
  @keyframes st-grow{from{transform:scaleX(0)}to{transform:none}}
</style>
