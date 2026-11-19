<script lang="ts">
  // Talk to your coach (Pact m49, his ask 19 Nov: "you should be able to talk to
  // the coach just like I am with you, no?"). A conversation with the coach,
  // which sees his Train week (each day's session or sport, his sessions and
  // their exercises), his alarms, his goal and his last two weeks. It answers,
  // asks when it doesn't know, and proposes changes as cards: each saves only
  // when he taps Do it, after the app has checked it (src/lib/coach/chat.ts).
  // The chat is kept on this phone only.
  import { tick } from 'svelte';
  import { coachOn, setCoach } from '$lib/stores/brain';
  import { talkToCoach, rememberForCoach } from '$lib/stores/coachChat';
  import { liveSchedule, liveWorkoutSessions, liveAlarms, liveGoalReason } from '$lib/stores/live';
  import { userId } from '$lib/stores/user';
  import { DEFAULT_SESSIONS, buildSchedule, type PlanDay, type PlanSession } from '$lib/training';
  import { swapExercise, moveSession, setSportDay } from '$lib/training/planEdits';
  import { describe, DAY_NAMES, type ChatWeek, type CoachAction } from '$lib/coach';
  import { sportOf } from '$lib/moments';

  type Card = CoachAction & { state?: 'done' | 'no' | 'failed' };
  type Msg = { role: 'user' | 'coach'; text: string; actions?: Card[]; sources?: { title: string; url: string }[] };

  const KEY = 'recompos.coachChat';
  function load(): Msg[] {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
  }
  let msgs = $state<Msg[]>(load());
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* storage off: this visit only */ } };

  const _schedule = liveSchedule();
  const _sessions = liveWorkoutSessions();
  const _alarms = liveAlarms();
  const _goal = liveGoalReason();
  // The week Train shows: his own, or the starting week until he saves one.
  const schedule = $derived<PlanDay[]>(($_schedule as PlanDay[]).length ? ($_schedule as PlanDay[]) : buildSchedule({ templateId: 'gym3' }));
  const sessions = $derived<PlanSession[]>([...(($_sessions as Map<string, PlanSession>).size ? ($_sessions as Map<string, PlanSession>) : new Map(DEFAULT_SESSIONS.map((s) => [s.key, s]))).values()]);
  const week = $derived.by((): ChatWeek & { alarms: string[]; goal: string | null } => {
    const name = (key: string | null) => sessions.find((s) => s.key === key)?.name ?? null;
    return {
      sessions: sessions.filter((s) => schedule.some((d) => d.session_key === s.key)).map((s) => ({ name: s.name, exercises: s.exercises.map((e) => e.name) })),
      days: DAY_NAMES.map((_, dow) => {
        const d = schedule.find((x) => x.day_of_week === dow);
        return { dow, session: name(d?.session_key ?? null), sport: sportOf(d) };
      }),
      alarms: (($_alarms as any[]) ?? []).filter((a) => a.enabled !== false && a.days?.length)
        .map((a) => `${a.days.map((d: number) => DAY_NAMES[d].slice(0, 3)).join('/')} ${a.time} ${a.title}`),
      goal: ($_goal as string | null) || null,
    };
  });

  let draft = $state('');
  let busy = $state(false);
  let err = $state('');
  let list: HTMLElement | undefined = $state();

  async function scrollDown() {
    await tick();
    list?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  async function send(text = draft) {
    text = text.trim();
    if (!text || busy) return;
    msgs.push({ role: 'user', text });
    draft = '';
    err = '';
    busy = true;
    keep();
    scrollDown();
    const r = await talkToCoach(msgs.map((m) => ({ role: m.role, text: m.text })), week);
    busy = false;
    if (r.ok) msgs.push({ role: 'coach', text: r.answer, actions: r.actions, sources: r.sources.map(({ title, url }) => ({ title, url })) });
    else err = r.why;
    keep();
    scrollDown();
  }

  async function accept(m: Msg, i: number) {
    const a = m.actions![i];
    const uid = $userId;
    if (!uid) return;
    try {
      if (a.type === 'swap_exercise') await swapExercise(uid, sessions, a.session, a.from, a.to);
      else if (a.type === 'move_session') {
        const s = sessions.find((x) => x.name === a.session);
        if (s) await moveSession(uid, schedule, s.key, a.to_day);
      } else if (a.type === 'set_sport') await setSportDay(uid, schedule, a.day, a.sport);
      else await rememberForCoach(a.note);
      a.state = 'done';
    } catch (e) {
      console.error('[coach chat] change failed:', e);
      a.state = 'failed';
    }
    keep();
  }
  function decline(m: Msg, i: number) { m.actions![i].state = 'no'; keep(); }
  function clear() { msgs = []; err = ''; keep(); }

  const STARTERS = ['Plan my week around my sport', 'Swap an exercise in my workout', 'How am I doing this week?'];
</script>

<div class="cc">
  <header class="cc-head">
    <button class="cc-back" onclick={() => history.back()} aria-label="Back">←</button>
    <div>
      <h1 class="cc-title">Your coach</h1>
      <p class="cc-sub">Sees your Train week, your sport days, your alarms and your trend. It suggests; you say yes.</p>
    </div>
  </header>

  {#if !$coachOn}
    <div class="card cc-off">
      <p>Your coach is off. Turn it on to talk: it reads your numbers and your week to answer you. <a href="/privacy.html">How it's kept</a></p>
      <button class="btn bp bfl" onclick={() => setCoach(true)}>Turn on the coach</button>
    </div>
  {:else}
    <div class="cc-list" bind:this={list}>
      <div class="cc-msg coach">I can see your Train week, your sport days, your alarms and your last two weeks. Ask me anything, or tell me what you'd like to change: I'll suggest it, and nothing changes until you say yes.</div>
      {#each msgs as m, mi (mi)}
        <div class="cc-msg {m.role}">{m.text}</div>
        {#if m.sources?.length}
          <div class="cc-src">{#each m.sources as s}<a href={s.url}>{s.title}</a>{/each}</div>
        {/if}
        {#each m.actions ?? [] as a, i}
          <div class="cc-card" class:done={a.state === 'done'}>
            <div class="cc-card-what">{describe(a, week)}</div>
            {#if a.state === 'done'}<div class="cc-card-state">Done ✓</div>
            {:else if a.state === 'no'}<div class="cc-card-state">Not now</div>
            {:else}
              {#if a.state === 'failed'}<div class="cc-card-state bad">Couldn't save that. Try again.</div>{/if}
              <div class="cc-card-btns">
                <button class="btn bp bsm" onclick={() => accept(m, i)}>Do it</button>
                <button class="btn bg_ bsm" onclick={() => decline(m, i)}>No thanks</button>
              </div>
            {/if}
          </div>
        {/each}
      {/each}
      {#if busy}<div class="cc-msg coach cc-wait">Your coach is thinking…</div>{/if}
    </div>

    {#if err}<p class="cc-err" role="alert">{err}</p>{/if}

    {#if !msgs.length}
      <div class="cc-starters">
        {#each STARTERS as s}<button class="cc-chip" onclick={() => send(s)} disabled={busy}>{s}</button>{/each}
      </div>
    {/if}

    <form class="cc-input" onsubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea bind:value={draft} rows="2" maxlength="600" placeholder="Talk to your coach…" aria-label="Message to your coach"
        onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
      <button class="btn bp" type="submit" disabled={busy || !draft.trim()}>Send</button>
    </form>
    {#if msgs.length}<button class="cc-clear" onclick={clear}>Clear the chat</button>{/if}
    <p class="cc-note">The chat stays on this phone. Your messages go to the coach's AI only to answer you; see <a href="/privacy.html">privacy</a>.</p>
  {/if}
</div>

<style>
  .cc{display:flex;flex-direction:column;gap:12px;max-width:640px;margin:0 auto}
  .cc-head{display:flex;gap:10px;align-items:flex-start}
  .cc-back{border:none;background:var(--bg3);color:var(--text);width:36px;height:36px;border-radius:50%;font-size:1.125rem;cursor:pointer;flex-shrink:0}
  .cc-title{font-family:var(--font-display);font-size:1.75rem;line-height:1.1;margin:0;color:var(--text)}
  .cc-sub{font-size:0.8125rem;color:var(--muted);margin:4px 0 0;line-height:1.45}
  .cc-off p{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 12px}
  .cc-list{display:flex;flex-direction:column;gap:8px}
  .cc-msg{max-width:86%;padding:10px 12px;border-radius:14px;font-size:0.9375rem;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
  .cc-msg.coach{align-self:flex-start;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-bottom-left-radius:4px}
  .cc-msg.user{align-self:flex-end;background:var(--amber);color:var(--bg);border-bottom-right-radius:4px}
  .cc-wait{color:var(--muted)}
  .cc-src{align-self:flex-start;display:flex;flex-wrap:wrap;gap:6px;font-size:0.75rem}
  .cc-src a{color:var(--amber)}
  .cc-card{align-self:flex-start;max-width:86%;background:var(--bg3);border:1px solid var(--border2);border-radius:12px;padding:10px 12px;display:grid;gap:8px}
  .cc-card.done{opacity:.75}
  .cc-card-what{font-size:0.875rem;font-weight:700;color:var(--text)}
  .cc-card-btns{display:flex;gap:8px}
  .cc-card-state{font-size:0.8125rem;color:var(--muted)}
  .cc-card-state.bad{color:var(--led-warn)}
  .cc-err{font-size:0.8125rem;color:var(--led-warn);margin:0}
  .cc-starters{display:flex;flex-wrap:wrap;gap:6px}
  .cc-chip{border:1px solid var(--border2);background:var(--bg2);color:var(--text);border-radius:999px;padding:7px 12px;font-family:inherit;font-size:0.8125rem;cursor:pointer}
  .cc-input{display:flex;gap:8px;align-items:flex-end}
  .cc-input textarea{flex:1;resize:none;font:inherit;font-size:0.9375rem;padding:10px 12px;border-radius:12px;border:1px solid var(--border2);background:var(--bg2);color:var(--text)}
  .cc-clear{align-self:center;border:none;background:none;color:var(--muted);text-decoration:underline;font-family:inherit;font-size:0.8125rem;cursor:pointer}
  .cc-note{font-size:0.75rem;color:var(--muted);margin:0;text-align:center}
  .cc-note a{color:var(--amber)}
</style>
