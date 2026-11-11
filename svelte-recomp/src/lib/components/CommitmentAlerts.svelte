<script lang="ts">
  // The two moments the commitments speak up on Today: the trend over the line,
  // and a plan whose moment has come round (Friday evening, the weekend, home
  // from badminton…). Renders nothing the rest of the time — silence on the
  // ordinary days is what makes these worth reading.
  import { line } from '$lib/stores/body';
  import { liveProfile } from '$lib/stores/live';
  import { editing, saveMilestone, saveLine } from '$lib/moments/commitments';
  import { todayDate } from '$lib/stores/refresh';
  import { changeWord, dwtNum, wt, wtNum, wtShortU } from '$lib/units';
  import { activePlan, cleanPlans, type PlanMoment } from '$lib/moments';

  let { moment }: { moment: Omit<PlanMoment, 'overLine'> } = $props();

  const _profile = liveProfile();
  const plans = $derived(cleanPlans(($_profile as any)?.plans));
  // A ceiling drawn under where you were is a target someone put in the wrong
  // box (it happened): offer to move it, never call them 8 kg "over".
  const misdrawn = $derived($line != null && $line.misdrawn);
  const over = $derived($line != null && !$line.misdrawn && $line.zone !== 'under');
  const why = $derived((($_profile as any)?.why ?? '').trim());
  // The line has its own card; the strip shows the moment's other plan.
  const plan = $derived(activePlan({ ...plans, line: undefined }, { ...moment, overLine: over }));

  let moving = $state(false);
  async function moveToNext() {
    if (!$line || moving) return;
    moving = true;
    try {
      await saveMilestone($line.kg, $todayDate);
      await saveLine(null, $todayDate);
    } catch (e) { console.error('Move to next stop failed:', e);
    } finally { moving = false; }
  }
</script>

{#if misdrawn && $line}
  <div class="ca ca-line tone-ok">
    <span class="ca-k">That's a next stop, not a ceiling</span>
    <span class="ca-t">You set {wt($line.kg)}, below your trend of {wtNum($line.trendKg)}. A ceiling sits above you; {wtShortU($line.kg)} is a weight you're heading down to.</span>
    <button class="btn bp bsm ca-fix" onclick={moveToNext} disabled={moving}>{moving ? 'Moving…' : `Make ${wtShortU($line.kg)} my next stop`}</button>
  </div>
{:else if over && $line}
  <button class="ca ca-line tone-{$line.zone === 'well-over' ? 'bad' : 'warn'}" onclick={() => editing.set('line')}>
    <span class="ca-k">{$line.zone === 'well-over' ? 'Well over your ceiling' : 'Over your ceiling'} <b>+{dwtNum($line.overKg)}</b> {changeWord()}</span>
    <span class="ca-t">{plans.line ?? 'You haven’t decided what happens now. Decide it once, here.'}</span>
    {#if why}<span class="ca-why">You said: “{why}”</span>{/if}
    <span class="ca-f">Trend {wtNum($line.trendKg)} · ceiling {wtNum($line.kg)}. One week over is a signal, not a verdict.</span>
  </button>
{/if}

{#if plan}
  <button class="ca" onclick={() => editing.set('plans')}>
    <span class="ca-k">{plan.label} · your plan</span>
    <span class="ca-t">{plan.then}</span>
  </button>
{/if}

<style>
  .ca{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;cursor:pointer;font-family:inherit;color:inherit;
    background:var(--bg2);border:1px solid var(--border);
    border-radius:var(--r-lg);padding:11px 13px;margin-bottom:12px;
    transition:transform .18s var(--ease)}
  .ca:active{transform:scale(.99)}
  .ca-line{background:color-mix(in srgb,var(--band) 8%,var(--bg2))}
  .ca-k{font-family:var(--font-label);font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  .ca-line .ca-k{color:var(--band)}
  .ca-k b{font-family:var(--font-display);font-size:1.125rem;letter-spacing:0;margin-left:6px}
  .ca-t{font-size:0.9375rem;font-weight:700;line-height:1.4;color:var(--text)}
  .ca-f{font-size:0.75rem;line-height:1.45;color:var(--muted)}
  .ca-fix{align-self:flex-start;margin-top:4px}
  .ca-why{font-size:0.8125rem;font-weight:700;line-height:1.4;color:var(--text);padding-left:9px;border-left:2px solid var(--border2)}
</style>
