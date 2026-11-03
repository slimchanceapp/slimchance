<script lang="ts">
  // The Slim Chance track on Progress (src/lib/slimTrack.ts): ten coins from
  // the first weigh-in to the goal. Passed ones flip in and land; the next one
  // breathes, with the odds as they stand. The healthy-weight line is a mark
  // on the track and a number, never a category word.
  import { body, todayPulse } from '$lib/stores/body';
  import { slimTrack } from '$lib/slimTrack';
  import { wtShortU } from '$lib/units';
  const t = $derived(slimTrack({ startKg: $body.firstKg, goalKg: $body.goalKg, currentKg: $body.currentKg, heightCm: $body.profile?.heightCm ?? null }));
  const next = $derived(t?.coins.find((c) => c.next) ?? null);
</script>

{#if t}
  <section class="card st" aria-label="Your slim chance: {t.landed} of 10 coins landed">
    <div class="st-head"><span class="card-lbl">Your slim chance</span><span class="st-n"><b>{t.landed}</b> of 10 coins</span></div>
    <div class="st-track">
      {#each t.coins as c, i}<i class:landed={c.landed} class:next={c.next} style="--i:{i}" title={wtShortU(c.kg)}></i>{/each}
      {#if t.healthyAt != null}<span class="st-healthy" style="left:calc({t.healthyAt * 100}% - 5%)" title="Healthy weight starts here"></span>{/if}
    </div>
    <div class="st-ends"><span>{wtShortU($body.firstKg!)} start</span><span>{wtShortU($body.goalKg!)} goal</span></div>
    <p class="st-next">{#if next}Next coin at <b>{wtShortU(next.kg)}</b>. {$todayPulse.odds?.text ?? ''}{:else}All ten landed: you’re at your goal.{/if}</p>
    {#if t.bmi != null}
      <p class="st-bmi">BMI {t.bmi}{#if t.healthyKg != null}{' · '}the healthy range starts at {wtShortU(t.healthyKg)}{#if t.healthyAt != null}, the mark on your track{/if}{/if}.</p>
    {/if}
  </section>
{/if}

<style>
  .st-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
  .st-head .card-lbl{margin:0}
  .st-n{font-size:0.8125rem;color:var(--muted)}
  .st-n b{font-family:var(--font-display);font-size:1.25rem;color:var(--amber)}
  .st-track{position:relative;display:grid;grid-template-columns:repeat(10,1fr);justify-items:center;padding:6px 0;perspective:300px}
  .st-track::before{content:'';position:absolute;left:5%;right:5%;top:50%;height:2px;background:var(--border2);transform:translateY(-50%)}
  .st-track i{position:relative;width:22px;height:22px;border-radius:50%;border:2px solid var(--border2);background:var(--bg2)}
  .st-track i.landed{background:var(--amber);border-color:var(--amber);animation:st-land .6s var(--ease) both;animation-delay:calc(var(--i) * 80ms)}
  .st-track i.next{border-color:var(--amber);animation:st-breathe 2.4s ease-in-out infinite}
  .st-healthy{position:absolute;top:0;bottom:0;width:2px;background:var(--led-good);border-radius:1px}
  .st-ends{display:flex;justify-content:space-between;font-size:0.75rem;color:var(--muted);margin-top:6px}
  .st-next{font-size:0.875rem;line-height:1.45;color:var(--text);margin:10px 0 0}
  .st-bmi{font-size:0.8125rem;line-height:1.45;color:var(--muted);margin:6px 0 0}
  @keyframes st-land{0%{transform:translateY(-14px) rotateY(180deg);opacity:0}60%{transform:translateY(2px) rotateY(20deg);opacity:1}100%{transform:none}}
  @keyframes st-breathe{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--amber) 40%,transparent)}50%{box-shadow:0 0 0 6px transparent}}
</style>
