<script lang="ts">
  // The coach arranges the rest of your training week (pact m14, 2026-11-10):
  // your own sessions, walks and rest over the days left. src/lib/trainPlan.ts
  // refuses anything else: never a new exercise or load, never more sessions
  // than are left, spaced out, and an easy day when your body asks for one.
  // Only for people who turned the coach on, like the meal plan (CoachPlan).
  import { coachOn, coachNotes } from '$lib/stores/brain';
  import { todayDate } from '$lib/stores/refresh';
  import { liveBiometrics } from '$lib/stores/live';
  import { readyToday } from '$lib/readiness';
  import { shiftYmd, mondayOf } from '$lib/date';
  import { supabase } from '$lib/db/client';
  import { checkTrainPlan, type CheckedTrainPlan, type TrainDay } from '$lib/trainPlan';
  import { trainPlan } from '$lib/stores/trainPlan';

  let { sessions, left, doneDates }: { sessions: string[]; left: number; doneDates: string[] } = $props();

  const _bio = liveBiometrics();
  const today = $derived($todayDate as string);
  const noon = (s: string) => new Date(`${s}T12:00:00`);
  const monday = $derived(mondayOf(noon(today)));
  const sunday = $derived(shiftYmd(6, noon(monday)));
  // From today (unless today's training is already in) to Sunday.
  const days = $derived.by(() => {
    const out: string[] = [];
    for (let d = doneDates.includes(today) ? shiftYmd(1, noon(today)) : today; d <= sunday; d = shiftYmd(1, noon(d))) out.push(d);
    return out;
  });
  const ready = $derived.by(() => {
    const rows = ($_bio as any[]) ?? [];
    const since = shiftYmd(-14, noon(today));
    return readyToday(rows.find((b) => b.date === today), rows.filter((b) => b.date < today && b.date >= since));
  });
  const easyToday = $derived(ready?.word === 'Low');
  // Kept (stores/trainPlan) so it's still here after a reload; past days drop off.
  const plan = $derived.by(() => {
    const ds = $trainPlan?.days.filter((d) => d.date >= today) ?? [];
    return $trainPlan && ds.length ? { ...$trainPlan, days: ds } : null;
  });

  let busy = $state(false);
  let err = $state('');
  async function ask() {
    busy = true; err = '';
    let got: CheckedTrainPlan | null = null;
    const facts: Record<string, unknown> = {
      today, days, sessions, sessionsLeft: left, doneDates: doneDates.filter((d) => d >= monday),
      easyToday, readiness: ready?.word ?? null, notes: $coachNotes ?? '',
    };
    for (let attempt = 0; attempt < 2 && !got && !err; attempt++) {
      const { data, error } = await supabase.functions.invoke('coach', { body: { mode: 'train', facts }, timeout: 55_000 });
      if (error || data?.error) { err = data?.error ?? 'Your coach couldn’t be reached. Try again in a minute.'; break; }
      const checked = checkTrainPlan(data?.reply, { days, sessions, left, easyToday, today });
      if (checked.ok) got = checked;
      else facts.problem = checked.why;
    }
    if (got) trainPlan.set(got);
    else if (!err) err = 'Your coach couldn’t fit your week inside the rules this time. Try again in a minute.';
    busy = false;
  }

  const dayName = (s: string) => (s === today ? 'Today' : noon(s).toLocaleDateString('en-GB', { weekday: 'short' }));
  const what = (d: TrainDay) => (d.kind === 'session' ? d.session : d.kind === 'walk' ? `Walk · ${d.minutes} min` : 'Rest');
</script>

{#if $coachOn && sessions.length && days.length}
  <section class="card tp" aria-label="Your week, arranged by your coach">
    <div class="card-lbl">Your week, arranged</div>
    {#if plan}
      <ul class="tp-days">
        {#each plan.days as d (d.date)}
          <li class:tp-today={d.date === today} class:tp-session={d.kind === 'session'}><b>{dayName(d.date)}</b><span>{what(d)}</span>{#if d.why}<em>{d.why}</em>{/if}</li>
        {/each}
      </ul>
      {#if plan.note}<p class="tp-note">{plan.note}</p>{/if}
    {:else}
      <p class="tp-lead">Your coach places your own sessions over the days left{easyToday ? ', with an easy day today' : ''}, with walks and rest between. Never a new exercise.</p>
    {/if}
    <button class="btn {plan ? 'bg_' : 'bp'} bfl" disabled={busy} onclick={ask}>{busy ? 'Your coach is planning…' : plan ? 'Plan again' : 'Plan my week'}</button>
    {#if err}<p class="tp-err">{err}</p>{/if}
  </section>
{/if}

<style>
  .tp-lead{font-size:0.875rem;line-height:1.5;color:var(--muted);margin:0 0 12px}
  .tp-days{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:6px}
  .tp-days li{display:grid;grid-template-columns:3.5rem 1fr;column-gap:10px;align-items:baseline;padding:8px 10px;border-radius:var(--r-md);background:var(--bg3)}
  .tp-days li b{font-size:0.8125rem;color:var(--muted)}
  .tp-days li span{font-size:0.9375rem;color:var(--text)}
  .tp-days li em{grid-column:2;font-style:normal;font-size:0.8125rem;color:var(--muted);margin-top:2px}
  .tp-days li.tp-session span{font-weight:700}
  .tp-days li.tp-today{outline:2px solid var(--amber);outline-offset:-2px}
  .tp-note{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 10px}
  .tp-err{font-size:0.8125rem;color:var(--led-warn);margin:8px 0 0}
</style>
