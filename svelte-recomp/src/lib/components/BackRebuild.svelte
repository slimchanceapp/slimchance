<script lang="ts">
  // The Back Rebuild program card. Full on Train; `compact` on Today, where it
  // is just the morning rating and what it means for today.
  //
  // Starting it never touches the user's own plan: the sessions store overlays
  // the program onto their gym days while it runs ($lib/program) and hands
  // their plan back when it ends. The morning rating is what makes it a
  // program rather than a list — it decides progress, hold, or back off.
  import { liveProfile, liveDailyLogs, liveSchedule, liveWorkoutSessions } from '$lib/stores/live';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';
  import { todayDate } from '$lib/stores/refresh';
  import { haptic } from '$lib/haptics';
  import { programWeek, phaseFor, nextMonday, shiftStart, painAdvice, gymKeysInOrder, type ProgramState } from '$lib/program';
  import { DAILY, WEEKS, RULES, RED_FLAGS, INTRO_VIDEOS } from '$lib/data/backRebuild';
  import Modal from './Modal.svelte';
  import VideoEmbed from './VideoEmbed.svelte';

  let { compact = false, onOpenSession }: { compact?: boolean; onOpenSession?: (key: string) => void } = $props();

  const _profile = liveProfile();
  const _logs = liveDailyLogs();
  const _schedule = liveSchedule();
  const _sessions = liveWorkoutSessions();

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  const today = $derived($todayDate);
  const program = $derived(($_profile as any)?.program as ProgramState);
  const week = $derived(programWeek(program, today));
  const phase = $derived(phaseFor(Math.max(1, week)));
  const advice = $derived(painAdvice($_logs as any[], today));
  const todayPain = $derived((($_logs as any[]).find((l) => l.date === today)?.back_pain ?? null) as number | null);
  const todayKey = $derived.by(() => {
    const dow = new Date(today + 'T12:00:00').getDay();
    return ($_schedule as any[]).find((d) => d.day_of_week === dow)?.session_key ?? null;
  });
  const todaySession = $derived(todayKey ? $_sessions.get(todayKey) : null);
  const hasGymDays = $derived(gymKeysInOrder($_schedule as any[]).length > 0);

  let busy = $state(false);
  let showDaily = $state(false);
  let open = $state<'' | 'rules' | 'flags' | 'watch'>('');
  let confirmEnd = $state(false);

  async function saveProgram(p: ProgramState) {
    if (!uid || busy) return;
    busy = true;
    try {
      await upsertRecord('user_settings', { user_id: uid, program: p ?? null, updated_at: new Date().toISOString() });
      haptic('success');
    } finally {
      busy = false; confirmEnd = false;
    }
  }

  async function ratePain(n: number) {
    if (!uid) return;
    haptic('select');
    await upsertRecord('daily_logs', { user_id: uid, date: today, back_pain: n });
  }

  // The saved start while one is pending; the coming Monday for a new offer.
  const startLabel = $derived(new Date((program?.start && week === 0 ? program.start : nextMonday(today)) + 'T12:00:00')
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }));
  // Red before day one: waiting a week is the one-tap answer — unless the
  // ratings say it isn't settling, when the answer is a physio, not a delay.
  const offerLater = $derived(week === 0 && advice.tone === 'bad' && advice.ratedToday && !advice.physio);
  const later = () => program?.start && saveProgram({ id: 'back-rebuild', start: shiftStart(program.start, 7) });
</script>

