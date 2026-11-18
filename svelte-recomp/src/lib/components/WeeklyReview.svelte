<script lang="ts">
  // End-of-week digest for the Progress page: turns the week's raw logs into a
  // narrative verdict plus concrete, prioritised adjustments for next week — the
  // kind of thing a good coach would text you on Sunday night. Pure aggregation
  // lives in $lib/weeklyReview; this component only feeds it live data.
  import { liveProfile } from '$lib/stores/live';
  import { weeklyReview } from '$lib/weeklyReview';
  import { reviewInputs } from '$lib/stores/review';
  import { todayDate } from '$lib/stores/refresh';
  import { dayLabel } from '$lib/date';

  const _profile = liveProfile();
  const today = $derived($todayDate);
  const proteinTargetG = $derived($reviewInputs.proteinTargetG);
  const review = $derived(weeklyReview({ ...$reviewInputs, today }));

  const fmtBal = (n: number) => (n >= 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);

  let sharing = $state(false);
  let shareMsg = $state('');

  async function share() {
    if (sharing) return;
    sharing = true;
    shareMsg = '';
    try {
      const { shareWeek } = await import('$lib/weeklyShare');
      shareMsg = await shareWeek(review, { name: ($_profile as any)?.display_name ?? null });
    } catch (e: any) {
      shareMsg = 'Share failed: ' + (e?.message || String(e)).slice(0, 100);
    } finally {
      sharing = false;
      setTimeout(() => { shareMsg = ''; }, 4000);
    }
  }
</script>

<div class="card wr">
  <div class="flex jb ac">
    <div class="card-lbl" style="margin-bottom:0">Weekly Review</div>
    <!-- Accountability without a sharing platform: the text goes to the OS share
         sheet, the user picks who gets it, and no account ever reads another's
         rows. Weight is opt-in and off by default. -->
    <button class="wr-share" onclick={share} disabled={sharing}>{sharing ? '…' : '↗ Share'}</button>
  </div>
  <div class="wr-dates">{dayLabel(review.weekStart)}–{dayLabel(review.weekEnd)}</div>
  <div class="wr-headline">{review.headline}</div>
  {#if shareMsg}<div class="wr-share-msg">{shareMsg}</div>{/if}

  <div class="wr-grid">
    <div class="wr-stat">
      <span class="wr-val" class:good={review.weightChangeKg != null && review.weightChangeKg < 0} class:bad={review.weightChangeKg != null && review.weightChangeKg > 0.2}>
        {review.weightChangeKg == null ? '—' : `${review.weightChangeKg > 0 ? '+' : ''}${review.weightChangeKg}`}
      </span>
      <span class="wr-lbl">kg this week</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.avgIntake ?? '—'}</span>
      <span class="wr-lbl">avg kcal · {review.intakeDays}d</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val" class:good={review.avgProtein != null && proteinTargetG > 0 && review.avgProtein >= proteinTargetG * 0.9}>{review.avgProtein ?? '—'}</span>
      <span class="wr-lbl">avg protein g</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.energyBalance == null ? '—' : fmtBal(review.energyBalance)}</span>
      <span class="wr-lbl">kcal vs maint.</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.sessions}</span>
      <span class="wr-lbl">training days</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val" class:good={review.tonnageDeltaPct != null && review.tonnageDeltaPct >= 3} class:bad={review.tonnageDeltaPct != null && review.tonnageDeltaPct <= -10}>
        {review.tonnageDeltaPct == null ? '—' : `${review.tonnageDeltaPct > 0 ? '+' : ''}${review.tonnageDeltaPct}%`}
      </span>
      <span class="wr-lbl">volume vs last wk</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.avgSteps ? review.avgSteps.toLocaleString() : '—'}</span>
      <span class="wr-lbl">avg steps</span>
    </div>
    <div class="wr-stat">
      <span class="wr-val">{review.avgSleep ?? '—'}</span>
      <span class="wr-lbl">avg sleep h</span>
    </div>
  </div>

  {#if review.wins.length}
    <div class="wr-sec">
      <div class="wr-sec-h wins">✓ What went well</div>
      {#each review.wins as w (w)}<div class="wr-line">{w}</div>{/each}
    </div>
  {/if}

  {#if review.adjustments.length}
    <div class="wr-sec">
      <div class="wr-sec-h adj">→ Next week</div>
      {#each review.adjustments as a (a)}<div class="wr-line">{a}</div>{/each}
    </div>
  {/if}
</div>

<style>
  .wr-dates{font-size:0.6875rem;color:var(--muted);margin:6px 0 6px}
  .wr-share{flex-shrink:0;cursor:pointer;font-size:0.6875rem;font-weight:800;color:var(--amber);
    background:var(--ab);border:1px solid color-mix(in srgb,var(--amber) 40%,transparent);
    border-radius:999px;padding:5px 11px;transition:transform .18s var(--ease)}
  .wr-share:active{transform:scale(.94)}
  .wr-share:disabled{opacity:.5}
  .wr-share-msg{font-size:0.6875rem;font-weight:700;color:var(--green);margin-bottom:6px}
  .wr-headline{font-size:0.8125rem;font-weight:700;color:var(--text);line-height:1.45;margin-bottom:12px}
  .wr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}
  .wr-stat{display:flex;flex-direction:column;align-items:center;text-align:center;background:var(--bg3);border-radius:10px;padding:8px 4px}
  .wr-val{font-size:1rem;font-weight:800;color:var(--text)}
  .wr-val.good{color:#2ecc71}
  .wr-val.bad{color:#ff6b6b}
  .wr-lbl{font-size:0.6875rem;color:var(--muted);margin-top:2px;line-height:1.2}
  .wr-sec{margin-top:10px}
  .wr-sec-h{font-size:0.75rem;font-weight:800;margin-bottom:5px}
  .wr-sec-h.wins{color:#2ecc71}
  .wr-sec-h.adj{color:var(--amber)}
  .wr-line{font-size:0.7188rem;color:var(--text);line-height:1.5;padding:3px 0 3px 2px}
  @media (max-width:420px){.wr-grid{grid-template-columns:repeat(2,1fr)}}
</style>
