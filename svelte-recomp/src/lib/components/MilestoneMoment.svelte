<script lang="ts">
  // THE NEXT-STOP MOMENT. When the trend has stayed at or under the next stop
  // for three days (one lucky morning isn't it; see milestone.ts), Today shows
  // it once: the number, what it means, how far the trend came, and the
  // user's own reason for wanting it. Then the next stop. Not confetti: a
  // moment to read, kept in the stop history for the journal.
  import { body } from '$lib/stores/body';
  import { liveProfile } from '$lib/stores/live';
  import { todayDate } from '$lib/stores/refresh';
  import { suggestStops, HELD_DAYS, type MilestoneSetting } from '$lib/body';
  import { saveMilestone, markStopReached } from '$lib/commitments';
  import { haptic } from '$lib/haptics';
  import { wt, wtNum, wtShort } from '$lib/units';

  const _p = liveProfile();
  const setting = $derived((($_p as any)?.milestone ?? null) as MilestoneSetting | null);
  const next = $derived($body.next);
  const show = $derived(!!next && next.held && !next.celebrated && !!setting?.kg);
  const why = $derived(((($_p as any)?.why as string | null) ?? '').trim());
  const trend = $derived($body.currentKg);
  const height = $derived(($_p as any)?.height_cm ? +($_p as any).height_cm : null);
  const stops = $derived(trend != null && next ? suggestStops(trend, height, $body.goalKg).filter((k) => k < next.kg) : []);
  let saving = $state(false);
  let error = $state('');

  async function choose(kg: number | null) {
    if (!setting || saving) return;
    saving = true;
    error = '';
    try {
      if (kg == null) await markStopReached(setting, $todayDate);
      else await saveMilestone(kg, $todayDate, { ...setting, reached: setting.reached ?? $todayDate });
      haptic('success');
    } catch (e: any) {
      error = 'Could not save — ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      saving = false;
    }
  }
  const day = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
</script>

{#if show && next && trend != null}
  <section class="mm" aria-label="Next stop reached">
    <div class="mm-led" aria-hidden="true">{wtShort(next.kg)}</div>
    <h2 class="mm-h">{next.crossed ? `Out of the “${next.crossed}” range.` : 'Next stop: reached.'}</h2>
    <p class="mm-p">
      Your trend is {wt(trend)} and has stayed at or under {wtShort(next.kg)} for {HELD_DAYS} days.{#if next.fromKg != null && setting?.set}{' '}It was {wtNum(next.fromKg)} when you set this stop on {day(setting.set)}.{/if}
    </p>
    {#if why}<p class="mm-why">You said: “{why}”</p>{/if}
    {#if stops.length}
      <div class="mm-lbl">Your next stop</div>
      <div class="mm-stops">
        {#each stops as k}<button type="button" class="mm-stop" onclick={() => choose(k)} disabled={saving}>{wtShort(k)}</button>{/each}
      </div>
    {/if}
    <button type="button" class="mm-later" onclick={() => choose(null)} disabled={saving}>Choose the next one later</button>
    {#if error}<div class="mm-err">{error}</div>{/if}
  </section>
{/if}

<style>
  .mm{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r-lg);padding:18px 16px 14px;margin-bottom:14px;text-align:left}
  .mm-led{font-family:var(--font-display);font-weight:700;font-size:3.5rem;line-height:1;color:var(--led-good);letter-spacing:.02em;margin-bottom:10px}
  .mm-h{font-family:var(--font-display);font-size:1.5rem;font-weight:700;color:var(--text);margin:0 0 8px;letter-spacing:0}
  .mm-p{font-size:0.9375rem;line-height:1.5;color:var(--text);margin:0 0 8px}
  .mm-why{font-size:0.9375rem;line-height:1.5;color:var(--muted);font-style:italic;margin:0 0 12px}
  .mm-lbl{font-family:var(--font-label);font-size:0.8125rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:4px 0 6px}
  .mm-stops{display:flex;flex-wrap:wrap;gap:8px}
  .mm-stop{font-family:var(--font-display);font-size:1.125rem;font-weight:700;color:var(--text);cursor:pointer;
    background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r-sm);padding:8px 14px}
  .mm-stop:active{transform:scale(.97)}
  .mm-later{display:block;margin-top:12px;background:none;border:none;padding:0;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--muted);
    text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2);cursor:pointer}
  .mm-err{font-size:0.8125rem;color:var(--led-bad);margin-top:8px}
</style>
