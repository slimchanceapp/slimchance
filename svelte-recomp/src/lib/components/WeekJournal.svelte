<script lang="ts">
  // WEEK BY WEEK. The Sunday check-in, kept: each week's trend, the plan it
  // asked about and how it held, and the one line the user wrote. A journal
  // that writes itself a week at a time — private, and only ever in the
  // user's own words.
  import { liveDailyLogs, liveWeights } from '$lib/stores/live';
  import { journalWeeks, monthLetter } from '$lib/moments';
  import { todayDate } from '$lib/stores/refresh';
  import { changeWord, dwtNum, wtNum } from '$lib/units';

  const _daily = liveDailyLogs();
  const _weights = liveWeights();
  const points = $derived(($_weights as any[]).map((w) => ({ date: w.date, weight: +w.weight })));
  const weeks = $derived(journalWeeks($_daily as any[], points));
  // Each month opens with its letter in one line (see MonthLetter.svelte).
  const months = $derived(new Map([...new Set(weeks.map((w) => w.weekStart.slice(0, 7)))].map((m) => [m, monthLetter(m, $_daily as any[], points)])));
  const firstOfMonth = (i: number) => i === 0 || weeks[i - 1].weekStart.slice(0, 7) !== weeks[i].weekStart.slice(0, 7);
  const fmt = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
</script>

{#if weeks.length}
  <div class="card wj">
    <div class="card-lbl">Week by week</div>
    {#each weeks as w, i (w.weekStart)}
      {#if firstOfMonth(i)}
        {@const m = months.get(w.weekStart.slice(0, 7))}
        {#if m}
          <div class="wj-month">
            <b>{m.label}{m.month === $todayDate.slice(0, 7) ? ' so far' : ''}</b>
            {#if m.fromKg != null && m.toKg != null}{' '}{wtNum(m.fromKg)} → {wtNum(m.toKg)} {changeWord()}{/if}{' · '}{m.mornings}/{m.days} mornings{#if m.reviewed}{' · '}plan held {m.kept} of {m.reviewed}{/if}
          </div>
        {/if}
      {/if}
      <div class="wj-row">
        <div class="wj-top">
          <span class="wj-date">Week of {fmt(w.weekStart)}</span>
          {#if w.trendKg != null}
            <span class="wj-kg">{wtNum(w.trendKg)}{#if w.deltaKg != null}<em class:down={w.deltaKg < 0} class:up={w.deltaKg > 0}>{w.deltaKg > 0 ? '+' : w.deltaKg < 0 ? '−' : '±'}{dwtNum(w.deltaKg)}</em>{/if}</span>
          {/if}
        </div>
        {#if w.planText}<div class="wj-plan">“{w.planText}” — <b>{w.held ?? '—'}</b></div>{/if}
        {#if w.note}<div class="wj-note">{w.note}</div>{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .wj-month{font-size:0.8125rem;color:var(--muted);padding:12px 0 2px;border-bottom:1px solid var(--border)}
  .wj-month b{font-family:var(--font-label);font-size:0.9375rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text)}
  .wj-row{padding:10px 0;border-bottom:1px solid var(--border)}
  .wj-row:last-child{border-bottom:none}
  .wj-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .wj-date{font-family:var(--font-label);font-size:0.9375rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text)}
  .wj-kg{font-family:var(--font-display);font-size:1.0625rem;font-weight:700;color:var(--text);font-variant-numeric:lining-nums tabular-nums}
  .wj-kg em{font-style:normal;font-size:0.8125rem;margin-left:6px;color:var(--muted)}
  .wj-kg em.down{color:var(--led-good)}
  .wj-kg em.up{color:var(--led-warn)}
  .wj-plan{font-size:0.8125rem;line-height:1.45;color:var(--muted);margin-top:4px}
  .wj-plan b{color:var(--text)}
  .wj-note{font-size:0.875rem;line-height:1.5;color:var(--text);margin-top:5px;padding-left:9px;border-left:2px solid var(--border2)}
</style>
