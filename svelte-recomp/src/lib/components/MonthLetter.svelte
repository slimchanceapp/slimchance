<script lang="ts">
  // THE LETTER FROM LAST MONTH. On the 1st to the 3rd, Today opens with the
  // month just gone, told back in the app's numbers and the user's own Sunday
  // words (journal.ts monthLetter). Remembering is what keeping weight off runs
  // on, and a solo journey has nobody else to do the remembering. It stays
  // in the Progress journal after it's put away.
  import { liveDailyLogs, liveWeights, liveProfile } from '$lib/stores/live';
  import { todayDate } from '$lib/stores/refresh';
  import { lastMonth, monthLetter } from '$lib/moments';
  import type { MilestoneSetting } from '$lib/body';
  import { dwt, wt, wtNum, wtShortU } from '$lib/units';

  const _daily = liveDailyLogs();
  const _weights = liveWeights();
  const _p = liveProfile();
  const KEY = 'recompos.letter.put-away';
  let putAway = $state<string | null>(null);
  try { putAway = localStorage.getItem(KEY); } catch { /* private mode: show it */ }

  const month = $derived(lastMonth($todayDate));
  const early = $derived(+$todayDate.slice(8, 10) <= 3);
  const letter = $derived.by(() => {
    if (!early || putAway === month) return null;
    const m = (($_p as any)?.milestone ?? null) as MilestoneSetting | null;
    const stops = [...(m?.history ?? []), ...(m?.kg && m.reached ? [{ kg: m.kg, set: m.set, reached: m.reached }] : [])];
    return monthLetter(month, $_daily as any[], ($_weights as any[]).map((w) => ({ date: w.date, weight: +w.weight })), stops);
  });
  function close() {
    putAway = month;
    try { localStorage.setItem(KEY, month); } catch { /* fine: it's back tomorrow */ }
  }
  const fmt = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const held = $derived(!letter ? '' : letter.kept === 0
    ? `Your plan didn't hold the ${letter.reviewed === 1 ? 'week' : `${letter.reviewed} weeks`} it was asked about.`
    : letter.kept === letter.reviewed ? `Your plan held every week it was asked about.`
    : `Your plan held ${letter.kept} of the ${letter.reviewed} weeks it was asked about.`);
</script>

{#if letter}
  <section class="ml" aria-label="{letter.label}, looking back">
    <div class="ml-h">{letter.label}, looking back</div>
    {#if letter.fromKg != null && letter.toKg != null && letter.deltaKg != null}
      <p class="ml-p">
        <b>{wtNum(letter.fromKg)} → {wt(letter.toKg)}.</b>
        {Math.abs(letter.deltaKg) < 0.2 ? 'The trend held.' : letter.deltaKg < 0 ? `The trend came down ${dwt(letter.deltaKg)}.` : `The trend went up ${dwt(letter.deltaKg)}.`}
      </p>
    {/if}
    <p class="ml-p">
      You weighed in on {letter.mornings} of {letter.days} mornings.{#if letter.reviewed}{' '}{held}{/if}
    </p>
    {#each letter.stops as s}<p class="ml-p ml-stop">Next stop reached: <b>{wtShortU(s.kg)}</b> on {fmt(s.reached)}.</p>{/each}
    {#if letter.notes.length}
      <div class="ml-lbl">What you wrote</div>
      {#each letter.notes as n (n.weekStart)}
        <div class="ml-note"><span>Week of {fmt(n.weekStart)}</span>{n.note}</div>
      {/each}
    {/if}
    <button type="button" class="ml-close" onclick={close}>Put it away</button>
  </section>
{/if}

<style>
  .ml{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r-lg);padding:16px 16px 12px;margin-bottom:14px}
  .ml-h{font-family:var(--font-display);font-size:1.375rem;font-weight:700;color:var(--text);letter-spacing:0;margin-bottom:8px}
  .ml-p{font-size:0.9375rem;line-height:1.5;color:var(--text);margin:0 0 6px}
  .ml-stop b{color:var(--led-good)}
  .ml-lbl{font-family:var(--font-label);font-size:0.8125rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:12px 0 6px}
  .ml-note{font-size:0.9375rem;line-height:1.5;color:var(--text);padding-left:10px;border-left:2px solid var(--border2);margin-bottom:8px}
  .ml-note span{display:block;font-size:0.75rem;color:var(--muted)}
  .ml-close{display:block;margin-top:8px;background:none;border:none;padding:0;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--muted);
    text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2);cursor:pointer}
</style>
