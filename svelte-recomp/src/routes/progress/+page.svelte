<script lang="ts">
  // The Progress tab: one screen that answers "is this working?"
  //
  // Everything here is derived from data the app was ALREADY collecting — weigh-ins,
  // logged sets, body-fat measurements, food. None of it needed new input; it just
  // had nowhere to be read together. See $lib/recomp.ts for the reasoning.
  import { liveWeights, liveWorkoutLogs, liveTracks, liveFoodLogs, liveGoal, liveActivitySessions } from '$lib/stores/live';
  import { body, stall, fitness, line, todayPulse } from '$lib/stores/body';
  import { editing } from '$lib/commitments';
  import { cleanPlans } from '$lib/plans';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';
  import Commitments from '$lib/components/Commitments.svelte';
  import WeightInput from '$lib/components/WeightInput.svelte';
  import { strengthTrend } from '$lib/strength';
  import { recompVerdict, verdictTone, leanMass, fatMass, type BodyFatPoint } from '$lib/recomp';
  import { liveProfile } from '$lib/stores/live';
  import { nowTick } from '$lib/stores/refresh';
  import { shiftYmd } from '$lib/date';
  import { proteinByTrainingDay, watchAgreement } from '$lib/insights';
  import MiniChart from '$lib/components/MiniChart.svelte';
  import { changeWord, dwt, dwtNum, toUnit, unitWord, weightUnit, wt, wtNum, wtShort, wtShortU } from '$lib/units';
  import WeeklyReview from '$lib/components/WeeklyReview.svelte';
  import BodyGoals from '$lib/components/BodyGoals.svelte';
  import ProgressPhotos from '$lib/components/ProgressPhotos.svelte';
  import PageHero from '$lib/components/PageHero.svelte';
  import WeekShape from '$lib/components/WeekShape.svelte';
  import WeekJournal from '$lib/components/WeekJournal.svelte';
  import WeightLine from '$lib/components/WeightLine.svelte';
  import DetailRow from '$lib/components/DetailRow.svelte';
  import { onMount, tick } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { base } from '$app/paths';

  // Body & Goals lives here now, not on Today. Today answers "what do I do
  // right now"; this screen answers "where is my body going" — and the numbers
  // that drive the verdict below (height, body fat, goal weight) belong beside
  // the verdict, not on a different tab.
  let showBodyGoals = $state(false);
  async function openBodyGoalsFromHash() {
    if (typeof location === 'undefined') return;
    // #goal: the goal moment's "aim a little lower" lands on the goal, open.
    if (location.hash === '#goal') { editingGoal = true; goalEditKg = null; }
    else if (location.hash === '#body-goals') showBodyGoals = true;
    else return;
    await tick();
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  onMount(openBodyGoalsFromHash);
  afterNavigate(openBodyGoalsFromHash);

  const _weights = liveWeights();
  const _logs = liveWorkoutLogs();
  const _tracks = liveTracks();
  const _foodLogs = liveFoodLogs();
  const _goal = liveGoal();
  const _activity = liveActivitySessions();

  const _profile = liveProfile();
  const goalKg = $derived($_goal ?? null);

  // Goals and plans (from Today, 2026-10-31): the goal edits in place; the
  // next stop, the ceiling and the plans open their editors (Commitments).
  let editingGoal = $state(false);
  let goalEditKg = $state<number | null>(null);
  async function saveGoal() {
    if (!$userId || goalEditKg == null) { editingGoal = false; return; }
    try {
      await upsertRecord('user_settings', { user_id: $userId, goal_kg: goalEditKg, updated_at: new Date().toISOString() });
      editingGoal = false;
    } catch (e) { console.error('Goal save failed:', e); }
  }
  const planCount = $derived(Object.keys(cleanPlans(($_profile as any)?.plans)).length);

  const weightPoints = $derived(
    ($_weights as any[]).map((w) => ({ date: w.date, weight: w.weight }))
  );
  // The trend, its interval and the pace verdict all come from stores/body —
  // the same numbers Today and the coach show.
  const wv = $derived($body.weight);
  const strength = $derived(strengthTrend($_logs as any, { asOf: $nowTick }));
  const currentWeight = $derived($body.currentKg);
  const proteinTargetG = $derived($body.proteinTargetG);

  // Body-fat readings live in `tracks` (name='body_fat'). Each needs the
  // bodyweight from the same day to become a composition point — we take the
  // nearest weigh-in, since the two are rarely logged at the same moment.
  const bodyFatPoints = $derived.by((): BodyFatPoint[] => {
    const weights = weightPoints;
    if (!weights.length) return [];
    const nearestWeight = (date: string): number | null => {
      let best: { d: number; w: number } | null = null;
      const t = new Date(date + 'T12:00:00').getTime();
      for (const w of weights) {
        const d = Math.abs(new Date(w.date + 'T12:00:00').getTime() - t);
        if (!best || d < best.d) best = { d, w: w.weight };
      }
      // A weigh-in more than 10 days from the measurement isn't the same body.
      return best && best.d <= 10 * 86400000 ? best.w : null;
    };
    return ($_tracks as any[])
      .filter((t) => t.name === 'body_fat' && t.value > 0)
      .map((t) => {
        const w = nearestWeight(t.date);
        return w ? { date: t.date, bfPct: t.value, weightKg: w } : null;
      })
      .filter(Boolean) as BodyFatPoint[];
  });

  // Protein adherence over the last 14 days.
  const proteinAdherence = $derived.by(() => {
    const cutoff = shiftYmd(-14);
    const byDate = new Map<string, number>();
    for (const f of $_foodLogs as any[]) {
      if (f.date < cutoff) continue;
      byDate.set(f.date, (byDate.get(f.date) ?? 0) + (f.protein_g || 0));
    }
    let hit = 0;
    for (const g of byDate.values()) if (g >= proteinTargetG * 0.9) hit++;
    return { logged: byDate.size, hit };
  });

  const liftingSessions14 = $derived.by(() => {
    const cutoff = shiftYmd(-14);
    const days = new Set<string>();
    for (const l of $_logs as any[]) if (l.date >= cutoff) days.add(l.date);
    return days.size;
  });

  const verdict = $derived(
    recompVerdict({
      weightRateKgPerWeek: wv?.rateKgPerWeek ?? 0,
      trendSpanDays: wv?.spanDays ?? 0,
      currentWeightKg: currentWeight,
      strength,
      bodyFat: bodyFatPoints,
      proteinTargetG,
      proteinDaysHit: proteinAdherence.hit,
      proteinDaysLogged: proteinAdherence.logged,
      liftingSessions14
    })
  );

  const tone = $derived(verdictTone(verdict.direction));

  // Composition over time, when body fat has been measured more than once —
  // the chart that actually matters on a recomp: fat mass falling while lean
  // mass stays flat.
  const compositionSeries = $derived.by(() => {
    const pts = [...bodyFatPoints].sort((a, b) => a.date.localeCompare(b.date));
    return {
      fat: pts.map((p) => ({ date: p.date, value: +toUnit(fatMass(p.weightKg, p.bfPct)).toFixed(1) })),
      lean: pts.map((p) => ({ date: p.date, value: +toUnit(leanMass(p.weightKg, p.bfPct)).toFixed(1) }))
    };
  });

  const sportSessions14 = $derived.by(() => {
    const cutoff = shiftYmd(-14);
    return ($_activity as any[]).filter((a) => a.date >= cutoff && a.kind !== 'strength').length;
  });


  function kg(n: number) { return dwt(n, 2); }
  const rateWord = $derived(wv && wv.rateKgPerWeek >= 0 ? 'down' : 'up');

  // Does protein collapse on the days the body is actually repairing? Keyed on
  // hand-logged lift dates, not watch sessions: the lift log has months of
  // history where activity_sessions has days, and an insight is only as old as
  // its thinnest input.
  const proteinSplit = $derived.by(() => {
    const byDate = new Map<string, { protein: number; kcal: number }>();
    for (const f of $_foodLogs as any[]) {
      const cur = byDate.get(f.date) ?? { protein: 0, kcal: 0 };
      cur.protein += f.protein_g || 0;
      cur.kcal += f.kcal || 0;
      byDate.set(f.date, cur);
    }
    const liftDates = new Set(($_logs as any[]).map((l) => l.date));
    return proteinByTrainingDay(byDate, liftDates, proteinTargetG);
  });

  // Two instruments, one claim. The only thing in this app that can be
  // independently corroborated.
  const watchCheck = $derived.by(() => {
    const cutoff = shiftYmd(-28);
    const hand = new Set(($_logs as any[]).filter((l) => l.date >= cutoff).map((l) => l.date));
    const sessions = ($_activity as any[])
      .filter((a) => a.date >= cutoff)
      .map((a) => ({ date: a.date, duration_min: a.duration_min, kind: a.kind }));
    return watchAgreement(hand, sessions);
  });

  // Am I getting there: the same pulse every screen shares (stores/body).
  const p = $derived($todayPulse);
</script>

<!-- Am I getting there? One number, the odds and the pace (stores/body
     todayPulse: the hero Today had until 2026-10-31), then the line. -->
<PageHero title="Progress" sub="Am I getting there?" tone={p.tone} pct={p.pct}
  value={p.kg != null ? wtNum(p.kg) : '—'} caption={p.caption} story={p.story} odds={p.odds} />

<WeightLine />

{#snippet foot()}
  <div class="trust-foot">
    Everything here is built on this. Weigh yourself at the same time each
    morning, before food or drink — same conditions is what makes the readings
    comparable.
  </div>
{/snippet}

{#if $stall}
  <!-- WHY THE SCALE ISN'T MOVING. Only once the trend has ruled the plan out.
       The arithmetic first, then where the room is in this person's own week —
       never "log more": a log that leaves the same things out every week is a
       consistent ruler, and the target is set in its units. -->
  <div class="card stall-card" id="why-stalled">
    <div class="card-lbl">Why the scale isn't moving</div>
    <div class="trust-head">At what you log, your weight {$body.pace === 'gaining' ? 'creeps up' : 'holds'}.</div>
    <div class="trust-body">
      Over the last five weeks your logged days averaged <b>{$stall.avgKcal.toLocaleString()} kcal</b>
      and the trend {$body.pace === 'gaining' ? 'went up' : 'stayed flat'}.
      {#if $body.target.basis === 'learned' && $body.target.target}
        So this week's target is <b>{$body.target.target.toLocaleString()}</b> — set from that, one step at a time.
      {/if}
      {#if $stall.missingAtLeastKcal != null}
        Your log runs at least ~{$stall.missingAtLeastKcal} under what a body your size burns: the oil, the extras, the
        bites. Everyone's does, and it's fine — the target is in the same units, so it cancels. Don't log more; log the same way.
      {/if}
    </div>
    {#if $stall.clues.length}
      <ul class="stall-clues">
        {#each $stall.clues as c}<li><b>{c.title}</b>{c.detail}</li>{/each}
      </ul>
    {/if}
    <div class="trust-foot">
      The target moves every Monday from the trend. Weighing most mornings is what lets it move on evidence instead of noise.
    </div>
  </div>
{/if}

<!-- The other thing people want to know: am I getting fitter? Heart and lifts
     decide it; training and steps sit beside them. -->
<h2 class="sec-hd">Getting fitter?</h2>
<div class="card fit-card">
  <div class="trust-head">{$fitness.headline}</div>
  {#if $fitness.signs.length}
    <ul class="fit-signs">
      {#each $fitness.signs as s (s.key)}<li class:good={s.good === true} class:bad={s.good === false}>{s.text}</li>{/each}
    </ul>
  {/if}
  {#if $fitness.state === 'not-enough'}
    <div class="trust-foot">A watch that records your resting heart rate, or two weeks of logged lifts, lets this answer properly.</div>
  {/if}
</div>

<!-- How was my week? An answer, not a detail. -->
<h2 class="sec-hd">This week</h2>
<WeeklyReview />

<!-- The rest, one row each, named for what it answers and drawn when opened. -->
<h2 class="sec-hd">Details</h2>
<DetailRow title="Fat or muscle?" hint="Whether it's fat coming off, and what to change">
  <div class="card verdict-card verdict-{tone}">
    <div class="verdict-tone-bar"></div>
    <div class="verdict-head">{verdict.headline}</div>
    <div class="verdict-detail">{verdict.detail}</div>
    <div class="verdict-conf">
      Confidence: <strong>{verdict.confidence}</strong>
      {#if verdict.confidence !== 'high'}
        · more data sharpens this
      {/if}
    </div>
  </div>
  
  {#if verdict.composition && verdict.composition.fatShare != null}
    <div class="card">
      <div class="card-lbl">Measured body composition</div>
      <div class="comp-split">
        <div class="comp-box">
          <div class="comp-v good">{verdict.composition.fatKg > 0 ? '−' : '+'}{dwt(verdict.composition.fatKg)}</div>
          <div class="comp-l">fat</div>
        </div>
        <div class="comp-box">
          <div class="comp-v" class:bad={verdict.composition.leanKg > 0.5}>
            {verdict.composition.leanKg > 0 ? '−' : '+'}{dwt(verdict.composition.leanKg)}
          </div>
          <div class="comp-l">lean mass</div>
        </div>
        <div class="comp-box">
          <div class="comp-v">{Math.round(verdict.composition.fatShare * 100)}%</div>
          <div class="comp-l">of loss was fat</div>
        </div>
      </div>
      <div class="comp-bar">
        <div class="comp-bar-fat" style="width:{Math.round(verdict.composition.fatShare * 100)}%"></div>
      </div>
      <div class="comp-foot">
        Over {verdict.composition.spanDays} days, measured — not inferred.
      </div>
    </div>
  {/if}
  
  {#if verdict.levers.length > 0}
    <div class="card">
      <div class="card-lbl">What to change</div>
      {#each verdict.levers as lever, i}
        <div class="lever">
          <span class="lever-n">{i + 1}</span>
          <span class="lever-t">{lever}</span>
        </div>
      {/each}
    </div>
  {/if}
  
  <div class="card">
    <div class="card-lbl">Last 14 days</div>
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-v">{liftingSessions14}</div>
        <div class="stat-l">lifting sessions</div>
        <div class="stat-hint">6+ is the target</div>
      </div>
      <div class="stat">
        <div class="stat-v">{sportSessions14}</div>
        <div class="stat-l">sport / cardio</div>
        <div class="stat-hint">from your watch</div>
      </div>
      <div class="stat">
        <div class="stat-v">{proteinAdherence.hit}<span class="stat-sub">/{proteinAdherence.logged || 0}</span></div>
        <div class="stat-l">protein days hit</div>
        <div class="stat-hint">of days you logged</div>
      </div>
      <div class="stat">
        <div class="stat-v">{$body.target.target ?? '—'}</div>
        <div class="stat-l">kcal a day</div>
        <div class="stat-hint">this week's target</div>
      </div>
    </div>
  </div>
  {#if verdict.composition && compositionSeries.fat.length >= 2}
    <div class="card">
      <div class="card-lbl">Fat mass vs lean mass</div>
      <MiniChart data={compositionSeries.fat} color="var(--red)" unit={` ${changeWord()} fat`} />
      <div style="margin-top:12px"></div>
      <MiniChart data={compositionSeries.lean} color="var(--green, #2ecc71)" unit={` ${changeWord()} lean`} />
      <div class="comp-foot">
        The shape you want: the red line falling, the green line flat or rising.
      </div>
    </div>
  {/if}

  <div class="card">
    <div class="card-lbl">The evidence</div>
    {#each verdict.evidence as e}
      <div class="ev-row">
        <span class="ev-label">{e.label}</span>
        <span class="ev-value ev-{e.verdict}">{e.value}</span>
      </div>
    {/each}
  </div>
</DetailRow>
{#if wv}
  <DetailRow title="How sure is the trend?" hint="How much your mornings let it say">
    <div class="card trust-card" class:trust-solid={wv.state === 'answerable'}>
      <div class="card-lbl">
        {wv.state === 'answerable' ? '✓ This screen can answer you'
          : $body.pace === 'stalled' || $body.pace === 'gaining' ? '◑ Enough to rule out your plan'
          : '◔ Not enough to answer yet'}
      </div>
  
      {#if wv.state === 'answerable'}
        <div class="trust-head">
          Your weight is going <strong>{rateWord} {kg(wv.rateKgPerWeek)}</strong> a week.
        </div>
        <div class="trust-body">
          Your weigh-ins scatter about <b>&plusmn;{dwt(wv.scatterKg)}</b> around that line,
          so the true rate is between <b>{kg(Math.min(Math.abs(wv.loKgPerWeek), Math.abs(wv.hiKgPerWeek)))}</b> and <b>{kg(Math.max(Math.abs(wv.loKgPerWeek), Math.abs(wv.hiKgPerWeek)))}</b> a week.
          That range doesn't include zero — so this is a real trend, not scale noise.
        </div>{@render foot()}
      {:else if wv.state === 'not-enough'}
        <div class="trust-head">
          {wv.n} weigh-in{wv.n === 1 ? '' : 's'} isn't enough to tell you anything honest.
        </div>
        <div class="trust-body">
          Body weight swings a kilo or two a day on water and food alone, so a
          handful of readings can't separate a real trend from noise.
          <b>{wv.weighInsNeeded} more</b> and this screen starts working.
        </div>
      {:else if $body.pace === 'stalled'}
        <div class="trust-head">
          Not losing at your planned pace.
        </div>
        <div class="trust-body">
          Across {wv.n} weigh-ins your readings scatter <b>&plusmn;{dwt(wv.scatterKg)}</b>, which
          puts the real rate between <b>{kg(wv.loKgPerWeek)} {wv.loKgPerWeek >= 0 ? 'down' : 'up'}</b> and
          <b>{kg(wv.hiKgPerWeek)} {wv.hiKgPerWeek >= 0 ? 'down' : 'up'}</b> a week. Your plan is
          <b>{$body.target.planKgPerWeek != null ? dwt($body.target.planKgPerWeek, 2) : '—'} down</b> — outside that range. A little loss or none,
          it isn't the plan.
        </div>{@render foot()}
      {:else}
        <div class="trust-head">
          Can't call it yet — the noise is bigger than the signal.
        </div>
        <div class="trust-body">
          Across {wv.n} weigh-ins your readings scatter <b>&plusmn;{dwt(wv.scatterKg)}</b>
          around the trend line. That puts the real rate somewhere between
          <b>{kg(wv.loKgPerWeek)} {wv.loKgPerWeek >= 0 ? 'down' : 'up'}</b> and
          <b>{kg(wv.hiKgPerWeek)} {wv.hiKgPerWeek >= 0 ? 'down' : 'up'}</b> per week —
          a range that includes "no change at all", so any verdict below is a guess.
          {#if wv.daysUntilAnswer}
            Weighing most mornings, we'd know in about <b>{wv.daysUntilAnswer} days</b>.
          {/if}
        </div>{@render foot()}
      {/if}
      {#if wv.state === 'not-enough'}{@render foot()}{/if}
    </div>
  </DetailRow>
{/if}
<DetailRow title="Your weeks" hint="Where the food goes in your week, and your Sunday notes">
  <WeekShape />
  <WeekJournal />
</DetailRow>
<DetailRow title="Photos and body fat" hint="Progress photos, and body fat from a photo">
  <ProgressPhotos />
</DetailRow>
{#if proteinSplit}
  <DetailRow title="Protein on gym days" hint="Whether training days run short of protein">
    <div class="card">
      <div class="card-lbl">Protein drops on the days you train</div>
      <div class="trust-body">
        Across your <b>{proteinSplit.liftDays}</b> logged gym days you averaged
        <b>{proteinSplit.liftAvgG} g</b> of protein — <b>{proteinSplit.gapG} g less</b>
        than your {proteinSplit.restDays} non-gym days, and
        <b>{proteinSplit.shortOfTargetG} g under</b> your {Math.round(proteinTargetG)} g target.
      </div>
    </div>
  </DetailRow>
{/if}
{#if watchCheck && watchCheck.handLoggedDays > 0}
  <DetailRow title="Does your watch agree?" hint="Your logged lifting days against the watch">
    <div class="card">
      <div class="trust-body">
        Fat or muscle rests on <b>{watchCheck.handLoggedDays}</b> lifting
        {watchCheck.handLoggedDays === 1 ? 'day' : 'days'} you logged in the last 28.
        Your watch independently recorded a session on
        <b>{watchCheck.confirmedDays}</b> of them.
        {#if watchCheck.unloggedByHand > 0}
          It also caught <b>{watchCheck.unloggedByHand}</b>
          {watchCheck.unloggedByHand === 1 ? 'session' : 'sessions'} you never logged.
        {/if}
      </div>
    </div>
  </DetailRow>
{/if}

<!-- What you've committed to: the next stop below you, the goal past it, the
     ceiling above you that you don't go back over, and what you'll do when the
     hard moments come. Goals are about getting there, so they live here. -->
<h2 class="sec-hd" id="goal" style="scroll-margin-top:12px">Goals and plans</h2>
<div class="cm-row">
  <button class="cm-chip" onclick={() => editing.set('next')}><span>Next stop</span><b class:cm-todo={!$body.next}>{$body.next ? `${wtShortU($body.next.kg)}${$body.next.reached ? ' ✓' : ''}` : 'Set'}</b></button>
  {#if editingGoal}
    <!-- svelte-ignore a11y_autofocus -->
    <WeightInput class="cm-goal-in" bind:kg={goalEditKg} label="Goal weight" onenter={saveGoal} onblur={saveGoal} autofocus />
  {:else}
    <button class="cm-chip" onclick={() => { editingGoal = true; goalEditKg = goalKg; }}><span>Goal</span><b class:cm-todo={goalKg == null}>{goalKg != null ? wtShortU(goalKg) : 'Set'}</b></button>
  {/if}
  <button class="cm-chip" onclick={() => editing.set('line')}><span>Ceiling</span><b class:cm-todo={!$line || $line.misdrawn}>{$line && !$line.misdrawn ? wt($line.kg) : 'Set'}</b></button>
  <button class="cm-chip" onclick={() => editing.set('plans')}><span>Plans</span><b class:cm-todo={!planCount}>{planCount || 'Make'}</b></button>
</div>
<Commitments />

<div class="card" id="body-goals" style="margin-top:14px;scroll-margin-top:12px">
  <div class="flex jb ac" style="cursor:pointer" onclick={() => showBodyGoals = !showBodyGoals} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBodyGoals = !showBodyGoals; } }}>
    <div class="card-lbl" style="margin-bottom:0">Body &amp; Goals</div>
    <span style="color:var(--muted);font-size:0.8125rem">{showBodyGoals ? 'Hide ▲' : 'Log weight, goals, projections ▼'}</span>
  </div>
</div>
{#if showBodyGoals}
  <BodyGoals />
{/if}

<style>
  .fit-signs{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:7px}
  .fit-signs li{position:relative;padding-left:20px;font-size:0.875rem;line-height:1.45;color:var(--text)}
  .fit-signs li::before{content:'–';position:absolute;left:2px;top:0;font-weight:800;color:var(--muted)}
  .fit-signs li.good::before{content:'↑';color:var(--led-good)}
  .fit-signs li.bad::before{content:'↓';color:var(--led-warn)}
  .sec-hd{font-family:var(--font-display);font-size:1.375rem;font-weight:700;line-height:1.1;color:var(--text);margin:26px 2px 10px}
  .cm-row{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:2px 0 14px}
  .cm-chip{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0;cursor:pointer;font-family:inherit;color:inherit;
    background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-md);padding:9px 11px;text-align:left;
    transition:transform .18s var(--ease),border-color .15s}
  .cm-chip:active{transform:scale(.97)}
  .cm-chip span{font-family:var(--font-label);font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  .cm-chip b{font-family:var(--font-display);font-size:1.25rem;font-weight:700;line-height:1;color:var(--text);white-space:nowrap}
  .cm-chip b.cm-todo{color:var(--muted);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2)}
  :global(.cm-goal-in){text-align:center;min-width:0}
  /* The honesty card. Deliberately the first thing on the screen: it says how
     much weight to put on everything below it. */
  /* Cards carry their meaning in a faint wash of its colour, not a stripe. */
  .trust-card{border-radius:var(--r-lg)}
  .trust-card.trust-solid{background:color-mix(in srgb,var(--led-good) 8%,var(--bg2))}
  .trust-head{font-size:1.0625rem;font-weight:800;color:var(--text);line-height:1.35;margin:2px 0 7px}
  .trust-body{font-size:0.875rem;color:var(--text);line-height:1.55}
  .trust-foot{font-size:0.8125rem;color:var(--muted);line-height:1.5;margin-top:10px;padding-top:9px;border-top:1px solid var(--border)}
  /* The diagnosis wears the verdict's colour: it only exists when the plan is
     ruled out. */
  .stall-card{border-radius:var(--r-lg);background:color-mix(in srgb,var(--led-warn) 8%,var(--bg2))}
  .stall-clues{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
  .stall-clues li{font-size:0.8125rem;line-height:1.5;color:var(--muted);background:var(--bg3);border-radius:var(--r-md);padding:9px 11px}
  .stall-clues b{display:block;font-size:0.875rem;color:var(--text);margin-bottom:2px}
  .card-sub{font-size:0.7188rem;color:var(--muted);line-height:1.45;margin:-4px 0 10px}
  /* Plain-language meaning, attached to the number it explains rather than
     hidden in a help screen nobody opens. */
  .explain{display:block;margin-top:7px;font-size:0.7188rem;color:var(--muted);line-height:1.55}
  .stat-hint{font-size:0.6875rem;color:var(--muted);opacity:.8;margin-top:2px;line-height:1.3}

  .verdict-card{position:relative;overflow:hidden}
  .verdict-tone-bar{position:absolute;left:0;top:0;bottom:0;width:4px}
  .verdict-good .verdict-tone-bar{background:var(--green,#2ecc71)}
  .verdict-warn .verdict-tone-bar{background:var(--amber)}
  .verdict-bad .verdict-tone-bar{background:var(--red)}
  .verdict-neutral .verdict-tone-bar{background:var(--border2)}
  .verdict-head{font-size:1.1875rem;font-weight:800;color:var(--text);line-height:1.25;margin-bottom:8px;padding-left:10px}
  .verdict-detail{font-size:0.8125rem;color:var(--text);line-height:1.55;padding-left:10px}
  .verdict-conf{font-size:0.6875rem;color:var(--muted);margin-top:10px;padding-left:10px;text-transform:lowercase}

  .comp-split{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
  .comp-box{text-align:center}
  .comp-v{font-size:1.0625rem;font-weight:800;color:var(--text)}
  .comp-v.good{color:var(--green,#2ecc71)}
  .comp-v.bad{color:var(--red)}
  .comp-l{font-size:0.6875rem;color:var(--muted);margin-top:2px}
  .comp-bar{height:8px;border-radius:999px;background:var(--red);overflow:hidden}
  .comp-bar-fat{height:100%;background:var(--green,#2ecc71)}
  .comp-foot{font-size:0.6875rem;color:var(--muted);margin-top:8px;line-height:1.45;text-align:center}

  .ev-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:0.7812rem}
  .ev-label{color:var(--muted)}
  .ev-value{font-weight:700;text-align:right}
  .ev-good{color:var(--green,#2ecc71)}
  .ev-warn{color:var(--amber)}
  .ev-bad{color:var(--red)}
  .ev-neutral{color:var(--muted)}
  .ev-foot{font-size:0.6875rem;color:var(--muted);margin-top:8px;line-height:1.4}

  .lever{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border)}
  .lever:last-child{border-bottom:none}
  .lever-n{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--ab);color:var(--amber);font-size:0.6875rem;font-weight:800;display:flex;align-items:center;justify-content:center}
  .lever-t{font-size:0.7812rem;line-height:1.5;color:var(--text)}

  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .stat{text-align:center}
  .stat-v{font-size:1.1875rem;font-weight:800;color:var(--amber)}
  .stat-sub{font-size:0.75rem;color:var(--muted);font-weight:600}
  .stat-l{font-size:0.6875rem;color:var(--muted);margin-top:2px;line-height:1.3}

  .nb-link{display:block;margin-top:8px;color:var(--amber);font-weight:700;font-size:0.75rem;text-decoration:none}
  /* Same-page jump now that Body & Goals lives on this screen, so it's a button
     rather than a link — but it must read identically to the other nb-links. */
  .nb-btn{background:none;border:none;padding:0;cursor:pointer;font-family:inherit;text-align:left}
</style>