{#snippet rating()}
  <div class="br-rate" role="group" aria-label="Back pain this morning, 0 to 10">
    {#each Array.from({ length: 11 }, (_, i) => i) as n}
      <button class="br-n" class:on={todayPain === n} data-band={n >= 6 ? 'bad' : n >= 4 ? 'warn' : 'good'}
        onclick={() => ratePain(n)} aria-label="{n} out of 10" aria-pressed={todayPain === n}>{n}</button>
    {/each}
  </div>
  <div class="br-advice tone-{advice.tone}">
    <span class="br-dot"></span>
    <div><b>{advice.ratedToday || advice.tone === 'na' ? advice.title : `Yesterday: ${advice.title.replace(/^Back at /, '')}`}</b><p>{advice.body}</p></div>
  </div>
{/snippet}

{#if program?.start && week <= WEEKS}
  {#if compact}
    <section class="br card">
      <div class="br-head">
        <span class="br-eyebrow">Back Rebuild · {week === 0 ? `starts ${startLabel}` : `week ${week} of ${WEEKS}`}</span>
      </div>
      <div class="br-q">How are the back and neck this morning?</div>
      {@render rating()}
      {#if offerLater}<button class="btn bg_ bsm br-later" disabled={busy} onclick={later}>Start a week later</button>{/if}
    </section>
  {:else}
    <section class="br card">
      <div class="br-head">
        <span class="br-eyebrow">Back Rebuild</span>
        <span class="br-week">{week === 0 ? `starts ${startLabel}` : `week ${week} / ${WEEKS}`}</span>
      </div>
      <h2 class="br-phase">{phase?.name}</h2>
      <div class="br-weeks" aria-hidden="true">
        {#each Array.from({ length: WEEKS }, (_, i) => i + 1) as w}
          <span class:done={w < week} class:now={w === week}></span>
        {/each}
      </div>
      <p class="br-goal">{phase?.goal}</p>
      <p class="br-effort">{phase?.effort}</p>

      <div class="br-q">How are the back and neck this morning?</div>
      {@render rating()}

      {#if todaySession?.program && todayKey}
        <button class="br-today" onclick={() => onOpenSession?.(todayKey)}>
          <span><em>Today</em><b>{todaySession.name}</b><small>{todaySession.duration} · {todaySession.focus}</small></span>
          <span class="br-go" aria-hidden="true">→</span>
        </button>
      {/if}
      <button class="btn bg_ bfl" onclick={() => (showDaily = true)}>Daily basics · 10 min, every day</button>

      <div class="br-note"><b>Badminton this phase</b>{phase?.badminton}</div>

      <div class="br-fold">
        <button onclick={() => (open = open === 'rules' ? '' : 'rules')} aria-expanded={open === 'rules'}>The pain rules {open === 'rules' ? '−' : '+'}</button>
        {#if open === 'rules'}
          <ul class="br-rules">
            {#each RULES as r}<li class="tone-{r.tone}"><span class="br-dot"></span><div><b>{r.title}</b><p>{r.body}</p></div></li>{/each}
          </ul>
        {/if}
        <button onclick={() => (open = open === 'flags' ? '' : 'flags')} aria-expanded={open === 'flags'}>See a doctor instead if… {open === 'flags' ? '−' : '+'}</button>
        {#if open === 'flags'}
          <ul class="br-flags">{#each RED_FLAGS as f}<li>{f}</li>{/each}</ul>
        {/if}
        <button onclick={() => (open = open === 'watch' ? '' : 'watch')} aria-expanded={open === 'watch'}>Watch before day one {open === 'watch' ? '−' : '+'}</button>
        {#if open === 'watch'}
          <div class="br-videos">{#each INTRO_VIDEOS as v}<VideoEmbed vid={v.vid} label={v.label} />{/each}</div>
        {/if}
      </div>

      <div class="br-actions">
        {#if !advice.physio}<button class="btn bg_ bsm" disabled={busy} onclick={later}>{week === 0 ? 'Start a week later' : 'Repeat this week'}</button>{/if}
        {#if confirmEnd}
          <button class="btn bd bsm" disabled={busy} onclick={() => saveProgram(null)}>Yes, end it</button>
        {:else}
          <button class="btn bg_ bsm" onclick={() => (confirmEnd = true)}>End program</button>
        {/if}
      </div>
    </section>
  {/if}
{:else if program?.start && !compact}
  <section class="br card">
    <span class="br-eyebrow">Back Rebuild · complete</span>
    <h2 class="br-phase">You’re through.</h2>
    <p class="br-goal">Your own plan is back. For the next two weeks use about 80% of your old loads, and keep the daily basics three times a week — they’re cheap insurance.</p>
    <button class="btn bg_ bsm" disabled={busy} onclick={() => saveProgram(null)}>Close the program</button>
  </section>
{/if}

<Modal open={showDaily} onclose={() => (showDaily = false)}>
  <div class="br-dhead">Daily basics</div>
  <p class="br-goal">Every day, rest days included. About ten minutes plus the walk. Use the {week % 2 === 0 && week > 0 ? 'second' : 'first'} number this week.</p>
  {#each DAILY as d}
    <div class="br-dex">
      <div class="br-dex-top"><b>{d.name}</b><span>{(week % 2 === 0 && week > 0) ? d.w2 : d.w1}</span></div>
      <p>{d.tip}</p>
      {#if d.vid}<VideoEmbed vid={d.vid} compact label="Watch how ▸" />{/if}
    </div>
  {/each}
</Modal>

<style>
  .br{position:relative}
  .br-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .br-eyebrow{font-family:var(--font-label);font-size:0.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .br-week{font-size:0.8125rem;font-weight:800;color:var(--text);font-variant-numeric:lining-nums tabular-nums}
  .br-phase{font-family:var(--font-display);font-size:1.75rem;font-weight:700;line-height:1;letter-spacing:0;color:var(--text);margin:6px 0 10px}
  .br-weeks{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:12px}
  .br-weeks span{height:6px;border-radius:2px;background:var(--bg3)}
  .br-weeks span.done{background:var(--muted)}
  .br-weeks span.now{background:var(--amber)}
  .br-goal{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 6px}
  .br-effort{font-size:0.8125rem;line-height:1.45;color:var(--muted);margin:0 0 14px}
  .br-q{font-size:0.8125rem;font-weight:700;color:var(--text);margin-bottom:8px}
  .br-rate{display:grid;grid-template-columns:repeat(11,1fr);gap:3px;margin-bottom:10px}
  .br-n{height:38px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-weight:800;font-size:0.8125rem;cursor:pointer;font-variant-numeric:lining-nums tabular-nums;padding:0}
  .br-n.on[data-band='good']{background:var(--led-good,#31f28a);color:#06110b;border-color:transparent}
  .br-n.on[data-band='warn']{background:var(--led-warn,#ffb020);color:#1a1000;border-color:transparent}
  .br-n.on[data-band='bad']{background:var(--led-bad,#ff3b47);color:#fff;border-color:transparent}
  .br-advice,.br-rules li{display:flex;gap:10px;align-items:flex-start}
  .br-advice{background:var(--bg3);border-radius:var(--r-md,10px);padding:10px 12px;margin-bottom:12px}
  .br-dot{flex-shrink:0;width:10px;height:10px;border-radius:50%;margin-top:4px;background:var(--band,#8d9098);box-shadow:0 0 10px var(--band,transparent)}
  .br-advice b,.br-rules b{display:block;font-size:0.875rem;color:var(--text)}
  .br-advice p,.br-rules p{margin:2px 0 0;font-size:0.8125rem;line-height:1.45;color:var(--muted)}
  .br-today{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;background:var(--amber);color:var(--bg);border:none;border-radius:var(--r-md,10px);padding:12px 14px;margin-bottom:8px;cursor:pointer;font-family:inherit}
  .br-today span{display:flex;flex-direction:column;gap:1px}
  .br-today em{font-style:normal;font-size:0.6875rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.7}
  .br-today b{font-size:1rem}
  .br-today small{font-size:0.75rem;opacity:.75}
  .br-go{font-size:1.25rem;font-weight:900}
  .br-note{font-size:0.8125rem;line-height:1.45;color:var(--text);border-left:3px solid var(--border2);padding:2px 0 2px 10px;margin:6px 0 12px}
  .br-note b{display:block;font-size:0.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
  .br-fold{border-top:1px solid var(--border)}
  .br-fold>button{display:flex;justify-content:space-between;width:100%;background:none;border:none;border-bottom:1px solid var(--border);padding:12px 0;font-size:0.875rem;font-weight:700;color:var(--text);cursor:pointer;font-family:inherit}
  .br-rules,.br-flags{list-style:none;margin:10px 0;padding:0;display:flex;flex-direction:column;gap:10px}
  .br-flags li{font-size:0.8125rem;line-height:1.45;color:var(--text);padding-left:14px;position:relative}
  .br-flags li::before{content:'';position:absolute;left:0;top:7px;width:6px;height:6px;border-radius:50%;background:var(--led-bad,#ff3b47)}
  .br-videos{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:10px 0}
  .br-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .br-later{margin-top:-2px}
  .br-dhead{font-family:var(--font-display);font-size:1.5rem;font-weight:700;color:var(--text);margin-bottom:4px}
  .br-dex{border-top:1px solid var(--border);padding:12px 0}
  .br-dex-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .br-dex-top b{font-size:0.9375rem;color:var(--text)}
  .br-dex-top span{font-size:0.8125rem;font-weight:700;color:var(--text);text-align:right}
  .br-dex p{font-size:0.8125rem;line-height:1.45;color:var(--muted);margin:4px 0 0}
</style>
