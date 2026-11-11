<script lang="ts">
  // The editors for what the user commits to: the next stop below them, the
  // ceiling above them, and the plans (with the reason behind them). Mounted
  // once on Today; opened from the commitments row, the alerts or the plan
  // strip (all through `editing`).
  //
  // Ceiling and next stop are opposite directions, and people typed their next
  // goal into the ceiling when only one of them existed. So each editor
  // names its direction, and a ceiling typed below the trend is offered as the
  // next stop instead of being saved as a ceiling you're already 8 kg over.
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import { editing, saveLine, savePlans, saveWhy, saveMilestone } from '$lib/commitments';
  import { CUES, cleanPlans, type Plans } from '$lib/plans';
  import { suggestLine } from '$lib/body';
  import { suggestStops, milestoneState, type MilestoneSetting } from '$lib/body';
  import { line, body } from '$lib/stores/body';
  import { liveProfile } from '$lib/stores/live';
  import { todayDate } from '$lib/stores/refresh';
  import { haptic } from '$lib/haptics';
  import WeightInput from './WeightInput.svelte';
  import { dwt, unitWord, weightUnit, wt, wtShort, wtShortU } from '$lib/units';

  // "Next stop, kg"; in stone the boxes say st and lb themselves.
  const inUnit = weightUnit() === 'st' ? '' : `, ${unitWord()}`;
  const margin = weightUnit() === 'kg' ? 'a kilo' : 'about 2 lb';

  const _profile = liveProfile();
  const plans = $derived(cleanPlans(($_profile as any)?.plans));
  const drawn = $derived(!!($_profile as any)?.line);
  const trend = $derived($body.currentKg);
  const height = $derived(($_profile as any)?.height_cm ? +($_profile as any).height_cm : null);

  let lineKg = $state<number | null>(null);
  let linePlan = $state('');
  let nextKg = $state<number | null>(null);
  let draft = $state<Plans>({});
  let whyDraft = $state('');
  let saving = $state(false);
  let error = $state('');

  // Fill the editor once, when it opens — never while the user is typing, even
  // if a sync lands underneath.
  $effect(() => {
    const open = $editing;
    untrack(() => {
      error = '';
      if (open === 'line') {
        lineKg = $line && !$line.misdrawn ? $line.kg : trend != null ? suggestLine(trend) : null;
        linePlan = plans.line ?? '';
      } else if (open === 'plans') {
        draft = { ...plans };
        whyDraft = (($_profile as any)?.why ?? '').trim();
      } else if (open === 'next') {
        nextKg = $body.next ? $body.next.kg : null;
      }
    });
  });

  // A "ceiling" under where you are is a target: offer it as the next stop.
  const ceilingIsTarget = $derived(trend != null && lineKg != null && lineKg < trend - 0.5);
  const nextPreview = $derived(nextKg != null ? milestoneState({ kg: nextKg, set: '' }, trend, height) : null);
  const stops = $derived(trend != null ? suggestStops(trend, height, $body.goalKg) : []);

  const close = () => editing.set(null);

  async function run(fn: () => Promise<void>) {
    if (saving) return;
    saving = true;
    error = '';
    try {
      await fn();
      haptic('success');
      close();
    } catch (e: any) {
      error = 'Could not save — ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      saving = false;
    }
  }

  const weight = (kg: number | null) => {
    if (kg == null || !(kg > 30 && kg < 400)) throw new Error('that isn’t a weight');
    return kg;
  };
  const keepLine = () => run(async () => {
    await saveLine(weight(lineKg), $todayDate);
    await savePlans({ ...plans, line: linePlan });
  });
  const milestone = $derived((($_profile as any)?.milestone ?? null) as MilestoneSetting | null);
  const lineAsNextStop = () => run(async () => {
    await saveMilestone(weight(lineKg), $todayDate, milestone);
    if (drawn) await saveLine(null, $todayDate);
  });
  const removeLine = () => run(() => saveLine(null, $todayDate));
  const keepNext = () => run(() => saveMilestone(weight(nextKg), $todayDate, milestone));
  const removeNext = () => run(() => saveMilestone(null, $todayDate, milestone));
  const keepPlans = () => run(async () => {
    await savePlans(draft);
    if (whyDraft.trim() !== ((($_profile as any)?.why ?? '').trim())) await saveWhy(whyDraft);
  });
</script>

