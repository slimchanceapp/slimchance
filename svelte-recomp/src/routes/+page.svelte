<script lang="ts">
  // TODAY answers one question: what do I do today? (the design review,
  // 2026-10-31). The weigh-in, then at most one next thing, then today's plan.
  // The scoreboard (the big number, the odds coins, the pace, the goal chips)
  // lives on Progress, so each number is said once.
  import { liveWeights, liveSchedule, liveWorkoutSessions, liveSessionCompletions, liveDailySteps, liveWorkoutLogs, liveActivitySessions, liveDailyLogs, liveFoodLogs } from '$lib/stores/live';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId, user, isTrial } from '$lib/stores/user';
  import { noteEvent } from '$lib/events';
  import { CALENDAR_KEY, calendarUrl } from '$lib/reminder';
  import { saveAccountOpen, importOpen } from '$lib/stores/notices';
  import { liveProfile, liveMedications, liveMedEvents } from '$lib/stores/live';
  import { nextDose, dayWord } from '$lib/meds';
  import { DEFAULT_SESSIONS } from '$lib/data/workoutPlanDefaults';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { cardNav } from '$lib/actions/cardNav';
  import { morningsThisWeek } from '$lib/scale';
  import { saveWeighIn, NeedsConfirm } from '$lib/weighIn';
  import { body, stall, line, scaleUp, todayPulse } from '$lib/stores/body';
  import { dayOne } from '$lib/stores/dayOne';
  import { coachOn } from '$lib/stores/brain';
  import { coachPlan } from '$lib/stores/coachPlan';
  import { todaysMeals } from '$lib/mealPlan';
  import { kindWord } from '$lib/kind';
  import { lessonFor } from '$lib/lessons';
  import { editing } from '$lib/commitments';
  import { sportOf } from '$lib/plans';
  import CommitmentAlerts from '$lib/components/CommitmentAlerts.svelte';
  import MilestoneMoment from '$lib/components/MilestoneMoment.svelte';
  import GoalMoment from '$lib/components/GoalMoment.svelte';
  import MonthLetter from '$lib/components/MonthLetter.svelte';
  import CoachNoticed from '$lib/components/CoachNoticed.svelte';
  import Commitments from '$lib/components/Commitments.svelte';
  import CoinSpin from '$lib/components/CoinSpin.svelte';
  import FitAsk from '$lib/components/FitAsk.svelte';
  import { primaryActivity, trainedDates } from '$lib/health/exercise';
  import WeekCheckIn from '$lib/components/WeekCheckIn.svelte';
  import BackRebuild from '$lib/components/BackRebuild.svelte';
  import { badmintonRule } from '$lib/program';
  import { nowTick, todayDate } from '$lib/stores/refresh';
  import WeightInput from '$lib/components/WeightInput.svelte';
  import { changeWord, wtNum } from '$lib/units';

  const dayIdx = $derived(new Date($nowTick).getDay());
  const today = $derived($todayDate);
  // The GLP-1 companion's next dose, while a medication is being taken.
  const _meds = liveMedications();
  const _medEvents = liveMedEvents();
  const med = $derived((($_meds as any[]) ?? []).find((m) => !m.stopped) ?? null);
  const medNext = $derived(med ? nextDose(med, ($_medEvents as any[]) ?? [], today as string) : null);
  const dateLine = $derived(new Date($nowTick).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));

  const _weights = liveWeights();
  const _profile = liveProfile();

  // — Today's gym session (from the Workouts page's weekly schedule) —
  const _schedule = liveSchedule();
  const _sessions = liveWorkoutSessions();
  const _completions = liveSessionCompletions();
  const todaySchedule = $derived.by(() => {
    // No week chosen yet (Train asks): no session to show, never a made-up one.
    return ($_schedule as any[]).find((d: any) => d.day_of_week === dayIdx) ?? null;
  });
  const todaySession = $derived.by(() => {
    if (!todaySchedule?.session_key) return null;
    const sessions = $_sessions.size > 0 ? $_sessions : new Map(DEFAULT_SESSIONS.map((s) => [s.key, s]));
    return sessions.get(todaySchedule.session_key) ?? null;
  });
  // This week's mornings on the scale. Not a streak: a missed morning costs one
  // morning, never the whole count, and Monday starts fresh.
  const mornings = $derived(morningsThisWeek($_weights as any[], today));

  // A trial with something worth keeping (three weigh-ins, or two days in)
  // is reminded, quietly, that it lives on this one device. "Later" rests it
  // for a week.
  const LATER_KEY = 'recompos.saveLater';
  let laterAt = $state(0);
  try { laterAt = Number(localStorage.getItem(LATER_KEY)) || 0; } catch { /* storage disabled */ }
  const askToSave = $derived($isTrial && Date.now() - laterAt > 7 * 864e5 && (
    ($_weights as any[]).length >= 3 || Date.now() - Date.parse($user?.created_at ?? '') > 2 * 864e5));
  function saveLater() {
    laterAt = Date.now();
    try { localStorage.setItem(LATER_KEY, String(laterAt)); } catch { /* storage disabled */ }
  }

  let periodSaving = $state(false);
  async function togglePeriod() {
    if (!uid || periodSaving) return;
    periodSaving = true;
    try { await upsertRecord('daily_logs', { user_id: uid, date: today, period: !todayLog?.period }); }
    catch (e) { console.error('Period save failed:', e); }
    finally { periodSaving = false; }
  }

  // The morning reminder this browser couldn't take at setup, offered once
  // as a daily event in the person's own calendar.
  let calendarTime = $state<string | null>(null);
  try { calendarTime = localStorage.getItem(CALENDAR_KEY); } catch { /* storage disabled */ }
  function doneCalendar(added: boolean) {
    if (added) noteEvent('reminder_calendar');
    calendarTime = null;
    try { localStorage.removeItem(CALENDAR_KEY); } catch { /* storage disabled */ }
  }

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  let weightKg = $state<number | null>(null);
  let saving = $state(false);
  let saveMsg = $state('');
  /** A reading far off the trend, waiting for its second tap. */
  let confirmKg = $state<number | null>(null);

  // Every weight number on this screen is the trend's (stores/body): one
  // morning's reading swings a kilo either way and is never the headline.
  const currentKg = $derived($body.currentKg);
  const todayWeighIn = $derived(($_weights as any[]).find((w) => w.date === today) ?? null);
  // The raw reading stays visible beside the trend — the trend replaces it as
  // the headline, never as the record.
  const lastWeighIn = $derived(($_weights as any[]).at(-1) ?? null);
  const lastWeighLabel = $derived(lastWeighIn
    ? `${wtNum(+lastWeighIn.weight)} on ${new Date(lastWeighIn.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
    : null);

  // What this morning means once it's in: the odds, or in the first week the
  // mornings still to go until the first odds.
  const p = $derived($todayPulse);
  const meaning = $derived(p.odds?.text ?? ($body.weight?.state === 'not-enough' ? p.story : null));
  // A kind word, only when it's earned by showing up (src/lib/kind.ts).
  const kind = $derived(kindWord(($_weights as any[]).map((w) => w.date), today, mornings));

  // The morning weigh-in. This card once took a bare kcal number too, written
  // to daily_logs.kcal — a second, item-less food log that the Food page never
  // saw and that competed with it in every calorie sum. Food has one way in now.
  async function saveEntry(what: 'weight') {
    if (!uid) { saveMsg = 'Not signed in — please sign back in.'; return; }
    saving = true;
    saveMsg = '';
    try {
      if (what === 'weight' && weightKg != null) {
        const kg = weightKg;
        await saveWeighIn(uid, kg, {
          today, weights: $_weights as any[], goalKg: $body.goalKg, trendKg: currentKg, confirmed: confirmKg === kg,
          startKg: ($_profile as any)?.start_kg != null ? +($_profile as any).start_kg : null,
        });
        weightKg = null;
        confirmKg = null;
      }
    } catch (e: any) {
      if (e instanceof NeedsConfirm) { confirmKg = weightKg; saveMsg = e.message; return; }
      console.error('Log failed:', e);
      saveMsg = 'Save failed: ' + (e?.message || e?.error_description || String(e)).slice(0, 150);
    } finally {
      saving = false;
    }
  }

  const _steps = liveDailySteps();
  const _dailyLogs = liveDailyLogs();
  // Today's daily_logs row, derived reactively from the full set + the reactive
  // `today` — so when the calendar day rolls over (a native app left open past
  // midnight), this snaps to the new, empty day instead of showing yesterday's
  // kcal/water as if they were today's. The old `liveLog(today)` captured the
  // date once at mount and never rolled over.
  const todayLog = $derived(($_dailyLogs as any[]).find((l: any) => l.date === today) ?? null);
  // Steps live in their own `steps` table (field `count`), NOT on
  // daily_logs — the old `$_todayLog?.steps` always read undefined so
  // steps never displayed. Take the most recent entry logged today.
  const todaySteps = $derived($_steps.get(today) ?? null);

  const _workoutLogs = liveWorkoutLogs();
  const _activity = liveActivitySessions();

  // Today's watch-recorded workout, if the watch caught one: a sport session
  // makes it a sport day for the plans.
  const watchToday = $derived(primaryActivity(($_activity as any[]) || [], today));

  // Per-day totals come from stores/body — the same map every screen reads,
  // with quick-logged kcal standing in for days that have no itemised food.
  const coachTodayKcal = $derived($body.intake.get(today)?.kcal ?? null);
  const coachTodayProtein = $derived($body.intake.get(today)?.protein ?? null);
  const todayShare = $derived($body.week?.share ?? null);
  const trainedToday = $derived(trainedDates($_completions as any[], ($_activity as any[]) || [], ($_workoutLogs as any[]) || []).has(today));

  // Today's meals from the coach's plan (made on Food), ticked as they're
  // logged. The owner, 2026-10-31: "if you are planning my food then i want
  // it on the today page".
  const _food = liveFoodLogs();
  const meals = $derived($coachOn ? todaysMeals($coachPlan, today, (($_food as any[]) ?? []).filter((f) => f.date === today && f.name).map((f) => f.name)) : null);
  const planKcal = $derived(meals ? meals.reduce((s, m) => s + m.kcal, 0) : null);
  const planAhead = $derived(!!$coachPlan?.days.some((d) => d.date >= today));

  // What KIND of day is today? A gym session, an ACTIVE day (badminton/
  // cardio with no barbell session), or a true rest day. Badminton days have
  // session_key === null but are NOT rest — the old logic mislabelled them.
  const dayInfo = $derived.by(() => {
    const lbl = (todaySchedule?.label || '').toLowerCase();
    const note = (todaySchedule?.note || '').toLowerCase();
    if (todaySession) return { kind: 'gym' as const, label: todaySession.name };
    const hay = `${lbl} ${note}`;
    if (/badminton|cardio|agility|walk|run|swim|sport|tennis|cycl/.test(hay)) {
      const label = sportOf(todaySchedule) ?? (todaySchedule?.label || 'Active');
      return { kind: 'active' as const, label };
    }
    return { kind: 'rest' as const, label: 'Rest' };
  });

  // The plans' moments move through the day: tick the hour so a plan whose
  // moment has come shows without a reload.
  let nowHour = $state(new Date().getHours());
  $effect(() => {
    const t = setInterval(() => { nowHour = new Date().getHours(); }, 10 * 60 * 1000);
    return () => clearInterval(t);
  });

  // The moment the plans are matched against (see $lib/plans).
  // While a program says no games, a badminton night isn't one: no "after
  // badminton" plan, and the Today card says what the plan says instead.
  const bRule = $derived(badmintonRule(($_profile as any)?.program, today));
  const sportDay = $derived((!!sportOf(todaySchedule) && !(sportOf(todaySchedule) === 'Badminton' && bRule?.play === false)) || watchToday?.kind === 'sport');

  // The first week: one next step at a time, until the trend arrives (the
  // scale's own step is the card at the top).
  const plan = $derived($dayOne);
  const step = $derived(plan != null && $body.weight?.trendKg == null ? plan.steps.find((s) => !s.done && s.key !== 'weigh') ?? null : null);

  // A lesson on the day it's needed, shown until "Got it" (src/lib/lessons.ts).
  const LESSONS_KEY = 'recompos.lessons';
  let seenLessons = $state(new Set<string>((() => { try { return JSON.parse(localStorage.getItem(LESSONS_KEY) ?? '[]'); } catch { return []; } })()));
  const lesson = $derived(lessonFor({ today, firstWeighIn: ($_weights as any[])[0]?.date ?? null, odds: p.odds != null, stalled: $stall != null, seen: seenLessons }));
  function gotIt(id: string) {
    seenLessons = new Set([...seenLessons, id]);
    try { localStorage.setItem(LESSONS_KEY, JSON.stringify([...seenLessons])); } catch { /* back next visit */ }
  }
</script>

<p class="dt">{dateLine}</p>

<!-- MORNING WEIGH-IN. The trend is only as good as the mornings behind it — a
     month of 13 weigh-ins left it a kilo wide either way — so the scale gets the
     top of the screen until today's reading is in, then shrinks to its result. -->
{#if todayWeighIn}
  <div class="mw-res">
    <div class="mw-done">Weighed <b>{wtNum(+todayWeighIn.weight)}</b> today{#if currentKg != null && $body.weight?.trendKg != null}{' · '}trend <b>{wtNum(currentKg)}</b> {changeWord()}{:else if currentKg != null && ($body.weight?.n ?? 0) > 1}{' · '}average so far <b>{wtNum(currentKg)}</b> {changeWord()}{/if}{#if $line && !$line.misdrawn}{' · '}ceiling <b class="mw-line z-{$line.zone}">{wtNum($line.kg)}</b>{/if}</div>
    {#if p.odds}
      <!-- The odds as ten coins, lighting one after another: the same coins the
           first-odds lesson explains, in the pace's colour. -->
      <div class="oc tone-{p.tone}" aria-hidden="true">{#each Array(10) as _, i}<i class:on={i < p.odds.lit} style="--i:{i}"></i>{/each}</div>
    {/if}
    {#if meaning}<p class="mw-mean">{meaning}{#if p.odds && !kind}{' '}{mornings.weighed} of {mornings.days} mornings this week.{/if}</p>{/if}
    {#if kind}<p class="mw-kind">{kind}</p>{/if}
  </div>
{:else}
  <div class="card mw">
    <div class="mw-top">
      <label class="card-lbl" for="ql-weight">Morning weigh-in</label>
      {#if currentKg != null}<span class="mw-trend">trend <b>{wtNum(currentKg)}</b> {changeWord()}{#if $line && !$line.misdrawn}{' · '}ceiling <b class="mw-line z-{$line.zone}">{wtNum($line.kg)}</b>{/if}</span>{/if}
    </div>
    <div class="mw-row">
      <WeightInput id="ql-weight" bind:kg={weightKg} hint={currentKg} label="This morning’s weight" onenter={() => saveEntry('weight')} />
      <button class="btn bp" onclick={() => saveEntry('weight')} disabled={saving || weightKg == null}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
    {#if saveMsg}<div class="mw-err">{saveMsg}</div>{/if}
    <p class="mw-hint">{#if lastWeighLabel}Last reading {lastWeighLabel}.{' '}{/if}Same time, before food or drink. One morning is noise; the trend — the line through five weeks of mornings — is the number.</p>
  </div>
{/if}

{#if ($_profile as any)?.cycle_aware}
  <!-- Period-aware weight (Settings): one tap marks the first day. -->
  <button class="pd" class:on={!!todayLog?.period} onclick={togglePeriod} disabled={periodSaving}>
    {todayLog?.period ? 'Period started today ✓' : 'Period started today? Tap to mark it'}
  </button>
{/if}

<!-- THE NEXT THING. Eight cards used to stack up here; now they wait their
     turn, most urgent first, and only the first one present shows (the CSS
     below). Each card still decides for itself whether it has anything to say. -->
<div class="next">
  {#if todayWeighIn && $scaleUp}
    <!-- A high morning, explained from their own log: the moment people quit. -->
    <section class="card su" aria-label="Why the scale is up">
      <div class="su-t">{$scaleUp.title}</div>
      <ul class="su-r">{#each $scaleUp.reasons as r}<li>{r}</li>{/each}</ul>
      {#if $scaleUp.trend}<div class="su-f">{$scaleUp.trend}</div>{/if}
    </section>
  {/if}
  {#if calendarTime}
    <div class="card sv">
      <p class="sv-t"><b>Your morning reminder.</b> This browser can't send notifications, so put it in your calendar: every day at {calendarTime}, step on the scale, before food or drink.</p>
      <div class="sv-row">
        <a class="btn bp bsm" href={calendarUrl(calendarTime)} target="_blank" rel="noopener" onclick={() => doneCalendar(true)}>Add to my calendar</a>
        <button class="sv-later" onclick={() => doneCalendar(false)}>No thanks</button>
      </div>
    </div>
  {/if}
  <!-- Sun/Mon/Tue, once a week: the one moment the app asks instead of reports. -->
  <WeekCheckIn />
  <!-- The goal held for three days: keep it here, or aim lower (on Progress). -->
  <GoalMoment onAimLower={() => goto(`${base}/progress#goal`)} />
  <!-- A next stop held for three days: shown once, then the next one is chosen. -->
  <MilestoneMoment />
  <!-- The 1st to the 3rd: last month, told back. -->
  <MonthLetter />
  <!-- A lesson on its day: the first odds come once, the save card can wait. -->
  {#if lesson}
    <div class="card ls">
      {#if lesson.id === 'first-odds'}<span class="ls-coin"><CoinSpin size={30} /></span>{/if}
      <div class="ls-t">{lesson.title}</div>
      <p class="ls-b">{lesson.body}</p>
      <div class="sv-row">
        {#if lesson.href}<a class="btn bp bsm" href={base + lesson.href}>{lesson.cta}</a>{/if}
        <button class="sv-later" onclick={() => gotIt(lesson.id)}>Got it</button>
      </div>
    </div>
  {/if}
  <!-- Days 3 to 7, once: is it for them, and what's in the way (lib/fit). -->
  <FitAsk />
  {#if askToSave}
    <div class="card sv">
      <p class="sv-t"><b>Keep what you've started.</b> This trial lives on this device only. Save it with an email and it's yours on any phone.</p>
      <div class="sv-row">
        <button class="btn bp bsm" onclick={() => saveAccountOpen.set(true)}>Save my account</button>
        <button class="sv-later" onclick={saveLater}>Later</button>
      </div>
    </div>
  {/if}
  <!-- The ceiling, when the trend is over it, and the plan whose moment it is. -->
  <CommitmentAlerts moment={{ hour: nowHour, dow: dayIdx, sportDay, backPain: todayLog?.back_pain ?? null }} />
  <!-- The AI coach's one pattern for today, when it's on and found one. -->
  <CoachNoticed />
  {#if step && plan}
    <div class="card ns">
      <p class="ns-plan">{plan.headline}</p>
      {#if step.key === 'plan'}
        <!-- The plans editor lives on this page: open it, don't navigate. -->
        <button type="button" class="ns-step" onclick={() => editing.set('plans')}><b>{step.label}</b><em>{step.hint}</em></button>
      {:else}
        <a class="ns-step" href={base + step.href}><b>{step.label}</b><em>{step.hint}</em></a>
      {/if}
      <button type="button" class="ns-import" onclick={() => importOpen.set(true)}>Weighed yourself in another app? Bring your history and the trend starts today →</button>
    </div>
  {/if}
</div>
<!-- /next -->

<!-- TODAY'S PLAN: what's left to eat and what's on, each row going where
     you'd act on it. Water and the goal's reasoning live under Progress → Body
     & Goals; steps come from the watch. -->
<div class="card td">
  <div class="td-row" use:cardNav={`${base}/recipes`}>
    <span class="td-k">Food</span>
    <span class="td-v">
      {#if planKcal ?? todayShare}<b>{Math.round(coachTodayKcal ?? 0).toLocaleString()}</b>{' '}of {(planKcal ?? todayShare)!.toLocaleString()} kcal{:else if coachTodayKcal}<b>{Math.round(coachTodayKcal).toLocaleString()}</b>{' '}kcal{:else}Nothing logged yet{/if}
    </span>
    <span class="td-go" aria-hidden="true">›</span>
  </div>
  <div class="td-sub">
    {Math.round(coachTodayProtein ?? 0)} of {$body.proteinTargetG} g protein{#if todaySteps != null}{' · '}{todaySteps.toLocaleString()} steps{/if}
  </div>
  {#if meals}
    <ul class="td-meals" aria-label="Your coach’s plan for today">
      {#each meals as m}
        <li class:done={m.done}><span class="td-t">{m.time}</span><span class="td-i">{m.items.map((x) => `${x.grams} g ${x.food}`).join(' · ')}</span><span class="td-tick" aria-label={m.done ? 'logged' : undefined}>{m.done ? '✓' : ''}</span></li>
      {/each}
    </ul>
  {:else if $coachOn && !planAhead}
    <a class="td-plan" href={`${base}/recipes`}>Let your coach plan the rest of your week ›</a>
  {/if}
  <div class="td-row" use:cardNav={`${base}/workouts`}>
    <span class="td-k">{dayInfo.kind === 'gym' ? 'Gym' : dayInfo.kind === 'active' ? dayInfo.label : $_schedule.length ? 'Rest' : 'Move'}</span>
    <span class="td-v">
      {#if todaySession}{todaySession.name}{:else if dayInfo.label === 'Badminton' && bRule}{bRule.text[0].toUpperCase() + bRule.text.slice(1)}{:else if dayInfo.kind === 'active'}{todaySchedule?.time ? `at ${todaySchedule.time}` : 'today'}{:else}A walk counts{/if}{#if trainedToday}{' '}<span class="td-done">✓ done</span>{/if}
    </span>
    <span class="td-go" aria-hidden="true">›</span>
  </div>
  {#if med && medNext}
    <div class="td-row" use:cardNav={`${base}/meds`}>
      <span class="td-k">Meds</span>
      <span class="td-v">{med.name}{#if medNext.doneToday}{' '}<span class="td-done">✓ done</span>{:else}{medNext.inDays < 0 ? ': due ' : ' '}{dayWord(medNext.date, today as string)}{/if}</span>
      <span class="td-go" aria-hidden="true">›</span>
    </div>
  {/if}
</div>

<!-- Only while a program runs: the one-tap morning rating that paces it. -->
<BackRebuild compact />

<!-- The editors the plans step and the plan moments open. -->
<Commitments />

<style>
  .dt{font-family:var(--font-label);font-size:0.8125rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:4px 2px 12px}
  .mw{padding:13px 14px}
  .pd{display:block;width:100%;margin:-6px 0 14px;background:none;border:1px dashed var(--border2);border-radius:var(--r-md);padding:9px 12px;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--muted);text-align:left;cursor:pointer}
  .pd.on{border-style:solid;color:var(--text)}
  /* One card at a time: whichever card in the slot has something to say
     first is the one shown. */
  .next > :global(:not(:first-child)){display:none}
  .su{padding:13px 14px}
  .su-t{font-family:var(--font-display);font-size:1.375rem;font-weight:700;color:var(--text);margin-bottom:6px}
  .su-r{margin:0;padding-left:1.05rem;font-size:0.875rem;line-height:1.5;color:var(--text)}
  .su-r li{margin:4px 0}
  .su-f{font-size:0.875rem;line-height:1.5;color:var(--muted);margin-top:8px}
  .sv{padding:13px 14px;background:color-mix(in srgb,var(--amber) 8%,var(--bg2))}
  .sv-t{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 10px}
  .sv-row{display:flex;align-items:center;gap:14px}
  .sv-later{background:none;border:none;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--muted);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
  .ns{padding:13px 14px}
  .ns-plan{font-size:0.875rem;line-height:1.5;color:var(--muted);margin:0 0 10px}
  .ns-step{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;font:inherit;color:inherit;text-decoration:none;cursor:pointer;
    background:var(--bg3);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;transition:transform .18s var(--ease)}
  .ns-step:active{transform:scale(.985)}
  .ns-step b{font-size:0.9375rem;font-weight:800;color:var(--text)}
  .ns-step em{font-style:normal;font-size:0.8125rem;line-height:1.45;color:var(--muted)}
  .ns-import{display:block;width:100%;text-align:left;background:none;border:none;padding:10px 2px 0;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--amber);cursor:pointer}
  /* A lesson wears the brighter accent: it's a moment, not a warning. */
  .ls{padding:13px 14px;background:color-mix(in srgb,var(--led-good) 9%,var(--bg2))}
  .ls-coin{float:right;margin:0 0 4px 10px}
  .ls-coin :global(.cspin *){animation-iteration-count:2}
  .ls-t{font-family:var(--font-display);font-size:1.25rem;font-weight:700;color:var(--text);margin-bottom:4px}
  .ls-b{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 10px}
  /* Each half stays whole: with big text the trend drops under the label. */
  .mw-top{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;column-gap:10px;row-gap:2px;margin-bottom:8px}
  .mw-top .card-lbl{margin:0;white-space:nowrap}
  .mw-trend{font-size:0.8125rem;color:var(--muted);white-space:nowrap}
  .mw-trend b{font-family:var(--font-display);font-size:1.125rem;color:var(--text)}
  .mw-row{display:flex;gap:8px}
  .mw-row :global(input){flex:1;min-width:0;font-size:1.25rem;font-weight:700;text-align:center;font-variant-numeric:lining-nums tabular-nums}
  .mw-row .btn{flex-shrink:0;min-width:88px}
  .mw-hint{font-size:0.75rem;color:var(--muted);margin-top:7px;line-height:1.45}
  .mw-err,.mw-msg{font-size:0.75rem;margin-top:6px;color:var(--led-good)}
  .mw-err,.mw-msg.bad{color:var(--led-bad)}
  .mw-res{margin:0 2px 14px}
  .mw-done{font-size:0.8125rem;color:var(--muted)}
  .mw-done b{font-family:var(--font-display);font-size:1.0625rem;color:var(--text)}
  .oc{display:flex;gap:6px;margin:9px 0 2px}
  .oc i{width:13px;height:13px;border-radius:50%;border:1.5px solid var(--border2)}
  .oc i.on{background:var(--band);border-color:var(--band);animation:coin-in .35s var(--ease) both;animation-delay:calc(var(--i) * 70ms)}
  @keyframes coin-in{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
  .mw-mean{font-size:0.9375rem;line-height:1.45;color:var(--text);margin:6px 0 0}
  .mw-kind{font-size:0.875rem;line-height:1.45;color:var(--led-good);font-weight:700;margin:4px 0 0;animation:fadeUp .5s var(--ease) both}
  .mw-line.z-over{color:var(--led-warn)}
  .mw-line.z-well-over{color:var(--led-bad)}
  .td{padding:6px 14px}
  .td-row{display:flex;align-items:baseline;gap:12px;padding:9px 0;cursor:pointer;-webkit-tap-highlight-color:transparent}
  .td-row + .td-sub + .td-row,.td-meals + .td-row,.td-plan + .td-row{border-top:1px solid var(--border);margin-top:9px}
  .td-row + .td-row{border-top:1px solid var(--border)}
  .td-k{font-family:var(--font-label);font-size:0.8125rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);min-width:76px}
  .td-v{flex:1;min-width:0;font-size:0.9375rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .td-v b{font-family:var(--font-display);font-size:1.25rem;font-weight:700}
  .td-sub{font-size:0.75rem;color:var(--muted);margin:-6px 0 0 88px}
  .td-meals{list-style:none;margin:8px 0 0 88px;padding:0;display:grid;gap:6px}
  .td-meals li{display:grid;grid-template-columns:2.9rem minmax(0,1fr) 1rem;gap:6px;font-size:0.8125rem;line-height:1.4;color:var(--text)}
  .td-meals li.done .td-i{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--border2)}
  .td-t{font-weight:700;font-variant-numeric:tabular-nums}
  .td-tick{color:var(--led-good);font-weight:800}
  .td-plan{display:block;margin:8px 0 0 88px;font-size:0.8125rem;font-weight:700;color:var(--amber);text-decoration:none}
  .td-go{color:var(--muted);font-size:1.25rem;line-height:1}
  .td-done{color:var(--led-good);font-weight:700;font-size:0.8125rem}
</style>
