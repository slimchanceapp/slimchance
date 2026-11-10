<script lang="ts">
  import { buildGroups } from '$lib/data/workouts';
  import { DEFAULT_SESSIONS, type PlanDay, type PlanSession, type PlanExercise } from '$lib/data/workoutPlanDefaults';
  import { buildSchedule } from '$lib/data/planTemplates';
  import VideoEmbed from '$lib/components/VideoEmbed.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import ExerciseMedia from '$lib/components/ExerciseMedia.svelte';
  import { userId } from '$lib/stores/user';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveSchedule, liveWorkoutSessions, liveWorkoutLogs, liveSessionCompletions, liveGoalReason, liveActivitySessions, liveProfile } from '$lib/stores/live';
  import { programActive, programEnd } from '$lib/program';
  import type { WorkoutSet } from '$lib/db/dexie';
  import db from '$lib/db/dexie';
  import MiniChart from '$lib/components/MiniChart.svelte';
  import PageHero from '$lib/components/PageHero.svelte';
  import { trainingTone } from '$lib/week';
  import WorkoutInsights from '$lib/components/WorkoutInsights.svelte';
  import PlateWarmupCalc from '$lib/components/PlateWarmupCalc.svelte';
  import ProgramOffer from '$lib/components/ProgramOffer.svelte';
  import BackRebuild from '$lib/components/BackRebuild.svelte';
  import { inferEquipment, nextGymWeight, roundToGymWeight } from '$lib/nextWeight';
  import { speak } from '$lib/stores/toast';
  import { haptic } from '$lib/haptics';
  import { sessionLoad, acuteChronicRatio, MUSCLE_RECOVERY_HOURS, recoveryState, exerciseModifier } from '$lib/readiness';
  import type { RecoveryStatus } from '$lib/readiness';
  import { sessionMuscleLoad, activityLoadAU, isSameSessionAsLogged, trainedDates as trainedOn } from '$lib/health/exercise';
  import { todayYmd, mondayOf } from '$lib/date';
  import { nowTick, todayDate } from '$lib/stores/refresh';
  import { logManualActivity, QUICK_ACTIVITIES } from '$lib/health/logActivity';
  import { EXERCISE_TYPES } from '$lib/health/exercise';
  import { writeBackToHealth } from '$lib/health/writeBack';
  import WeekChooser from '$lib/components/WeekChooser.svelte';

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  let sessionKey = $state<string | null>(null);

  // While a rehab program runs, the analytics that measure you against your old
  // heavy training (volume, load balance, muscle recovery, PRs, "neglected")
  // are parked: light loads are the plan, and "volume down 40%" would read as
  // failing at exactly what you're meant to be doing. One tap still shows them.
  const _gymProfile = liveProfile();
  const gymProgram = $derived(($_gymProfile as any)?.program ?? null);
  const inProgram = $derived(programActive(gymProgram, $todayDate));
  let showParked = $state(false);
  const analytics = $derived(!inProgram || showParked);
  let builderMode = $state(false);
  let selectedGroup = $state<string | null>(null);
  // UPCOMING = what to do next. HISTORY = what actually happened.
  let tab = $state<'upcoming' | 'history'>('upcoming');
  let showAhead = $state(false);

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  // — Live, editable schedule + sessions. With no week saved yet, the page
  // asks how they move (WeekChooser) and shows a neutral gym week underneath
  // until they choose; nothing is saved for them. (It used to save that gym
  // week silently, so people who don't lift were handed one.)
  const _schedule = liveSchedule();
  const _sessions = liveWorkoutSessions();
  const _goalReason = liveGoalReason();
  const FALLBACK_SCHEDULE = buildSchedule({ templateId: 'gym3' });

  const schedule = $derived<PlanDay[]>($_schedule.length > 0 ? $_schedule : FALLBACK_SCHEDULE);
  const sessions = $derived<Map<string, PlanSession>>(
    $_sessions.size > 0 ? $_sessions : new Map(DEFAULT_SESSIONS.map((s) => [s.key, s]))
  );

  const _completions = liveSessionCompletions();
  let completions = $derived([...$_completions]);

  // — Hand-logging a session the watch missed —
  // Sport only ever reached the app via Health Connect, so a badminton night
  // played without the watch left recovery full and load reading low.
  let logActOpen = $state(false);
  let logActType = $state(2);
  let logActMins = $state(90);
  let logActDate = $state(todayYmd());
  let logActBusy = $state(false);
  let logActMsg = $state('');

  async function saveManualActivity() {
    if (!uid || logActBusy) return;
    logActBusy = true;
    logActMsg = '';
    try {
      await logManualActivity({
        uid, exerciseType: logActType, durationMin: logActMins, date: logActDate,
      });

      // Publish it back to Health Connect so the user's own workout history
      // agrees with itself whichever app they open. Never allowed to fail the
      // save the user actually asked for — writeBackToHealth swallows its own
      // errors and reports them, and no-ops entirely off the native app.
      const start = new Date(logActDate + 'T18:00:00');
      const written = await writeBackToHealth([{
        start,
        end: new Date(start.getTime() + logActMins * 60_000),
        title: EXERCISE_TYPES[logActType]?.label || 'Workout',
        exerciseType: logActType,
      }], []);
      logActMsg = written.written > 0 ? 'Logged ✓ · added to Health Connect' : 'Logged ✓';
      logActOpen = false;
      setTimeout(() => (logActMsg = ''), 3000);
    } catch (e: any) {
      logActMsg = e?.message || String(e);
    } finally {
      logActBusy = false;
    }
  }

  let markingComplete = $state(false);

  async function markComplete(key: string) {
    if (!uid) return;
    const today = todayYmd();
    // Idempotent: one completion per (date, session) — tapping twice must not
    // create a duplicate "gym entry". If it's already logged today, no-op.
    if (completions.some((c: any) => c.date === today && c.type === key)) {
      markingComplete = false;
      return;
    }
    markingComplete = true;
    try {
      await upsertRecord('sessions', {
        user_id: uid, date: today, type: key,
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Mark complete failed:', e);
    } finally { markingComplete = false; }
  }

  // Delete a logged completion (the user asked to fix/remove a mistaken or
  // duplicate gym entry). Removes from Dexie + Supabase by its row id.
  async function deleteCompletion(c: any) {
    if (!uid || c?.id == null) return;
    try {
      await db.table('sessions').delete(c.id);
      const { supabase } = await import('$lib/db/client');
      const { error } = await supabase.from('sessions').delete().eq('id', c.id).eq('user_id', uid);
      if (error) console.error('Completion delete failed:', error);
    } catch (e) { console.error('Completion delete failed:', e); }
  }

  // Rolling window starting from TODAY (not calendar Monday) -- e.g. if today
  // is Thursday, shows Thu→Wed instead of jumping back to Monday of the current
  // calendar week and including already-past days.
  //
  // 14 days, not 7: the old "Following 7 Days" tab reached days 8-14, and that
  // range has to survive the switch to UPCOMING/HISTORY or it is a silent
  // feature removal rather than a relocation.
  function getWeekDates(days: number, sched: PlanDay[]) {
    const start = new Date();
    const byDow = new Map(sched.map((d) => [d.day_of_week, d]));
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dow = d.getDay();
      const entry = byDow.get(dow) || { day_of_week: dow, label: DAY_NAMES[dow], session_key: null, note: '' };
      return { ...entry, date: d, dayName: DAY_NAMES[dow] };
    });
  }

  const weekDays = $derived(getWeekDates(14, schedule));

  // A day's name as shown. While a program runs its session replaces the gym
  // day's, so the day is named after it — never after the heavy session the
  // program is standing in for. The schedule row itself keeps its own label
  // (the day editor reads and saves that), so nothing here is ever persisted.
  function dayLabel(day: { label: string; session_key?: string | null }): string {
    const s = day.session_key ? sessions.get(day.session_key) : undefined;
    return s?.program ? s.name : day.label;
  }

  function closeModal() { sessionKey = null; }
  const modalOpen = $derived(sessionKey !== null);

  // — Editing: day schedule (label / note / which session) —
  let editingDow = $state<number | null>(null);
  let editLabel = $state('');
  let editNote = $state('');
  let editSessionKey = $state<string>('');

  function startEditDay(d: PlanDay) {
    editingDow = d.day_of_week;
    editLabel = d.label;
    editNote = d.note;
    editSessionKey = d.session_key || '';
  }

  async function saveEditDay() {
    if (editingDow === null || !uid) return;
    try {
      await upsertRecord('workout_schedule', {
        user_id: uid, day_of_week: editingDow,
        label: editLabel, note: editNote,
        session_key: editSessionKey || null,
        updated_at: new Date().toISOString(),
      });
      editingDow = null;
    } catch (e) { console.error('Day save failed:', e); }
  }

  // — Editing: session name/duration/focus + exercises —
  let editingSession = $state(false);

  /** Persist a change to one of the user's OWN sessions. A program session is
   *  an overlay (see $lib/program): saving it would write the program over
   *  their plan, so it is never saved. One function instead of four copies. */
  async function saveSession(key: string | null, change: (s: PlanSession) => Partial<PlanSession>, what: string) {
    const sess = key ? sessions.get(key) : undefined;
    if (!sess || !uid || sess.program) return;
    try {
      await upsertRecord('workout_sessions_custom', {
        user_id: uid, ...sess, ...change(sess), updated_at: new Date().toISOString(),
      });
    } catch (e) { console.error(`${what} failed:`, e); }
  }
  const saveSessionField = (key: string | null, field: keyof PlanSession, value: string) =>
    saveSession(key, () => ({ [field]: value }), 'Session save');
  const saveExerciseField = (key: string | null, idx: number, field: keyof PlanExercise, value: string) =>
    saveSession(key, (s) => ({ exercises: s.exercises.map((e, i) => (i === idx ? { ...e, [field]: value } : e)) }), 'Exercise save');
  const removeExercise = (key: string | null, idx: number) =>
    saveSession(key, (s) => ({ exercises: s.exercises.filter((_, i) => i !== idx) }), 'Exercise remove');
  const addExercise = (key: string | null) =>
    saveSession(key, (s) => ({
      exercises: [...s.exercises, { phase: 'New Phase', name: 'New Exercise', muscle: '', w1: '3 × 10', w2: '3 × 10', rest: '60s', tip: '' }],
    }), 'Exercise add');

  // — Workout logging: actual weight × reps performed per set, per
  // exercise, per day. Powers "last time" progressive-overload prompts
  // and a running tonnage (volume) total for today's session.
  const _logs = liveWorkoutLogs();
  const today = todayYmd();

  function lastLogFor(name: string) {
    const rows = $_logs.filter((r: any) => r.exercise_name === name && r.date < today);
    if (rows.length === 0) return null;
    return rows.reduce((a: any, b: any) => (a.date > b.date ? a : b));
  }

  function todayLogFor(name: string) {
    return $_logs.find((r: any) => r.exercise_name === name && r.date === today) || null;
  }

  /** A Quick Builder exercise in the shape the logger takes ("4 × 12" is its week). */
  const asPlan = (ex: { name: string; muscle: string; sets: string; rest: string; tip?: string; vid?: string }): PlanExercise =>
    ({ phase: '', name: ex.name, muscle: ex.muscle, w1: ex.sets, w2: ex.sets, rest: ex.rest, tip: ex.tip ?? '', vid: ex.vid });

  function parseSetsCount(w1: string): number {
    const m = /^(\d+)/.exec(w1 || '');
    return m ? parseInt(m[1], 10) : 3;
  }

  let expandedLog = $state<Set<string>>(new Set());
  let logDrafts = $state<Record<string, WorkoutSet[]>>({});
  let logSavedMsg = $state<Record<string, string>>({});

  function fmtSets(sets: WorkoutSet[]): string {
    const parts = sets
      .filter((s) => s.reps != null || s.weight_kg != null)
      .map((s) => `${s.reps ?? '–'}×${s.weight_kg ?? '–'}kg`);
    return parts.length ? parts.join(' · ') : '—';
  }

  function toggleLog(ex: PlanExercise) {
    const set = new Set(expandedLog);
    if (set.has(ex.name)) {
      set.delete(ex.name);
    } else {
      set.add(ex.name);
      if (!logDrafts[ex.name]) {
        const t = todayLogFor(ex.name);
        const last = lastLogFor(ex.name);
        const count = parseSetsCount(ex.w1);
        let seed: WorkoutSet[];
        if (t) seed = t.sets.map((s: WorkoutSet) => ({ ...s }));
        else if (last) seed = last.sets.map((s: WorkoutSet) => ({ ...s })); // start from last time's numbers
        else seed = Array.from({ length: count }, () => ({ reps: null, weight_kg: null }));
        logDrafts = { ...logDrafts, [ex.name]: seed };
      }
    }
    expandedLog = set;
  }

  function updateSetField(name: string, idx: number, field: 'reps' | 'weight_kg', raw: string) {
    const val = raw === '' ? null : Number(raw);
    const sets = logDrafts[name].map((s, i) => (i === idx ? { ...s, [field]: val } : s));
    logDrafts = { ...logDrafts, [name]: sets };
  }

  function addSetRow(name: string) {
    logDrafts = { ...logDrafts, [name]: [...logDrafts[name], { reps: null, weight_kg: null }] };
  }

  function removeSetRow(name: string, idx: number) {
    logDrafts = { ...logDrafts, [name]: logDrafts[name].filter((_, i) => i !== idx) };
  }

  async function saveLog(ex: PlanExercise, key: string | null = sessionKey) {
    if (!uid) return;
    haptic('tap');
    const sets = (logDrafts[ex.name] || []).filter((s) => s.reps != null || s.weight_kg != null);
    // Snapshot the prior all-time best BEFORE the save lands, so we can tell if
    // what was just logged is a genuine PR (personalRecord() reads $_logs, which
    // will include today the instant the upsert resolves).
    const priorPR = personalRecord(ex.name);
    try {
      await upsertRecord('workout_logs', {
        user_id: uid, date: today, exercise_name: ex.name,
        session_key: key, sets, updated_at: new Date().toISOString(),
      });
      logSavedMsg = { ...logSavedMsg, [ex.name]: 'Logged ✓' };
      setTimeout(() => { const m = { ...logSavedMsg }; delete m[ex.name]; logSavedMsg = m; }, 2500);
      announceLift(ex, sets, priorPR);
    } catch (e: any) {
      logSavedMsg = { ...logSavedMsg, [ex.name]: `Error: ${e?.message || e}` };
    }
  }

  // The app talks back the moment a set is logged: a PR gets celebrated, and
  // otherwise it points at the exact next weight to chase — always a load that
  // exists on the gym floor (17.5 → 20, never 18.5).
  function announceLift(ex: PlanExercise, sets: WorkoutSet[], priorPR: ReturnType<typeof personalRecord>) {
    const best = bestSetOf(sets);
    if (!best) return;
    const priorRM = priorPR?.best.oneRM ?? 0;
    // A real PR: beats the old estimated 1RM by more than rounding noise, and
    // isn't the very first time the lift is ever logged.
    if (priorPR && best.oneRM > priorRM + 0.5) {
      speak(`pr-${ex.name}-${today}`,
        `New PR: ${ex.name} 🏆`,
        {
          tone: 'good', icon: '🏆', ttl: 8000,
          body: `${best.weight_kg}kg × ${best.reps} (est. 1RM ${Math.round(best.oneRM)}kg) — getting stronger while dieting is the whole game.`,
        });
      // A PR is the biggest moment in the app — give it the full celebration
      // pattern, overriding the generic success buzz speak() just fired.
      haptic('celebrate');
      return;
    }
    const s = progressionSuggestion(ex);
    if (s && s.type === 'up') {
      speak(`lift-up-${ex.name}-${today}`, `${ex.name} logged 💪`,
        { tone: 'ok', icon: '📈', body: s.text });
    }
  }

  // Today's total tonnage (Σ weight × reps across every logged set today),
  // shown as a running badge in the open session modal.
  const todayVolume = $derived(
    $_logs
      .filter((r: any) => r.date === today)
      .reduce((sum: number, r: any) => sum + r.sets.reduce((s: number, set: WorkoutSet) => s + (set.reps || 0) * (set.weight_kg || 0), 0), 0)
  );

  // Watch-recorded sessions (badminton, runs, strength) synced from the OnePlus
  // watch via Health Connect. Declared here because recovery and training load
  // below both depend on them — sport is real training, not decoration.
  const _activity = liveActivitySessions();

  // — Muscle recovery grid (Fitbod-style) —
  // Canonical muscle groups we track; every exercise's free-text "muscle"
  // field (e.g. "Quads · Glutes") is matched against these via substring
  // search to attribute logged sets to the right group(s).
  const MUSCLE_GROUPS = ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Core'];

  function groupsFor(muscleText: string): string[] {
    const text = (muscleText || '').toLowerCase();
    return MUSCLE_GROUPS.filter((g) => text.includes(g.toLowerCase()));
  }

  // Map every known exercise name -> its muscle text, built from all
  // sessions currently loaded (covers both default + user-edited plans).
  const exerciseMuscleMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const sess of sessions.values()) {
      for (const ex of sess.exercises) map.set(ex.name, ex.muscle);
    }
    return map;
  });

  interface MuscleExerciseHit { name: string; date: string; hoursAgo: number; sets: number }
  interface MuscleStatus {
    group: string; lastDate: string | null; hoursAgo: number | null;
    windowH: number; pct: number; readyInH: number;
    status: RecoveryStatus; exercises: MuscleExerciseHit[];
  }

  // Best available timestamp for WHEN a muscle was actually worked. Prefer
  // the log's real time (updated_at/created_at) so an evening session isn't
  // mis-counted as noon; fall back to midday of the log date only if no
  // timestamp exists. This was the core recovery bug: assuming every
  // workout happened at 12:00 inflated "hours ago" and kept muscles stuck
  // on "recovering".
  function logTimeMs(log: any): number {
    const iso = log.updated_at || log.created_at;
    if (iso) { const t = new Date(iso).getTime(); if (!isNaN(t)) return t; }
    return new Date(log.date + 'T12:00:00').getTime();
  }

  const muscleRecovery = $derived.by((): MuscleStatus[] => {
    // Read the reactive clock, not Date.now(): a $derived only recomputes when
    // a reactive dependency changes, so an app left open showed the same
    // "ready in 14h" all night. $nowTick advances on a timer, when the app
    // returns to the foreground, and on every pull-to-refresh.
    const nowMs = $nowTick;
    const lastMs = new Map<string, number>();       // group -> most recent train time
    const lastDate = new Map<string, string>();     // group -> date string
    const hits = new Map<string, MuscleExerciseHit[]>(); // group -> recent exercise hits (7d)
    // group -> recovery-window multiplier from the most recent session that hit
    // it. Lifting uses exerciseModifier(); sport uses its muscle-load fraction.
    const modAt = new Map<string, number>();

    function record(group: string, tMs: number, date: string, hit: MuscleExerciseHit, modifier: number) {
      const prev = lastMs.get(group);
      if (prev == null || tMs > prev) {
        lastMs.set(group, tMs);
        lastDate.set(group, date);
      }
      if (hit.hoursAgo <= 24 * 7) {
        const arr = hits.get(group) ?? [];
        arr.push(hit);
        hits.set(group, arr);
        // Track the heaviest modifier seen on the muscle's latest training day.
        const key = `${group}|${date}`;
        modAt.set(key, Math.max(modAt.get(key) ?? 0, modifier));
      }
    }

    // Dates the user hand-logged sets on. Used below to recognise when a watch
    // session and a set log are the SAME gym session — see handLoggedDates.
    const loggedDates = new Set($_logs.map((l) => l.date));

    // 1. Logged gym sets (unchanged behaviour).
    for (const log of $_logs) {
      const muscleText = exerciseMuscleMap.get(log.exercise_name);
      if (!muscleText) continue;
      const tMs = logTimeMs(log);
      const hoursAgo = (nowMs - tMs) / 36e5;
      const modifier = exerciseModifier(log.exercise_name);
      for (const g of groupsFor(muscleText)) {
        record(g, tMs, log.date, { name: log.exercise_name, date: log.date, hoursAgo, sets: log.sets?.length ?? 0 }, modifier);
      }
    }

    // 2. Watch-recorded sport/cardio — THE FIX for badminton being invisible
    // here. A session's muscle involvement (see ACTIVITY_MUSCLE_LOAD) scales the
    // recovery window: badminton at 0.7 on quads consumes 70% of a full quad
    // recovery window, so the grid stops claiming your legs are fresh the
    // morning after a two-hour match. A watch session that duplicates a
    // hand-logged gym day is dropped first — counting the sets AND the watch's
    // record of the same hour would double up the same work.
    for (const a of ($_activity as any[]) || []) {
      if (isSameSessionAsLogged(a, loggedDates)) continue;
      const load = sessionMuscleLoad(a);
      const tMs = new Date(a.end || a.start).getTime();
      if (!isFinite(tMs)) continue;
      const hoursAgo = (nowMs - tMs) / 36e5;
      for (const [group, frac] of Object.entries(load)) {
        if (frac <= 0.05) continue; // below this it isn't real fatigue
        record(group, tMs, a.date, { name: `${a.emoji} ${a.label} (${a.duration_min}min)`, date: a.date, hoursAgo, sets: 0 }, frac as number);
      }
    }

    return MUSCLE_GROUPS.map((group) => {
      const base = MUSCLE_RECOVERY_HOURS[group] ?? 48;
      const tMs = lastMs.get(group);
      if (tMs == null) return { group, lastDate: null, hoursAgo: null, windowH: base, pct: 0, readyInH: 0, status: 'none' as const, exercises: [] };
      const hoursAgo = (nowMs - tMs) / 36e5;
      const exercises = (hits.get(group) ?? []).sort((a, b) => a.hoursAgo - b.hoursAgo);
      // Window scales with the MOST damaging thing from the latest session that
      // hit this muscle: an RDL stretches the window, a leg extension shortens
      // it, a badminton night sits in between. (Falls back to base if >7d old.)
      const latestDate = lastDate.get(group);
      const modifier = modAt.get(`${group}|${latestDate}`) ?? 1.0;
      const windowH = Math.round(base * modifier);
      const { status, pct, readyInH } = recoveryState(hoursAgo, windowH);
      return { group, lastDate: latestDate ?? null, hoursAgo, windowH, pct, readyInH, status, exercises };
    });
  });

  let recoveryFlipped = $state(false);
  let recFrontH = $state(0);
  let recBackH = $state(0);
  // Short human phrase for a muscle's recovery: "Ready", "Ready in ~Xh",
  // or "Rest — Xh left" so the grid explains itself.
  function recoveryPhrase(m: MuscleStatus): string {
    if (m.status === 'none') return 'No data';
    if (m.status === 'ready') return 'Ready';
    if (m.readyInH >= 24) return `~${(m.readyInH / 24).toFixed(1)}d to go`;
    return `~${m.readyInH}h to go`;
  }
  function hoursAgoPhrase(h: number | null): string {
    if (h == null) return '—';
    if (h < 1) return 'just now';
    if (h < 24) return `${Math.round(h)}h ago`;
    return `${(h / 24).toFixed(1)}d ago`;
  }

  // — Training load balance (WHOOP-style acute:chronic ratio) —
  // Uses the validated session-RPE method (Foster et al. 2001): training
  // load = total sets logged that day × ~3 min/set × an assumed RPE of 7
  // (a reasonable default for logged working sets; we don't currently
  // capture subjective RPE per session). Compares the last 7 days'
  // average daily load to the last 28 days' -- a ratio consistently
  // above ~1.5 is a well-documented injury-risk signal in sports science.
  // Watch sessions count too: an acute:chronic ratio computed from gym sets
  // alone was blind to two badminton nights a week, so it under-read training
  // stress exactly when injury risk was highest. Watch sessions use real
  // duration × an HR-derived RPE (better than the set-count proxy); a watch
  // session that is the same gym session you already typed in is dropped by
  // isSameSessionAsLogged() so one workout can't be counted twice.
  const trainingLoad = $derived.by(() => {
    const byDate = new Map<string, number>();
    for (const log of $_logs) {
      byDate.set(log.date, (byDate.get(log.date) ?? 0) + log.sets.length);
    }
    const loads = new Map<string, number>();
    for (const [date, setCount] of byDate) loads.set(date, sessionLoad(setCount, 7));
    const loggedDates = new Set(byDate.keys());
    for (const a of ($_activity as any[]) || []) {
      if (isSameSessionAsLogged(a, loggedDates)) continue; // don't count one session twice
      loads.set(a.date, (loads.get(a.date) ?? 0) + activityLoadAU(a));
    }
    return acuteChronicRatio([...loads.entries()].map(([date, loadAU]) => ({ date, loadAU })), today);
  });

  // — Insights & inspiration from the workout history —
  // The log already captures every set; this turns that raw history into a
  // few plain-language takeaways (volume trend, recent PRs, a neglected
  // muscle, training frequency) that feed straight back into the goal:
  // preserving/adding lean mass while dieting.
  let showInsights = $state(false);
  let showLoadHelp = $state(false);

  function activityWhen(iso: string): string {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(iso); that.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - that.getTime()) / 86400000);
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (days === 0) return `Today ${time}`;
    if (days === 1) return `Yesterday ${time}`;
    if (days < 7) return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // What actually happened, day by day — the record the HISTORY tab is FOR.
  //
  // Nothing in this page rendered it before: historyFor() is per-exercise, and
  // the by-date maps computed for training load were never displayed. So the
  // app could tell you your 28-day tonnage but not what you did on Tuesday.
  //
  // Merges both sources deliberately: hand-logged sets (what you lifted) and
  // watch sessions (what your body did). A day can have either or both, and a
  // day with only a watch session is still a training day.
  const historyDays = $derived.by(() => {
    const byDate = new Map<string, {
      date: string;
      lifts: any[];
      sessions: any[];
      tonnage: number;
      sets: number;
    }>();
    const row = (date: string) => {
      let r = byDate.get(date);
      if (!r) { r = { date, lifts: [], sessions: [], tonnage: 0, sets: 0 }; byDate.set(date, r); }
      return r;
    };

    for (const log of ($_logs as any[]) || []) {
      if (!log?.date) continue;
      const r = row(log.date);
      r.lifts.push(log);
      for (const st of (log.sets || []) as WorkoutSet[]) {
        r.tonnage += (st.reps || 0) * (st.weight_kg || 0);
        r.sets += 1;
      }
    }
    for (const a of ($_activity as any[]) || []) {
      if (!a?.date) continue;
      row(a.date).sessions.push(a);
    }

    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  });

  function historyDayLabel(ymdStr: string): string {
    const [y, m, d] = ymdStr.split('-').map(Number);
    if (!y || !m || !d) return ymdStr;
    const dt = new Date(y, m - 1, d);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const days = Math.round((t.getTime() - dt.getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    const base = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return days < 7 ? base : base;
  }

  const historyInsights = $derived.by(() => {
    const logs = $_logs;
    if (!logs || logs.length === 0) return null;
    const nowMs = $nowTick;
    const dayMs = 86400000;
    const tonnageOf = (log: any) => (log.sets || []).reduce((s: number, x: WorkoutSet) => s + (x.reps || 0) * (x.weight_kg || 0), 0);

    const dates = new Set(logs.map((l: any) => l.date));
    let totalTonnage = 0, totalSets = 0, vol7 = 0, volPrev7 = 0;
    const sessionDays14 = new Set<string>();
    const muscleSets14 = new Map<string, number>();

    for (const log of logs) {
      const tn = tonnageOf(log);
      totalTonnage += tn; totalSets += (log.sets?.length || 0);
      const ageDays = (nowMs - logTimeMs(log)) / dayMs;
      if (ageDays <= 7) vol7 += tn;
      else if (ageDays <= 14) volPrev7 += tn;
      if (ageDays <= 14) {
        sessionDays14.add(log.date);
        const mt = exerciseMuscleMap.get(log.exercise_name);
        if (mt) for (const g of groupsFor(mt)) muscleSets14.set(g, (muscleSets14.get(g) || 0) + (log.sets?.length || 0));
      }
    }
    const volDeltaPct = volPrev7 > 0 ? Math.round(((vol7 - volPrev7) / volPrev7) * 100) : null;
    const perWeek = Math.round((sessionDays14.size / 2) * 10) / 10;

    const exNames = [...new Set(logs.map((l: any) => l.exercise_name))];
    const recentPRs: Array<{ name: string; date: string; oneRM: number; weight_kg: number; reps: number }> = [];
    for (const name of exNames) {
      const pr = personalRecord(name);
      if (!pr) continue;
      const ageDays = (nowMs - new Date(pr.date + 'T12:00:00').getTime()) / dayMs;
      if (ageDays <= 14) recentPRs.push({ name, date: pr.date, oneRM: pr.best.oneRM, weight_kg: pr.best.weight_kg, reps: pr.best.reps });
    }
    recentPRs.sort((a, b) => b.oneRM - a.oneRM);

    const neglected = muscleRecovery
      .filter((m) => m.status === 'none' || (m.hoursAgo != null && m.hoursAgo > m.windowH * 1.6))
      .sort((a, b) => (b.hoursAgo ?? 1e9) - (a.hoursAgo ?? 1e9));

    let topMuscle: string | null = null, topSets = 0;
    for (const [g, c] of muscleSets14) if (c > topSets) { topSets = c; topMuscle = g; }

    return {
      totalSessions: dates.size, totalTonnage, totalSets,
      vol7, volPrev7, volDeltaPct, perWeek, sessions14: sessionDays14.size,
      recentPRs, neglected, topMuscle, topSets,
    };
  });

  // — Personal records + per-exercise progress chart —
  // Epley formula estimated 1RM: weight × (1 + reps/30). Used to compare
  // sets of different rep ranges on a level footing for "best ever".
  function estOneRM(reps: number, weight: number): number {
    return weight * (1 + reps / 30);
  }

  function bestSetOf(sets: WorkoutSet[]): { reps: number; weight_kg: number; oneRM: number } | null {
    const valid = sets.filter((s) => s.reps != null && s.weight_kg != null) as Array<{ reps: number; weight_kg: number }>;
    if (valid.length === 0) return null;
    return valid.reduce((best, s) => {
      const rm = estOneRM(s.reps, s.weight_kg);
      return rm > estOneRM(best.reps, best.weight_kg) ? { ...s, oneRM: rm } : { ...best, oneRM: estOneRM(best.reps, best.weight_kg) };
    }, { ...valid[0], oneRM: estOneRM(valid[0].reps, valid[0].weight_kg) });
  }

  function historyFor(name: string) {
    return $_logs
      .filter((r: any) => r.exercise_name === name)
      .map((r: any) => ({ date: r.date as string, best: bestSetOf(r.sets) }))
      .filter((r): r is { date: string; best: NonNullable<ReturnType<typeof bestSetOf>> } => r.best != null)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function personalRecord(name: string) {
    const hist = historyFor(name);
    if (hist.length === 0) return null;
    return hist.reduce((pr, h) => (h.best.oneRM > pr.best.oneRM ? h : pr));
  }

  // — Auto-progression suggestion (Fitbod/Strong-style) —
  // Rule-based, no ML: parse the exercise's target rep range from its w1
  // field (e.g. "4 × 6-8" -> min 6, max 8). Compare every set from the
  // most recent logged session against that range:
  //   - every set met/beat the TOP of the range -> suggest weight up
  //   - every set met at least the BOTTOM of the range -> hold weight,
  //     push for more reps
  //   - any set fell more than 2 reps short of the bottom (a near-miss/
  //     failure signal) -> suggest a 10% deload
  // This mirrors the well-established progressive-overload heuristic
  // used by Fitbod/Strong, without needing any external ML service.
  function parseRepRange(w1: string): { min: number; max: number } | null {
    const m = /(\d+)\s*-\s*(\d+)/.exec(w1 || '');
    if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
    const single = /×\s*(\d+)/.exec(w1 || '') || /x\s*(\d+)/i.exec(w1 || '');
    if (single) return { min: parseInt(single[1], 10), max: parseInt(single[1], 10) };
    return null;
  }

  interface ProgressionSuggestion { type: 'up' | 'hold' | 'deload'; text: string; }

  function progressionSuggestion(ex: PlanExercise): ProgressionSuggestion | null {
    const last = lastLogFor(ex.name);
    if (!last) return null;
    const sets = last.sets.filter((s: WorkoutSet) => s.reps != null && s.weight_kg != null) as Array<{ reps: number; weight_kg: number }>;
    if (sets.length === 0) return null;
    const range = parseRepRange(ex.w1);
    if (!range) return null;

    const topWeight = Math.max(...sets.map((s) => s.weight_kg));
    const allHitTop = sets.every((s) => s.reps >= range.max);
    const allHitBottom = sets.every((s) => s.reps >= range.min);
    const anyBigMiss = sets.some((s) => s.reps <= range.min - 3);

    // Snap every number to a weight that actually exists on a gym floor: fixed
    // dumbbells jump 17.5 → 20 (there is no 18.75 on the rack), a barbell moves
    // in 2.5kg plate-pairs, etc. inferEquipment reads the kit from the name.
    const equip = inferEquipment(ex.name);

    if (anyBigMiss) {
      const deload = roundToGymWeight(topWeight * 0.9, equip) ?? Math.round((topWeight * 0.9) / 2.5) * 2.5;
      return { type: 'deload', text: `Missed reps badly last time — drop to ${deload}kg to reset, then build back up.` };
    }
    if (allHitTop) {
      // The next REAL load up — never a phantom in-between number. Bodyweight
      // moves have no next kilo, so we coach reps instead.
      const next = nextGymWeight(topWeight, equip);
      if (next == null) {
        return { type: 'up', text: `You're hitting the top of the range — add reps or slow the tempo to keep progressing.` };
      }
      return { type: 'up', text: `Hit the top of your rep range — go to ${next}kg next time (next weight on the ${equip === 'dumbbell' ? 'rack' : 'bar'}).` };
    }
    if (allHitBottom) {
      return { type: 'hold', text: `Same weight (${topWeight}kg) — aim for ${range.max} reps this time.` };
    }
    return { type: 'hold', text: `Stick with ${topWeight}kg and focus on clean reps.` };
  }

  let expandedHistory = $state<Set<string>>(new Set());
  function toggleHistory(name: string) {
    const set = new Set(expandedHistory);
    set.has(name) ? set.delete(name) : set.add(name);
    expandedHistory = set;
  }

  // — Rest timer —
  // Parses e.g. "120-150s" or "60s" or "2 min" into a starting seconds
  // count; runs a simple countdown with a vibration + chime on completion.
  let restTimer = $state<{ name: string; remaining: number; total: number } | null>(null);
  let restInterval: ReturnType<typeof setInterval> | null = null;

  function parseRestSeconds(rest: string): number {
    const s = (rest || '').toLowerCase();
    const rangeMatch = /(\d+)\s*-\s*(\d+)/.exec(s);
    if (rangeMatch) return parseInt(rangeMatch[2], 10);
    const minMatch = /(\d+)\s*min/.exec(s);
    if (minMatch) return parseInt(minMatch[1], 10) * 60;
    const secMatch = /(\d+)\s*s/.exec(s);
    if (secMatch) return parseInt(secMatch[1], 10);
    return 60;
  }

  function startRestTimer(ex: PlanExercise) {
    if (restInterval) clearInterval(restInterval);
    const total = parseRestSeconds(ex.rest);
    restTimer = { name: ex.name, remaining: total, total };
    restInterval = setInterval(() => {
      if (!restTimer) return;
      const remaining = restTimer.remaining - 1;
      if (remaining <= 0) {
        if (restInterval) clearInterval(restInterval);
        restInterval = null;
        restTimer = { ...restTimer, remaining: 0 };
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          osc.frequency.value = 880;
          osc.connect(ctx.destination);
          osc.start();
          setTimeout(() => osc.stop(), 300);
        } catch {}
        setTimeout(() => { restTimer = null; }, 3000);
      } else {
        restTimer = { ...restTimer, remaining };
      }
    }, 1000);
  }

  function cancelRestTimer() {
    if (restInterval) clearInterval(restInterval);
    restInterval = null;
    restTimer = null;
  }

  // ── DRIVE hero ── training consistency is the engine of a recomp, and this
  // app treats sport as real training — so a badminton night counts exactly
  // like a lifting session. The orb fills with training days done THIS CALENDAR
  // WEEK (Monday→today, matching the local week) against your actual plan (every
  // gym + sport day the plan schedules), not a rolling 7-day window or a fixed 4.
  function isTrainingDay(w: any): boolean {
    if (w?.session_key) return true;
    const note = (w?.note || '').toLowerCase();
    return w?.label === 'Cardio & Agility' || note.includes('counts as training');
  }
  const weeklyTarget = $derived(Math.max(1, schedule.filter((d: any) => isTrainingDay(d)).length));
  const gymSessions7 = $derived.by(() => {
    void $nowTick;
    const start = mondayOf(new Date());
    const today = todayYmd();
    const set = new Set<string>();
    for (const c of completions as any[]) if (c.date >= start && c.date <= today) set.add(c.date);
    for (const a of (($_activity as any[]) || [])) if (a.date >= start && a.date <= today) set.add(a.date);
    return set.size;
  });
  const gymPct = $derived(Math.min(100, (gymSessions7 / weeklyTarget) * 100));
  const gymTone = $derived.by(() => {
    void $nowTick;
    return trainingTone(gymSessions7, weeklyTarget, schedule.filter((d: any) => isTrainingDay(d)).map((d: any) => d.day_of_week), new Date().getDay());
  });
  // For a sport night the plan label is the generic "Cardio & Agility"; the
  // human name (e.g. "Badminton") lives at the head of the note.
  function sessionDisplayName(w: any): string {
    if (!w) return '';
    if (w.session_key) return dayLabel(w);
    const first = (w.note || '').split('—')[0].trim();
    return first || w.label;
  }
  // Every date that already has training on it, by ANY of the three routes a
  // session can arrive: marking the plan complete, a watch/manual activity
  // session, or typing real sets in. Missing one of these was the bug below.
  const trainedDates = $derived(trainedOn(completions as any[], ($_activity as any[]) || [], ($_logs as any[]) || []));

  // "Next up" is the next training day you have NOT done yet.
  //
  // It used to be the first training day in the coming fortnight, full stop —
  // and weekDays starts at TODAY. So on a training day the answer was "today",
  // and it STAYED "today" after you marked the session complete and after the
  // watch reported it: the card cheerfully told you to do the workout you had
  // just finished. Skipping days already covered is the whole fix.
  const nextTraining = $derived(
    weekDays.find((w: any) => isTrainingDay(w) && !trainedDates.has(ymdOf(w.date)))
  );
  const trainedToday = $derived(trainedDates.has(todayYmd()));

  function ymdOf(d: Date | string): string {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  const gymStory = $derived.by(() => {
    void $nowTick;
    if (gymSessions7 >= weeklyTarget) return 'Week complete 💪';
    if (nextTraining) {
      const isToday = ymdOf(nextTraining.date) === todayYmd();
      const next = `Next: ${sessionDisplayName(nextTraining)}${isToday ? ' today' : ' ' + nextTraining.dayName}`;
      // Say the session is banked before naming the next one, or "Next: … Thu"
      // on the evening you trained reads as though today never registered.
      return trainedToday ? `Today's session is in ✓ · ${next}` : next;
    }
    return trainedToday ? "Today's session is in ✓ · rest until next week" : 'Rest day';
  });
</script>

<!-- One logger for every exercise: a session's, or one picked in the Quick
     Builder (2026-11-03: a built session couldn't be logged at all). -->
{#snippet exerciseLog(ex: PlanExercise, key: string | null)}
  {@const last = lastLogFor(ex.name)}
  {@const pr = personalRecord(ex.name)}
  {@const suggestion = progressionSuggestion(ex)}
  <!-- Whole row is the tap target — no more hunting the tiny toggle. -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="log-row log-row-tap" role="button" tabindex="0"
    onclick={() => toggleLog(ex)}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLog(ex); } }}>
    <div class="last-perf">
      {#if last}Last time ({last.date}): {fmtSets(last.sets)}{:else}No history yet{/if}
    </div>
    <span class="log-toggle">
      {expandedLog.has(ex.name) ? 'Hide log' : 'Log sets ✎'}
    </span>
  </div>
  {#if suggestion}
    <div class="suggestion-badge" class:up={suggestion.type === 'up'} class:deload={suggestion.type === 'deload'}>
      {suggestion.type === 'up' ? '📈' : suggestion.type === 'deload' ? '⚠️' : '➡️'} {suggestion.text}
    </div>
  {/if}
  {#if pr}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="pr-row pr-row-tap" role="button" tabindex="0"
      onclick={() => toggleHistory(ex.name)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHistory(ex.name); } }}>
      <span class="pr-badge">🏆 PR: {pr.best.weight_kg}kg × {pr.best.reps} <span class="pr-date">({pr.date})</span></span>
      <span class="log-toggle">
        {expandedHistory.has(ex.name) ? 'Hide chart' : 'Progress 📈'}
      </span>
    </div>
  {/if}
  {#if expandedHistory.has(ex.name)}
    {@const hist = historyFor(ex.name)}
    <div class="history-chart">
      <MiniChart data={hist.map((h) => ({ date: h.date, value: h.best.oneRM }))} color="var(--green, #2ecc71)" />
      <div class="hc-label">Estimated 1-rep max over time (Epley formula)</div>
    </div>
  {/if}
  {#if expandedLog.has(ex.name)}
    {@const last = lastLogFor(ex.name)}
    {@const bestSet = last ? bestSetOf(last.sets) : null}
    <div class="log-form">
      {#each logDrafts[ex.name] || [] as set, si}
        <div class="log-set-row">
          <span class="set-idx">Set {si + 1}</span>
          <input type="number" inputmode="decimal" placeholder="kg" value={set.weight_kg ?? ''}
            onchange={(e) => updateSetField(ex.name, si, 'weight_kg', (e.target as HTMLInputElement).value)} />
          <span class="x">×</span>
          <input type="number" inputmode="numeric" placeholder="reps" value={set.reps ?? ''}
            onchange={(e) => updateSetField(ex.name, si, 'reps', (e.target as HTMLInputElement).value)} />
          <span class="rm-set" onclick={() => removeSetRow(ex.name, si)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeSetRow(ex.name, si); } }}>✕</span>
        </div>
      {/each}
      <div class="flex gap2" style="margin-top:6px">
        <button class="btn bg_ bsm" onclick={() => addSetRow(ex.name)}>+ Set</button>
        <button class="btn bg_ bsm" onclick={() => startRestTimer(ex)}>⏱ Rest {parseRestSeconds(ex.rest)}s</button>
        <button class="btn bp bsm" onclick={() => saveLog(ex, key)}>Save log</button>
      </div>
      {#if logSavedMsg[ex.name]}
        <div class="log-msg" class:err={logSavedMsg[ex.name].startsWith('Error')}>{logSavedMsg[ex.name]}</div>
      {/if}
      <PlateWarmupCalc targetKg={bestSet?.weight_kg ?? 40} />
    </div>
  {/if}
{/snippet}


{#if uid && $_schedule.length === 0}
<!-- No week yet: the choice first, and no made-up week's numbers behind it. -->
<PageHero title="Train" sub="Your week" />
<WeekChooser {uid} />
{:else}
<PageHero title="Train" sub="This week"
  tone={gymTone} pct={gymPct}
  value={gymSessions7} caption={`of ${weeklyTarget} this week`}
  story={gymStory}
  stats={[
    { v: gymSessions7, l: 'done' },
    { v: Math.max(0, weeklyTarget - gymSessions7), l: 'to go' },
    { v: nextTraining ? nextTraining.dayName.slice(0, 3) : '—', l: 'next up' }
  ]} />

<BackRebuild onOpenSession={(k) => (sessionKey = k)} />

<div class="week-tabs">
  <button class="wtab" class:on={tab === 'upcoming'} onclick={() => tab = 'upcoming'}>Upcoming</button>
  <button class="wtab" class:on={tab === 'history'} onclick={() => tab = 'history'}>History</button>
</div>

{#if tab === 'upcoming'}

  {#snippet dayCard(day: ReturnType<typeof getWeekDates>[number], isToday: boolean)}
    <div class="card" style="padding:10px 12px">
      <div class="flex jb ac" style="margin-bottom:4px">
        <div style="font-size:0.75rem;color:var(--muted);font-weight:600">{isToday ? 'Today' : day.date.toLocaleDateString('en-US', { month:'short', day:'numeric' })}</div>
        <div class="flex ac gap2">
          <div style="font-size:0.75rem;font-weight:700">{day.dayName}</div>
          <span style="cursor:pointer;color:var(--muted);font-size:0.8125rem" onclick={() => startEditDay(day)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditDay(day); } }}>✎</span>
        </div>
      </div>
      {#if editingDow === day.day_of_week}
        <div class="day-edit">
          <label class="flbl" for="edit-label-{day.day_of_week}">Label</label>
          <input id="edit-label-{day.day_of_week}" bind:value={editLabel} placeholder="e.g. Heavy Lower Body">
          <label class="flbl" for="edit-note-{day.day_of_week}">Note</label>
          <input id="edit-note-{day.day_of_week}" bind:value={editNote} placeholder="e.g. 5-a-side, 7–9pm">
          <label class="flbl" for="edit-sess-{day.day_of_week}">Session</label>
          <select id="edit-sess-{day.day_of_week}" bind:value={editSessionKey}>
            <option value="">— None (rest/cardio day) —</option>
            {#each [...sessions.entries()] as [k, s]}
              <option value={k}>{s.name}</option>
            {/each}
          </select>
          <div class="flex gap2" style="margin-top:6px">
            <button class="btn bp bsm" onclick={saveEditDay}>Save</button>
            <button class="btn bg_ bsm" onclick={() => editingDow = null}>Cancel</button>
          </div>
        </div>
      {:else if day.session_key && sessions.get(day.session_key)}
        <div class="flex jb ac gap2" style="cursor:pointer" role="button" tabindex="0"
          onclick={() => sessionKey = day.session_key}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sessionKey = day.session_key; } }}>
          <div class="f1">
            <div style="font-size:0.8125rem;font-weight:600;color:var(--amber);margin-bottom:2px">{dayLabel(day)}</div>
            <div style="font-size:0.6875rem;color:var(--muted)">{sessions.get(day.session_key)?.duration} &middot; {sessions.get(day.session_key)?.focus}</div>
            {#if day.note}<div style="font-size:0.6875rem;color:var(--muted);margin-top:2px">{day.note}</div>{/if}
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" stroke="var(--muted)" fill="none" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      {:else}
        <div style="font-size:0.8125rem;font-weight:600">{day.label}</div>
        <div style="font-size:0.75rem;color:var(--muted)">{day.note}</div>
      {/if}
    </div>
  {/snippet}

  <!-- Just today up front; the rest of the fortnight lives behind a fold — you
       don't plan around a workout 10 days out. -->
  {#if weekDays.length}{@render dayCard(weekDays[0], true)}{/if}
  {#if weekDays.length > 1}
    <button class="btn bg_ bfl look-ahead" style="margin:4px 0 10px" onclick={() => showAhead = !showAhead}>
      {showAhead ? 'Hide look-ahead ▲' : `🔭 Look ahead · next ${weekDays.length - 1} days ▼`}
    </button>
    {#if showAhead}
      {#each weekDays.slice(1) as day}
        {@render dayCard(day, false)}
      {/each}
    {/if}
  {/if}

  <h3>Quick Builder</h3>
  <button class="btn bg_ bfl" onclick={() => builderMode = !builderMode}>
    {builderMode ? 'Close Builder' : 'Build Custom Session'}
  </button>

  {#if builderMode}
    <div id="builder-muscles">
      {#each Object.entries(buildGroups) as [key, g]}
        <div class="muscle-btn" class:on={selectedGroup === key} onclick={() => selectedGroup = selectedGroup === key ? null : key} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedGroup = selectedGroup === key ? null : key; } }}>
          <div class="muscle-icon">{g.icon}</div>
          <div class="muscle-name">{g.name}</div>
          <div class="muscle-count">{g.exercises.length} exercises</div>
        </div>
      {/each}
    </div>
    {#if selectedGroup && buildGroups[selectedGroup]}
      {#each buildGroups[selectedGroup].exercises as ex}
        <div class="ex-card">
          <div class="flex gap3">
            <ExerciseMedia name={ex.name} />
            <div class="f1">
              <div class="ex-name">{ex.name}</div>
              <div class="ex-muscle">{ex.muscle}</div>
              <div class="ex-sets-row">
                <div class="ex-set-box"><div class="label">Sets</div><div class="value">{ex.sets}</div></div>
                <div class="ex-set-box w2"><div class="label">Rest</div><div class="value">{ex.rest}</div></div>
              </div>
            </div>
          </div>
          {#if ex.tip}
            <div class="ex-tip">{ex.tip}</div>
          {/if}
          <VideoEmbed vid={ex.vid} />
          {@render exerciseLog(asPlan(ex), 'custom')}
        </div>
      {/each}
    {/if}
  {/if}

  <!-- Programs, at the bottom: offered, and put away with "Not now". -->
  <ProgramOffer />

{:else}
  <!-- What actually happened, day by day. Hand-logged sets and watch sessions
       merged, because a day with only a watch session is still a training day. -->
  {#if historyDays.length > 0}
    <h3>What you actually did</h3>
    {#each historyDays as d (d.date)}
      <div class="card hist-day">
        <div class="flex jb ac" style="margin-bottom:6px">
          <div class="hist-date">{historyDayLabel(d.date)}</div>
          {#if d.tonnage > 0}
            <div class="hist-ton">{Math.round(d.tonnage).toLocaleString()} kg &middot; {d.sets} sets</div>
          {/if}
        </div>
        {#each d.sessions as a (a.id)}
          <div class="hist-row">
            <span class="hist-emoji">{a.emoji}</span>
            <span class="f1">{a.label}</span>
            <span class="hist-meta">
              {a.duration_min} min{#if a.distance_m && a.distance_m >= 300}{' · '}{(a.distance_m / 1000).toFixed(1)} km{/if}{#if a.avg_hr}{' · '}HR {a.avg_hr}{/if}{#if a.active_kcal}{' · '}~{a.active_kcal} kcal{/if}
            </span>
          </div>
        {/each}
        {#each d.lifts as l (l.exercise_name)}
          <div class="hist-row">
            <span class="f1">{l.exercise_name}</span>
            <span class="hist-meta">{fmtSets(l.sets)}</span>
          </div>
        {/each}
      </div>
    {/each}
  {:else}
    <div class="card" style="text-align:center;padding:22px 16px">
      <div style="font-size:1.625rem;margin-bottom:6px">&#128214;</div>
      <div style="font-weight:700;color:var(--text);font-size:0.875rem">Nothing logged yet</div>
      <div style="font-size:0.75rem;color:var(--muted);margin-top:5px">
        Log from <b>Upcoming</b> or wear your watch.
      </div>
    </div>
  {/if}

  {#if analytics && trainingLoad.zone !== 'no-data'}
    <div class="card">
      <div class="flex jb ac">
        <div class="card-lbl" style="margin-bottom:0">Training Load Balance</div>
        <button class="flip-btn" onclick={() => showLoadHelp = !showLoadHelp}>{showLoadHelp ? 'Hide ▲' : 'What is this? ▾'}</button>
      </div>
      <div class="load-gauge" style="margin-top:10px">
        <div class="load-track">
          <!-- Sweet-spot band (ratio 0.8–1.3) shaded on the 0–2.0 scale. -->
          <div class="load-sweet-band"></div>
          <div class="load-fill" class:undertrained={trainingLoad.zone === 'undertrained'} class:sweet={trainingLoad.zone === 'sweet-spot'} class:caution={trainingLoad.zone === 'caution'} class:risk={trainingLoad.zone === 'high-risk'}
            style="width:{Math.min(100, ((trainingLoad.ratio ?? 0) / 2) * 100)}%"></div>
        </div>
        <div class="load-ratio">{trainingLoad.ratio?.toFixed(2) ?? '--'}</div>
      </div>
      <div class="load-scale"><span>0</span><span>0.8</span><span>1.3</span><span>1.5</span><span>2.0+</span></div>
      <div class="load-label">
        {#if trainingLoad.zone === 'undertrained'}<b>Undertrained (&lt;0.8).</b> Room to push harder — add a little volume this week.
        {:else if trainingLoad.zone === 'sweet-spot'}<b>Sweet spot (0.8–1.3).</b> Well-balanced — this is exactly where you want to be.
        {:else if trainingLoad.zone === 'caution'}<b>Caution (1.3–1.5).</b> Ramping up fast — hold volume steady and prioritise recovery.
        {:else}<b>High risk (&gt;1.5).</b> Load is spiking vs your norm — ease off a session to avoid injury.{/if}
      </div>
      <div class="load-reason">Last 7 days: <b>{Math.round(trainingLoad.acuteAvg)}</b> AU/day · 28-day norm: <b>{Math.round(trainingLoad.chronicAvg)}</b> AU/day</div>
      {#if showLoadHelp}
        <div class="load-help">
          <p><b>What it is:</b> the <b>acute:chronic workload ratio</b> — this week's average training load ÷ your last-4-weeks average. It's a validated injury-risk signal from sports science (WHOOP uses the same idea).</p>
          <p><b>How load is estimated:</b> sets logged × ~3 min/set × effort (session-RPE method, Foster 2001). More sets / heavier weeks push the number up.</p>
          <p><b>What it should look like:</b> hover around <b>1.0</b> and stay inside <b>0.8–1.3</b>. That means you're progressing steadily without sudden spikes. Sitting below 0.8 for weeks means you're detraining; repeatedly above 1.5 is where injury risk climbs. The goal is a slow, steady climb — not big jumps.</p>
        </div>
      {/if}
    </div>
  {/if}

  {#if analytics && historyInsights}
    <div class="card">
      <div class="flex jb ac">
        <div class="card-lbl" style="margin-bottom:0">Insights from your history</div>
        <button class="flip-btn" onclick={() => showInsights = !showInsights}>{showInsights ? 'Less ▲' : 'More ▾'}</button>
      </div>

      <div class="ins-stats">
        <div class="ins-stat"><span class="ins-val">{historyInsights.totalSessions}</span><span class="ins-lbl">sessions</span></div>
        <div class="ins-stat"><span class="ins-val">{Math.round(historyInsights.totalTonnage).toLocaleString()}</span><span class="ins-lbl">kg lifted</span></div>
        <div class="ins-stat"><span class="ins-val">{historyInsights.perWeek}</span><span class="ins-lbl">sessions/wk</span></div>
      </div>

      <div class="ins-list">
        {#if historyInsights.volDeltaPct !== null}
          <div class="ins-item" class:good={historyInsights.volDeltaPct >= 0} class:warn={historyInsights.volDeltaPct < 0}>
            {historyInsights.volDeltaPct >= 0 ? '📈' : '📉'}
            Weekly volume {historyInsights.volDeltaPct >= 0 ? 'up' : 'down'} <b>{Math.abs(historyInsights.volDeltaPct)}%</b> vs the week before
            ({Math.round(historyInsights.vol7).toLocaleString()} vs {Math.round(historyInsights.volPrev7).toLocaleString()} kg).
            {historyInsights.volDeltaPct >= 0 ? 'Progressive overload is working — this is what protects lean mass in a deficit.' : 'Dips are fine near a deep-diet week; just avoid a long slide.'}
          </div>
        {/if}
        {#if historyInsights.recentPRs.length > 0}
          <div class="ins-item good">🏆 Recent PR: <b>{historyInsights.recentPRs[0].name}</b> — {historyInsights.recentPRs[0].weight_kg}kg × {historyInsights.recentPRs[0].reps} (est. 1RM {Math.round(historyInsights.recentPRs[0].oneRM)}kg). Getting stronger while dieting = you're recomping, not just losing.</div>
        {/if}
        {#if historyInsights.neglected.length > 0}
          <div class="ins-item warn">🎯 Neglected: <b>{historyInsights.neglected.slice(0, 2).map((m) => m.group).join(' & ')}</b>{historyInsights.neglected[0].status === 'none' ? ' (never logged)' : ` (last ${hoursAgoPhrase(historyInsights.neglected[0].hoursAgo)})`}. Balanced training keeps physique proportional — slot {historyInsights.neglected.length > 1 ? 'them' : 'it'} in next.</div>
        {/if}
        {#if historyInsights.topMuscle}
          <div class="ins-item">💪 Most-trained lately: <b>{historyInsights.topMuscle}</b> ({historyInsights.topSets} sets / 14d).</div>
        {/if}

        {#if showInsights}
          <div class="ins-item">🗓️ <b>{historyInsights.sessions14}</b> sessions in the last 14 days. {historyInsights.perWeek >= 3 ? 'Great consistency — 3+/wk is the sweet spot for recomposition.' : 'Aim for 3+/week to maximise lean-mass retention while cutting.'}</div>
          {#if historyInsights.recentPRs.length > 1}
            <div class="ins-item good">🥈 Also PR'd: {historyInsights.recentPRs.slice(1, 4).map((p) => p.name).join(', ')}.</div>
          {/if}
          {#if $_goalReason}
            <div class="ins-item">🔗 Tied to your goal — {$_goalReason} Strength trend + volume above are the evidence your training is defending muscle as the scale drops.</div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}


  {#if completions.length > 0}
    <h3>Recent Completions</h3>
    <div class="card">
      {#each [...completions].sort((a, b) => (b.date + (b.created_at ?? '')).localeCompare(a.date + (a.created_at ?? ''))) as c}
        <div class="flex jb ac" style="padding:6px 0;border-bottom:1px solid var(--border)">
          <div>
            <div class="gn">{sessions.get(c.type)?.name ?? c.type}</div>
            <div style="color:var(--muted);font-size:0.75rem">{c.date}</div>
          </div>
          <button class="btn bd bsm" onclick={() => deleteCompletion(c)} aria-label="Delete this completion" title="Delete">✕</button>
        </div>
      {/each}
    </div>
  {/if}
{/if}

{#if sessionKey && sessions.get(sessionKey)}
  {@const sess = sessions.get(sessionKey)}
  <Modal open={modalOpen} onclose={() => { sessionKey = null; editingSession = false; }}>
    {#if sess}
      <div class="flex jb ac" style="margin-bottom:4px">
        {#if editingSession}
          <input value={sess.name} onchange={(e) => saveSessionField(sessionKey, 'name', (e.target as HTMLInputElement).value)}
            style="font-size:1rem;font-weight:700;background:transparent;border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:4px 6px;flex:1">
        {:else}
          <div style="font-size:1.125rem;font-weight:700;color:var(--text)">{sess.name}</div>
        {/if}
        {#if sess.program}
          <span class="prog-tag">{sess.program.name} · wk {sess.program.week}</span>
        {:else}
          <span style="cursor:pointer;color:var(--amber);font-size:0.8125rem;margin-left:8px" onclick={() => editingSession = !editingSession} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editingSession = !editingSession; } }}>
            {editingSession ? 'Done ✓' : 'Edit ✎'}
          </span>
        {/if}
      </div>
      <div style="font-size:0.75rem;color:var(--muted);margin-bottom:12px">{sess.duration}</div>
      {#if todayVolume > 0}
        <div class="vol-badge">Today's volume: <b>{todayVolume.toLocaleString()} kg</b> lifted</div>
      {/if}
      <button class="btn bp bfl" style="margin-bottom:12px" onclick={() => sessionKey && markComplete(sessionKey)} disabled={markingComplete}>Mark Complete ✓</button>

      {#each sess.exercises as ex, i}
        {#if i === 0 || sess.exercises[i-1].phase !== ex.phase}
          <div class="phase-hd">{ex.phase}</div>
        {/if}
        <div class="ex-card" style="margin-bottom:10px;padding:12px">
          <div class="flex gap3">
            <ExerciseMedia name={ex.name} />
            <div class="f1">
              {#if editingSession}
                <input value={ex.name} onchange={(e) => saveExerciseField(sessionKey, i, 'name', (e.target as HTMLInputElement).value)}
                  style="font-size:0.875rem;font-weight:700;background:transparent;border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:3px 5px;width:100%;margin-bottom:3px">
                <input value={ex.muscle} onchange={(e) => saveExerciseField(sessionKey, i, 'muscle', (e.target as HTMLInputElement).value)}
                  style="font-size:0.6875rem;background:transparent;border:1px solid var(--border2);border-radius:6px;color:var(--muted);padding:3px 5px;width:100%;margin-bottom:6px">
              {:else}
                <div style="font-size:0.875rem;font-weight:700;color:var(--text);margin-bottom:2px">{ex.name}</div>
                <div style="font-size:0.6875rem;color:var(--muted);margin-bottom:6px">{ex.muscle}</div>
              {/if}
              <div class="ex-sets-row">
                <div class="ex-set-box" class:now={sess.program?.weekInPhase === 1}>
                  <div class="label">{sess.program ? `Wk ${sess.program.week - sess.program.weekInPhase + 1}` : 'W1'}</div>
                  {#if editingSession}
                    <input value={ex.w1} onchange={(e) => saveExerciseField(sessionKey, i, 'w1', (e.target as HTMLInputElement).value)} class="value-input">
                  {:else}<div class="value">{ex.w1}</div>{/if}
                </div>
                <div class="ex-set-box" class:now={sess.program?.weekInPhase === 2}>
                  <div class="label">{sess.program ? `Wk ${sess.program.week - sess.program.weekInPhase + 2}` : 'W2'}</div>
                  {#if editingSession}
                    <input value={ex.w2} onchange={(e) => saveExerciseField(sessionKey, i, 'w2', (e.target as HTMLInputElement).value)} class="value-input">
                  {:else}<div class="value">{ex.w2}</div>{/if}
                </div>
                <div class="ex-set-box">
                  <div class="label">Rest</div>
                  {#if editingSession}
                    <input value={ex.rest} onchange={(e) => saveExerciseField(sessionKey, i, 'rest', (e.target as HTMLInputElement).value)} class="value-input">
                  {:else}<div class="value">{ex.rest}</div>{/if}
                </div>
              </div>
            </div>
          </div>
          {#if editingSession}
            <textarea value={ex.tip} onchange={(e) => saveExerciseField(sessionKey, i, 'tip', (e.target as HTMLTextAreaElement).value)}
              class="tip-input" rows="2"></textarea>
            <button class="btn bd bsm" style="margin-top:6px" onclick={() => removeExercise(sessionKey, i)}>Remove exercise</button>
          {:else}
            <div class="ex-tip">{ex.tip}</div>
          {/if}
          <VideoEmbed vid={ex.vid} />

          {#if !editingSession}
            {@render exerciseLog(ex, sessionKey)}
          {/if}
        </div>
      {/each}
      {#if editingSession}
        <button class="btn bg_ bfl" onclick={() => addExercise(sessionKey)}>+ Add exercise</button>
      {/if}
    {/if}
  </Modal>
{/if}

{#if restTimer}
  <div class="rest-widget">
    <div class="rest-name">Resting: {restTimer.name}</div>
    <div class="rest-count">{restTimer.remaining}s</div>
    <div class="rest-bar-track"><div class="rest-bar-fill" style="width:{(1 - restTimer.remaining / restTimer.total) * 100}%"></div></div>
    <button class="btn bg_ bsm" onclick={cancelRestTimer}>Cancel</button>
  </div>
{/if}


<!-- Context + analysis, below the action so today's workout leads -->
<div class="card">
  <div class="flex jb ac">
    <div style="min-width:0">
      <div style="font-size:0.8125rem;font-weight:700;color:var(--text)">Played something?</div>
      <div style="font-size:0.6875rem;color:var(--muted);margin-top:2px">
        {#if logActMsg}{logActMsg}{:else}Watch missed one? Add it here.{/if}
      </div>
    </div>
    <button class="btn bg_ bsm" onclick={() => logActOpen = !logActOpen} style="flex-shrink:0">
      {logActOpen ? 'Close' : '+ Log'}
    </button>
  </div>

  {#if logActOpen}
    <div class="mlog">
      <div class="mlog-grid">
        {#each QUICK_ACTIVITIES as t}
          <button class="mlog-act" class:on={logActType === t} onclick={() => logActType = t}>
            <span class="mlog-e">{EXERCISE_TYPES[t]?.emoji ?? '🏋️'}</span>
            <span class="mlog-n">{EXERCISE_TYPES[t]?.label ?? 'Workout'}</span>
          </button>
        {/each}
      </div>

      <div class="mlog-row">
        <label class="mlog-f">
          <span class="mlog-l">Minutes</span>
          <input type="number" inputmode="numeric" min="1" max="600" bind:value={logActMins}>
        </label>
        <label class="mlog-f">
          <span class="mlog-l">Day</span>
          <input type="date" bind:value={logActDate} max={todayYmd()}>
        </label>
      </div>

      <button class="btn bp bfl" disabled={logActBusy || !(logActMins > 0)} onclick={saveManualActivity}>
        {logActBusy ? 'Saving…' : `Log ${EXERCISE_TYPES[logActType]?.label ?? 'session'}`}
      </button>
    </div>
  {/if}
</div>

{#if $_goalReason}
  <div class="note-box">🏋️ Training keeps muscle while the scale drops.</div>
{:else}
  <div class="note-box warn">🏋️ Set a goal in <strong>Progress → Body &amp; Goals</strong>.</div>
{/if}

{#if analytics}
<div class="flip-viewport" style="height:{recoveryFlipped ? recBackH : recFrontH}px">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="flip-inner" class:flipped={recoveryFlipped}>
    <div class="flip-face flip-front card" bind:clientHeight={recFrontH}>
      <div class="flex jb ac">
        <div class="card-lbl" style="margin-bottom:0">Muscle Recovery</div>
        <button class="flip-btn" onclick={() => recoveryFlipped = true}>Details ↻</button>
      </div>
      <div class="muscle-grid" style="margin-top:10px">
        {#each muscleRecovery as m}
          <div class="muscle-cell" class:ready={m.status === 'ready'} class:recovering={m.status === 'recovering'} class:fatigued={m.status === 'fatigued'} class:none={m.status === 'none'}>
            <div class="mc-name">{m.group}</div>
            <div class="mc-status">{recoveryPhrase(m)}</div>
            {#if m.status !== 'none'}
              <div class="mc-bar"><div class="mc-bar-fill" style="width:{m.pct}%"></div></div>
            {/if}
          </div>
        {/each}
      </div>
      <div class="mc-legend">🔴 Fatigued · 🟡 Recovering · 🟢 Ready — window scales with the exercise: a machine/isolation move recovers faster than a heavy compound.</div>
    </div>

    <div class="flip-face flip-back card" bind:clientHeight={recBackH}>
      <div class="flex jb ac">
        <div class="card-lbl" style="margin-bottom:0">What hit each muscle</div>
        <button class="flip-btn" onclick={() => recoveryFlipped = false}>Back ↩</button>
      </div>
      <div style="font-size:0.6875rem;color:var(--muted);margin-top:6px;line-height:1.5">
        Recovery time isn't flat. Trained muscles doing habitual work rebuild in
        ~36–60h, not a blanket 72h. We scale each muscle's window by the most
        damaging move that hit it: heavy-eccentric compounds (RDL, deadlift,
        squat) take ~25% longer, while machine/isolation moves (leg extension,
        curls, pushdowns) take ~25% less. So an RDL genuinely needs ~72h for
        hamstrings, but a leg extension only ~45h for quads — same muscle,
        different damage.
      </div>
      <div style="margin-top:8px">
        {#each muscleRecovery.filter((m) => m.status !== 'none') as m}
          <div class="mrd-group">
            <div class="mrd-head">
              <span class="mrd-name">{m.group} <span class="mrd-ex-meta">· {m.windowH}h window</span></span>
              <span class="mrd-status" class:ready={m.status === 'ready'} class:recovering={m.status === 'recovering'} class:fatigued={m.status === 'fatigued'}>
                {recoveryPhrase(m)} · last {hoursAgoPhrase(m.hoursAgo)}
              </span>
            </div>
            <div class="mrd-exs">
              {#each Array.from(new Map(m.exercises.map((e) => [e.name, e])).values()) as ex}
                <span class="mrd-ex">{ex.name} <span class="mrd-ex-meta">· {ex.sets} set{ex.sets === 1 ? '' : 's'} · {hoursAgoPhrase(ex.hoursAgo)}</span></span>
              {:else}
                <span class="mrd-ex-meta">Trained, but no set detail logged</span>
              {/each}
            </div>
          </div>
        {:else}
          <div style="font-size:0.75rem;color:var(--muted)">Log a workout to see which exercises drove each muscle's recovery.</div>
        {/each}
      </div>
    </div>
  </div>
</div>

{/if}

{#if analytics}
  <WorkoutInsights />
{:else}
  <button type="button" class="card parked" onclick={() => (showParked = true)}>
    <span class="card-lbl">Analytics are parked</span>
    <span class="parked-msg">
      Volume, load balance and muscle recovery measure you against your old heavy training. In Back Rebuild light
      loads are the plan, so they wait until it ends{gymProgram ? ` on ${new Date(programEnd(gymProgram) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}.
    </span>
    <span class="parked-go">Show them anyway</span>
  </button>
{/if}
{/if}

<style>
  .parked{display:block;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer}
  .parked .card-lbl{display:block}
  .parked-msg{display:block;font-size:0.8125rem;line-height:1.5;color:var(--muted)}
  .parked-go{display:block;margin-top:8px;font-size:0.8125rem;font-weight:700;color:var(--text);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2)}
  .mlog{margin-top:12px}
  .mlog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:6px;margin-bottom:12px}
  .mlog-act{display:flex;flex-direction:column;align-items:center;gap:3px;background:var(--bg3);border:1px solid var(--border);border-radius:11px;padding:9px 4px;cursor:pointer;font-family:inherit;transition:border-color .15s var(--ease)}
  .mlog-act.on{border-color:var(--amber);background:var(--ab)}
  .mlog-e{font-size:1.1875rem;line-height:1}
  .mlog-n{font-size:0.6875rem;font-weight:700;color:var(--muted);text-align:center;line-height:1.2}
  .mlog-act.on .mlog-n{color:var(--text)}
  .mlog-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
  .mlog-f{display:flex;flex-direction:column;gap:4px}
  .mlog-l{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted)}

  .hist-day{padding:11px 13px}
  .hist-date{font-size:0.7812rem;font-weight:800;color:var(--text)}
  .hist-ton{font-size:0.6875rem;font-weight:700;color:var(--amber)}
  .hist-row{display:flex;align-items:baseline;gap:8px;font-size:0.7812rem;padding:3px 0;color:var(--text)}
  .hist-row + .hist-row{border-top:1px solid color-mix(in srgb,var(--border) 55%,transparent)}
  .hist-emoji{font-size:0.875rem;line-height:1}
  .hist-meta{font-size:0.6875rem;color:var(--muted);text-align:right;flex-shrink:0}

  #builder-muscles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
  .muscle-btn{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;padding:18px 12px;border:1px solid var(--border);background:var(--bg2);border-radius:12px;cursor:pointer;transition:all .15s}
  .muscle-btn:active{border-color:var(--amber)}
  .muscle-btn.on{border-color:var(--green);background:var(--gb)}
  .muscle-icon{font-size:2rem}
  .muscle-name{font-size:0.875rem;font-weight:700;color:var(--text)}
  .muscle-count{font-size:0.6875rem;color:var(--muted)}

  .day-edit{display:flex;flex-direction:column;gap:2px;margin-top:4px}
  .day-edit input,.day-edit select{background:var(--bg3);border:1px solid var(--border2);border-radius:8px;color:var(--text);padding:6px 8px;font-size:1rem;margin-bottom:6px}

  .phase-hd{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--amber);margin:14px 0 6px 2px}

  .value-input{width:100%;text-align:center;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:1rem;font-weight:700;padding:3px}
  .tip-input{width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;color:var(--text);font-size:1rem;padding:6px 8px;margin-top:8px;resize:vertical}

  .vol-badge{font-size:0.75rem;color:var(--green,#2ecc71);background:var(--gb,rgba(46,204,113,.1));border-radius:8px;padding:6px 10px;margin-bottom:10px}
  .log-row{display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px}
  .log-row-tap,.pr-row-tap{cursor:pointer;border:1px solid var(--border);border-radius:10px;padding:9px 11px;-webkit-tap-highlight-color:transparent;transition:border-color .15s,background .15s}
  .log-row-tap:hover,.pr-row-tap:hover{border-color:var(--border2)}
  .log-row-tap:active,.pr-row-tap:active{border-color:var(--amber);background:rgba(255,176,32,.06)}
  .log-row-tap:focus-visible,.pr-row-tap:focus-visible{outline:none;border-color:var(--amber)}
  .last-perf{font-size:0.6875rem;color:var(--muted);flex:1}
  .log-toggle{font-size:0.6875rem;font-weight:700;color:var(--amber);cursor:pointer;white-space:nowrap}
  .log-form{margin-top:8px;padding:8px;background:var(--bg3);border-radius:8px}
  .log-set-row{display:flex;align-items:center;gap:6px;margin-bottom:6px}
  .log-set-row .set-idx{font-size:0.6875rem;color:var(--muted);width:44px;flex-shrink:0}
  .log-set-row input{width:100%;background:var(--bg2);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:1rem;padding:4px 6px;text-align:center}
  .log-set-row .x{color:var(--muted);font-size:0.6875rem}
  .log-set-row .rm-set{color:var(--muted);cursor:pointer;font-size:0.75rem;padding:0 2px}
  .log-msg{font-size:0.6875rem;color:var(--green,#2ecc71);margin-top:6px}
  .log-msg.err{color:#ff6b6b}

  .pr-row{display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:8px}
  .pr-badge{font-size:0.6875rem;font-weight:700;color:#ffd166;background:rgba(255,209,102,.1);border-radius:8px;padding:4px 8px}
  .suggestion-badge{font-size:0.75rem;font-weight:600;color:var(--blue);background:rgba(96,165,250,.1);border-radius:8px;padding:6px 9px;margin-top:6px;line-height:1.4}
  .suggestion-badge.up{color:var(--green,#2ecc71);background:rgba(46,204,113,.1)}
  .suggestion-badge.deload{color:#ff6b6b;background:rgba(255,107,107,.1)}
  .pr-date{font-weight:400;color:var(--muted)}
  .history-chart{margin-top:8px;padding:8px;background:var(--bg3);border-radius:8px}
  .hc-label{font-size:0.6875rem;color:var(--muted);text-align:center;margin-top:2px}

  .rest-widget{position:fixed;left:16px;right:16px;bottom:calc(70px + var(--sb));background:var(--bg2);border:1px solid var(--amber);border-radius:14px;padding:12px 14px;box-shadow:var(--shadow-md);z-index:260;display:flex;align-items:center;gap:10px}
  .rest-name{font-size:0.75rem;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rest-count{font-size:1.25rem;font-weight:800;color:var(--amber);min-width:44px;text-align:center}
  .rest-bar-track{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--border2);border-radius:0 0 14px 14px;overflow:hidden}
  .rest-bar-fill{height:100%;background:var(--amber);transition:width 1s linear}

  .muscle-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
  .muscle-cell{border-radius:10px;padding:8px 10px;background:var(--bg3);border:1px solid var(--border)}
  .muscle-cell.ready{background:rgba(46,204,113,.12);border-color:rgba(46,204,113,.3)}
  .muscle-cell.recovering{background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.3)}
  .muscle-cell.fatigued{background:rgba(255,107,107,.12);border-color:rgba(255,107,107,.3)}
  .muscle-cell.none{opacity:.5}
  .mc-name{font-size:0.75rem;font-weight:700;color:var(--text)}
  .mc-status{font-size:0.6875rem;color:var(--muted);margin-top:2px}
  .muscle-cell.ready .mc-status{color:var(--green,#2ecc71)}
  .muscle-cell.recovering .mc-status{color:#ffd166}
  .muscle-cell.fatigued .mc-status{color:#ff6b6b}
  .mc-bar{height:3px;border-radius:2px;background:var(--border2);margin-top:5px;overflow:hidden}
  .mc-bar-fill{height:100%;background:currentColor;opacity:.55}
  .muscle-cell.ready .mc-bar-fill{background:var(--green,#2ecc71);opacity:1}
  .muscle-cell.recovering .mc-bar-fill{background:#ffd166}
  .muscle-cell.fatigued .mc-bar-fill{background:#ff6b6b}
  .mc-legend{font-size:0.6875rem;color:var(--muted);margin-top:10px;line-height:1.4}

  /* Flip card (Muscle Recovery) — measured-height 3D flip so both faces
     size correctly on mobile. */
  .flip-viewport{position:relative;perspective:1200px;margin-bottom:12px;transition:height .45s var(--ease)}
  .flip-inner{position:relative;width:100%;transform-style:preserve-3d;transition:transform .5s var(--ease)}
  .flip-inner.flipped{transform:rotateY(180deg)}
  .flip-face{position:absolute;top:0;left:0;width:100%;backface-visibility:hidden;-webkit-backface-visibility:hidden;margin:0}
  .flip-back{transform:rotateY(180deg)}
  .flip-btn{font-size:0.6875rem;font-weight:700;color:var(--amber);background:none;border:none;cursor:pointer;padding:2px 4px}
  .mrd-group{padding:8px 0;border-bottom:1px solid var(--border)}
  .mrd-group:last-child{border-bottom:none}
  .mrd-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .mrd-name{font-size:0.8125rem;font-weight:700;color:var(--text)}
  .mrd-status{font-size:0.6875rem;color:var(--muted);text-align:right}
  .mrd-status.ready{color:var(--green,#2ecc71)}
  .mrd-status.recovering{color:#ffd166}
  .mrd-status.fatigued{color:#ff6b6b}
  .mrd-exs{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
  .mrd-ex{font-size:0.6875rem;color:var(--text);background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:3px 7px}
  .mrd-ex-meta{color:var(--muted);font-size:0.6875rem}

  .load-gauge{display:flex;align-items:center;gap:10px}
  .load-track{flex:1;height:10px;background:var(--bg3);border-radius:5px;overflow:hidden;position:relative}
  .load-sweet-band{position:absolute;top:0;bottom:0;left:40%;width:25%;background:rgba(46,204,113,.18);border-left:1px dashed rgba(46,204,113,.5);border-right:1px dashed rgba(46,204,113,.5)}
  .load-fill{height:100%;transition:width .3s var(--ease);position:relative}
  .load-fill.undertrained{background:#60a5fa}
  .load-fill.sweet{background:var(--green,#2ecc71)}
  .load-fill.caution{background:#ffd166}
  .load-fill.risk{background:#ff6b6b}
  .load-ratio{font-size:1rem;font-weight:800;color:var(--text);min-width:40px;text-align:right}
  .load-scale{display:flex;justify-content:space-between;font-size:0.6875rem;color:var(--muted);margin-top:3px;padding-right:50px}
  .load-label{font-size:0.6875rem;color:var(--muted);margin-top:8px;line-height:1.45}
  .load-reason{font-size:0.6875rem;color:var(--muted);margin-top:6px}
  .load-help{margin-top:10px;padding:10px;background:var(--bg3);border-radius:10px;font-size:0.7188rem;color:var(--text);line-height:1.5}
  .load-help p{margin:0 0 8px}
  .load-help p:last-child{margin-bottom:0}

  .ins-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}
  .ins-stat{background:var(--bg3);border-radius:10px;padding:8px;text-align:center}
  .ins-val{display:block;font-size:1.0625rem;font-weight:800;color:var(--amber)}
  .ins-lbl{font-size:0.6875rem;color:var(--muted)}
  .ins-list{display:flex;flex-direction:column;gap:7px}
  .ins-item{font-size:0.7188rem;color:var(--text);line-height:1.45;background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:8px 10px}
  .ins-item.good{border-color:rgba(46,204,113,.3);background:rgba(46,204,113,.08)}
  .ins-item.warn{border-color:rgba(255,209,102,.3);background:rgba(255,209,102,.08)}
  .prog-tag{flex-shrink:0;margin-left:8px;font-size:0.6875rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border:1px solid var(--border2);border-radius:4px;padding:2px 6px}
  .ex-set-box.now{border-color:var(--text)}
  .ex-set-box.now .label{color:var(--text)}
</style>