<Modal open={$editing === 'next'} onclose={close}>
  <div class="cm-h">Your next stop</div>
  <p class="cm-lede">
    A weight below you, on the way to your goal — near enough to steer by on a Friday night. When the
    trend gets there, pick the next one.
  </p>
  <label class="cm-lbl" for="cm-next-kg">Next stop{inUnit}</label>
  <WeightInput id="cm-next-kg" bind:kg={nextKg} label="Next stop" />
  {#if nextPreview}
    <div class="cm-hint">
      {#if nextPreview.toGoKg != null}{nextPreview.toGoKg > 0 ? `${dwt(nextPreview.toGoKg)} below your trend` : 'Already there'}{/if}{#if nextPreview.bmi != null}{' · '}BMI {nextPreview.bmi.toFixed(1)}{/if}{#if nextPreview.meaning}{' · '}{nextPreview.meaning}{/if}
    </div>
  {/if}
  {#if stops.length}
    <div class="cm-stops">
      {#each stops as k}<button type="button" class="cm-stop" class:on={nextKg === k} onclick={() => (nextKg = k)}>{wtShort(k)}</button>{/each}
    </div>
  {/if}
  <button class="btn bp bfl cm-go" onclick={keepNext} disabled={saving}>{saving ? 'Saving…' : 'Save my next stop'}</button>
  {#if $body.next}<button class="btn bg_ bfl cm-go" onclick={removeNext} disabled={saving}>Remove it</button>{/if}
  {#if error}<div class="cm-err">{error}</div>{/if}
</Modal>

<Modal open={$editing === 'line'} onclose={close}>
  <div class="cm-h">Your ceiling</div>
  <p class="cm-lede">
    The weight your trend doesn't go back above. It sits {margin} above where you are now. Each time a lower
    trend holds for a week, the ceiling comes down to {margin} above it, and it never goes back up on its own.
  </p>
  <p class="cm-why">
    It's the system from the trial that taught people to keep weight off (STOP Regain): weigh most mornings,
    and decide now what you'll do the day the trend goes over it.
  </p>
  <label class="cm-lbl" for="cm-line-kg">Ceiling{inUnit}</label>
  <WeightInput id="cm-line-kg" bind:kg={lineKg} label="Ceiling" />
  {#if trend != null}<div class="cm-hint">Your trend today: {wt(trend)}{#if $line?.heldLowKg != null}{' · '}lowest held trend {wt($line.heldLowKg)}{/if}</div>{/if}
  {#if ceilingIsTarget}
    <div class="cm-turn">
      <b>{wt(lineKg)} is below where you are.</b> A ceiling sits above you; a weight you're heading down to is a next stop.
      <button class="btn bp bfl cm-go" onclick={lineAsNextStop} disabled={saving}>Make {wtShortU(lineKg)} my next stop</button>
    </div>
  {:else}
    <label class="cm-lbl" for="cm-line-plan">If my trend goes over it, I'll…</label>
    <textarea id="cm-line-plan" rows="2" bind:value={linePlan} placeholder={CUES[0].suggestion}></textarea>
    {#if !linePlan}<button type="button" class="cm-use" onclick={() => (linePlan = CUES[0].suggestion)}>Use this one</button>{/if}
    <button class="btn bp bfl cm-go" onclick={keepLine} disabled={saving}>{saving ? 'Saving…' : drawn ? 'Save my ceiling' : 'Set my ceiling'}</button>
  {/if}
  {#if drawn}<button class="btn bg_ bfl cm-go" onclick={removeLine} disabled={saving}>Remove the ceiling</button>{/if}
  {#if error}<div class="cm-err">{error}</div>{/if}
</Modal>

<Modal open={$editing === 'plans'} onclose={close}>
  <div class="cm-h">Your plans</div>
  <p class="cm-lede">
    Decide now, so Friday-night you doesn't have to. One plan for each moment that tends to go wrong; it
    shows on Today when that moment comes round. Plans made like this, ahead of time and this specific,
    make people clearly more likely to follow through: a medium-to-large effect across 94 studies.
  </p>
  <label class="cm-lbl" for="pl-why">Why you're doing this</label>
  <textarea id="pl-why" rows="2" bind:value={whyDraft} placeholder="In your own words. Nobody else sees it."></textarea>
  <div class="cm-hint">It comes back when a plan is tested: over your ceiling, and in the Sunday check-in.</div>
  {#each CUES as c (c.cue)}
    <div class="pl-row">
      <label class="cm-lbl" for="pl-{c.cue}">{c.when}</label>
      <textarea id="pl-{c.cue}" rows="2" bind:value={draft[c.cue]} placeholder={c.suggestion}></textarea>
      {#if !draft[c.cue]}<button type="button" class="cm-use" onclick={() => (draft[c.cue] = c.suggestion)}>Use this one</button>{/if}
    </div>
  {/each}
  <button class="btn bp bfl cm-go" onclick={keepPlans} disabled={saving}>{saving ? 'Saving…' : 'Save my plans'}</button>
  {#if error}<div class="cm-err">{error}</div>{/if}
</Modal>

<style>
  .cm-h{font-family:var(--font-display);font-size:1.5rem;font-weight:700;color:var(--text);margin-bottom:8px;letter-spacing:0}
  .cm-lede{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 8px}
  .cm-why{font-size:0.8125rem;line-height:1.5;color:var(--muted);margin:0 0 14px}
  .cm-lbl{display:block;font-family:var(--font-label);font-size:0.875rem;font-weight:700;text-transform:uppercase;
    letter-spacing:.08em;color:var(--muted);margin:12px 0 6px}
  .cm-hint{font-size:0.75rem;color:var(--muted);margin-top:6px;line-height:1.45}
  .cm-use{background:none;border:none;padding:6px 0 0;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--text);
    text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2);cursor:pointer}
  .cm-go{margin-top:14px}
  .cm-go + .cm-go{margin-top:8px}
  .cm-err{font-size:0.8125rem;color:var(--led-bad);text-align:center;margin-top:8px}
  .cm-turn{font-size:0.875rem;line-height:1.5;color:var(--text);margin-top:12px;padding:11px 12px;
    background:color-mix(in srgb,var(--led-ok) 8%,var(--bg3));border-radius:var(--r-md)}
  .cm-stops{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .cm-stop{font-family:var(--font-display);font-size:1rem;font-weight:700;color:var(--text);cursor:pointer;
    background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r-sm);padding:6px 12px}
  .cm-stop.on{border-color:var(--text)}
  .pl-row textarea{resize:vertical}
</style>
