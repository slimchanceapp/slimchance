<script lang="ts">
  import '../app.css';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import CoinSpin from '$lib/components/CoinSpin.svelte';
  import { navigating } from '$app/state';
  import AuthGate from '$lib/components/AuthGate.svelte';
  import { syncStatus } from '$lib/stores/sync';
  import { user, authReady, initAuth, signOut, deleteAccount, isTrial } from '$lib/stores/user';
  import SaveAccount from '$lib/components/SaveAccount.svelte';
  import { saveAccountOpen, importOpen } from '$lib/stores/notices';
  import ImportWeights from '$lib/components/ImportWeights.svelte';
  import { initSync, destroySync, upsertRecord } from '$lib/stores/sync';
  import { subscribeWebPush } from '$lib/push';
  import { playAlarmMelody } from '$lib/alarmSound';
  import { initAppUpdate } from '$lib/stores/appUpdate';
  import { applySafeAreaFallback } from '$lib/safeArea';
  import { recordError } from '$lib/errorLog';
  import UpdateBadge from '$lib/components/UpdateBadge.svelte';
  import Diagnostics from '$lib/components/Diagnostics.svelte';
  import CoachToast from '$lib/components/CoachToast.svelte';
  import NativeUpdateBanner from '$lib/components/NativeUpdateBanner.svelte';
  import { resetSpoken } from '$lib/stores/toast';
  import Modal from '$lib/components/Modal.svelte';
  import { base } from '$app/paths';
  import { syncHealthConnect } from '$lib/health/healthConnect';
  import { pullToRefresh } from '$lib/actions/pullToRefresh';
  import { refreshAll, refreshing, refreshError, lastRefresh, startClock, stopClock, nowTick } from '$lib/stores/refresh';
  import { noteEvent, noteOrigin } from '$lib/events';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import { liveProfile, liveProfileLoaded, liveAlarms, liveFoodLogs, liveWeights, liveWorkoutLogs, liveGoal, liveSchedule, liveSessionCompletions, liveActivitySessions } from '$lib/stores/live';
  import { trainedDates } from '$lib/health/exercise';
  import { shiftYmd } from '$lib/date';
  import { scheduleNativeAlarms, scheduleNudges, isNativeApp, momentsSupport, armMoments, disarmMoments, type AlarmRow } from '$lib/nativeAlarms';
  import { moments, momentSetting, refreshForecast } from '$lib/stores/moments';
  import { saveMomentInputs, confirmWeight, answerWeight, nativeKg, type MomentContext } from '$lib/momentActions';
  import { onMomentsInput } from '$lib/nativeAlarms';
  import { offTrend } from '$lib/scale';
  import { badmintonRule } from '$lib/program';
  import { sportOf } from '$lib/plans';
  import { coachOn, coachNotes, brainNote, runBrainIfDue, setCoach, forgetCoach } from '$lib/stores/brain';
  import { untrack } from 'svelte';
  import { situationalNudges, minutesOfDay } from '$lib/situational';
  import { todayYmd } from '$lib/date';
  import { isComplete } from '$lib/profile';
  import { setWatchBrand } from '$lib/health/healthConnect';
  import { todayPulse } from '$lib/stores/body';
  import { body } from '$lib/stores/body';
  import { dwt, wt } from '$lib/units';
  import { initHaptics, hapticsEnabled, setHapticsEnabled, haptic } from '$lib/haptics';

  let { children }: { children: import('svelte').Snippet } = $props();
  let crashMsg = $state<string | null>(null);
  let menuOpen = $state(false);
  let deleteOpen = $state(false);
  let deleteText = $state('');
  let deleteErr = $state('');
  let deleteBusy = $state(false);
  async function confirmDelete() {
    deleteBusy = true;
    deleteErr = '';
    try {
      await deleteAccount(); // reloads the app clean on success
    } catch (e: any) {
      deleteErr = (e?.message || String(e)).slice(0, 160);
      deleteBusy = false;
    }
  }
  let syncStarted = false;

  // — Verdict light —
  // A faint green wash from the top edge while the trend is on pace, like the
  // spill from a scoreboard, read off the same tone as the Today hero
  // (stores/body todayPulse). Only green: the hero already says a flat month
  // in amber, and an amber tint on every page for weeks would say it on the
  // food log and the training screen too, where it helps nobody.
  $effect(() => {
    const aura = $todayPulse.tone === 'good' ? 'rgba(79,181,154,.10)' : 'transparent';
    document.documentElement.style.setProperty('--aura', aura);
  });

  // — Pull to refresh —
  // An installed app has no reload button, so the drag-down gesture is the
  // reload. It refreshes EVERYTHING that can be stale in one go: every synced
  // table from Supabase, the watch's steps/sleep/heart-rate/workouts from
  // Health Connect, and the clock that muscle recovery and readiness are
  // measured against.
  let pull = $state(0);
  const PULL_THRESHOLD = 72;
  const pullPct = $derived(Math.min(1, pull / PULL_THRESHOLD));
  // Fire a single confident thump the instant the drag crosses the release
  // threshold — the physical "you've armed the refresh" confirmation that a
  // pure-visual gesture was missing. Re-arms once the finger relaxes back.
  let pullArmed = false;
  function onPull(px: number) {
    pull = px;
    if (px >= PULL_THRESHOLD && !pullArmed) {
      pullArmed = true;
      haptic('impact');
    } else if (px < PULL_THRESHOLD - 8) {
      pullArmed = false;
    }
  }

  async function doRefresh() {
    await refreshAll($user?.id ?? null);
  }

  // Keep time-derived screens (muscle recovery, "3h ago", readiness) honest
  // while the app sits open for days.
  $effect(() => {
    startClock();
    return stopClock;
  });

  function refreshLabel(): string {
    if ($refreshing) return 'Refreshing everything…';
    if (pullPct >= 1) return 'Release to refresh';
    return 'Pull to refresh';
  }

  // — First-run setup —
  // Height, age and sex used to be unsaved component state, and the goal weight
  // was a constant compiled into the bundle. Without them the calorie engine
  // can't run at all, so a new user is asked once, up front. Gated on
  // profileLoaded so the form never flashes before user_settings arrives.
  const _profile = liveProfile();
  const _profileLoaded = liveProfileLoaded();
  // Every screen re-draws when the unit changes (units.ts is plain state, not
  // a store, so the pages are keyed on it instead).
  const unitsKey = $derived((($_profile as any)?.units as string | undefined) ?? 'metric');
  const UNIT_CHOICES = [{ v: 'metric', l: 'kg' }, { v: 'imperial', l: 'lb' }, { v: 'stone', l: 'st' }] as const;
  let unitsErr = $state('');
  const cycleOn = $derived(!!($_profile as any)?.cycle_aware);
  async function toggleCycle() {
    const id = $user?.id;
    if (!id) return;
    try { await upsertRecord('user_settings', { user_id: id, cycle_aware: !cycleOn, updated_at: new Date().toISOString() }); }
    catch (e: any) { unitsErr = 'Could not change it: ' + (e?.message || String(e)).slice(0, 100); }
  }
  async function toggleCoach() {
    try { await setCoach(!$coachOn); }
    catch (e: any) { unitsErr = 'Could not change it: ' + (e?.message || String(e)).slice(0, 100); }
  }
  async function forgetCoachNotes() {
    try { await forgetCoach(); }
    catch (e: any) { unitsErr = 'Could not forget: ' + (e?.message || String(e)).slice(0, 100); }
  }
  async function chooseUnits(v: string) {
    unitsErr = '';
    const id = $user?.id;
    if (!id || v === unitsKey) return;
    try { await upsertRecord('user_settings', { user_id: id, units: v, updated_at: new Date().toISOString() }); }
    catch (e: any) { unitsErr = 'Could not change units: ' + (e?.message || String(e)).slice(0, 100); }
  }
  let onboardingDone = $state(false);
  const needsOnboarding = $derived(
    $_profileLoaded && !onboardingDone && !isComplete($_profile)
  );

  // The wearable brand is stored in the profile so it follows the user across
  // devices, but the health sync reads it synchronously from localStorage —
  // mirror it whenever the profile arrives.
  $effect(() => {
    const brand = $_profile?.watch_brand;
    if (brand) setWatchBrand(brand);
  });

  $effect(() => {
    initAuth();
  });

  // An iPhone home-screen app draws under the status bar, yet WebKit sizes the
  // page as if the bar took its own room: a strip that tall stayed empty under
  // the tab bar. Measured, not assumed, so the day WebKit fixes it this adds 0.
  $effect(() => {
    if (!(navigator as any).standalone) return;
    const root = document.documentElement;
    const fit = () => {
      const app = document.getElementById('app');
      if (!app) return;
      const added = parseFloat(root.style.getPropertyValue('--ios-gap')) || 0;
      const full = innerHeight > innerWidth ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
      const gap = Math.round(full - (app.getBoundingClientRect().height - added));
      root.style.setProperty('--ios-gap', `${gap > 0 && gap < 100 ? gap : 0}px`);
    };
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  });

  // The boot screen's coin (src/app.html) spins until the app knows who's here.
  $effect(() => {
    if (!$authReady) return;
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.classList.add('out');
    setTimeout(() => boot.remove(), 300);
  });

  $effect(() => {
    const u = $user;
    if (u && !syncStarted) {
      syncStarted = true;
      initSync(u.id);
      // Only refresh a subscription the person already allowed: asking for
      // notifications the moment a stranger arrives is how browsers learn to
      // block a site. Onboarding asks, when they choose the morning reminder.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') subscribeWebPush(u.id);
      // Native Android shell only: pull OnePlus Watch data from Health Connect
      // into the app. No-ops in a browser.
      syncHealthConnect(u.id);
    } else if (!u && syncStarted) {
      syncStarted = false;
      destroySync();
      resetSpoken();
    }
  });

  // ── EXPORT ────────────────────────────────────────────────────────────────
  // Straight from the local Dexie mirror, which RLS already guarantees holds
  // only this user's rows — so the export can never contain anyone else's data
  // even if a future table forgets a filter.
  let exporting = $state('');
  let exportMsg = $state('');

  async function exportData(format: 'json' | 'csv') {
    if (exporting) return;
    const uid = $user?.id;
    if (!uid) { exportMsg = 'Sign in first.'; return; }
    exporting = format;
    exportMsg = '';
    try {
      const [{ buildBundle, toCsv, exportFilename, summariseBundle, EXPORT_TABLES }, { deliverFile, deliveryMessage }, dbMod] =
        await Promise.all([import('$lib/exportData'), import('$lib/shareFile'), import('$lib/db/dexie')]);
      const db = dbMod.default;

      const tables: Record<string, unknown[]> = {};
      for (const t of EXPORT_TABLES) {
        try { tables[t] = await db.table(t).toArray(); }
        catch { tables[t] = []; } // a table this client hasn't created yet
      }
      const bundle = buildBundle(uid, tables);

      let filename: string;
      let contents: string;
      let mime: string;
      if (format === 'json') {
        filename = exportFilename('json');
        contents = JSON.stringify(bundle, null, 2);
        mime = 'application/json';
      } else {
        // One CSV would need one shared column set across 16 unrelated tables.
        // A labelled multi-section file opens fine in Sheets/Excel and keeps
        // every column meaningful.
        filename = exportFilename('csv');
        contents = EXPORT_TABLES
          .filter((t) => (bundle.tables[t] as unknown[]).length > 0)
          .map((t) => `# ${t}\n${toCsv(bundle.tables[t] as Array<Record<string, unknown>>)}`)
          .join('\n\n');
        mime = 'text/csv';
      }

      const res = await deliverFile(filename, contents, mime);
      exportMsg = res.method === 'failed'
        ? deliveryMessage(res)
        : `${summariseBundle(bundle)} ${deliveryMessage(res)}`;
    } catch (e: any) {
      exportMsg = 'Export failed: ' + (e?.message || String(e)).slice(0, 120);
      recordError('Export failed: ' + (e?.message || String(e)), { kind: 'error' });
    } finally {
      exporting = '';
    }
  }

  // One "open" a day per person, for the Numbers page's retention, and the tag
  // of the link they came by, once (lib/events).
  $effect(() => {
    void $nowTick;
    if ($user) { noteEvent('open'); noteOrigin(); }
  });

  // Alarms have to be armed from the app SHELL, not from the Alarms page. They were
  // only ever scheduled inside that page's save/toggle/delete handlers, so an alarm
  // created on another device — or simply a phone that rebooted — was never armed
  // until you happened to open that screen and edit something. Re-arming on every
  // change to the synced alarm list covers launch, realtime push, and pull-refresh
  // in one place. Android replaces by notification id, so re-arming is idempotent.
  const _alarms = liveAlarms();
  $effect(() => {
    const rows = $_alarms as AlarmRow[];
    if (!$user || !isNativeApp() || rows.length === 0) return;
    scheduleNativeAlarms(rows);
  });

  // ── SITUATIONAL NUDGES ────────────────────────────────────────────────────
  // The alarms that know something. Re-armed on every change to today's data,
  // which is what keeps them honest: hit your protein at 18:50 and the 19:00
  // "40g to go" message is cancelled before it can fire. That works because
  // every fact these describe changes only by typing it into this app, or by
  // the watch, whose workouts sync in when the app opens.
  const _nudgeFood = liveFoodLogs();
  const _nudgeWeights = liveWeights();
  const _nudgeWorkouts = liveWorkoutLogs();
  const _nudgeCompletions = liveSessionCompletions();
  const _nudgeActivity = liveActivitySessions();
  const _nudgeGoal = liveGoal();
  const _nudgeSchedule = liveSchedule();

  // ── MORNING BRIEFING AND EVENING HOLD ──────────────────────────────────────
  // Android posts each at the first unlock inside its window; all this does is
  // keep today's and tomorrow's text current there (see stores/moments). Old
  // APKs have no plugin: then nothing here runs, and nothing asks for a
  // location that build can't grant.
  let support = $state<'all' | 'morning' | null>(null);
  $effect(() => { if ($user && isNativeApp()) momentsSupport().then((v) => (support = v)); });
  const briefingOn = $derived(!!support && !!$momentSetting?.on);
  const holdOn = $derived(support === 'all' && !!$momentSetting?.hold);
  $effect(() => {
    if (!briefingOn) return;
    void $nowTick; // the forecast is reused while under an hour old
    refreshForecast();
  });
  $effect(() => {
    if (!$user || !support || !$_profileLoaded) return;
    if (!$moments.length) { disarmMoments(); return; }
    armMoments($moments);
  });

  // What was entered on the briefing's buttons (a weight, a back rating, the
  // usual breakfast) is saved here: once after the first sync, the moment a
  // button is pressed while the app runs, and whenever the app comes back.
  const momentCtx = (): MomentContext => ({
    uid: $user?.id ?? '', weights: ($_nudgeWeights as any[]).map((w) => ({ date: w.date, weight: +w.weight })),
    goalKg: $body.goalKg, trendKg: $body.currentKg, food: $_nudgeFood as any[],
    startKg: ($_profile as any)?.start_kg != null ? +($_profile as any).start_kg : null,
  });
  let inputsChecked = false;
  $effect(() => {
    if (!$user || support !== 'all' || $syncStatus !== 'synced' || inputsChecked) return;
    inputsChecked = true;
    untrack(() => saveMomentInputs(momentCtx()));
  });
  $effect(() => {
    if (!$user || support !== 'all') return;
    let off = () => {};
    onMomentsInput(() => saveMomentInputs(untrack(momentCtx))).then((f) => (off = f));
    const back = () => { if (document.visibilityState === 'visible') saveMomentInputs(untrack(momentCtx)); };
    document.addEventListener('visibilitychange', back);
    return () => { off(); document.removeEventListener('visibilitychange', back); };
  });
  const confirmOff = $derived($confirmWeight ? offTrend(nativeKg($confirmWeight), $body.currentKg) : null);

  $effect(() => {
    if (!$user || !isNativeApp()) return;
    const now = new Date($nowTick);
    const today = todayYmd();

    const todayFood = ($_nudgeFood as any[]).filter((f) => f.date === today);
    const goalKg = ($_nudgeGoal as number | null) ?? null;
    const weightDates = ($_nudgeWeights as any[]).map((w) => w.date).sort();
    const lastWeigh = weightDates.length ? weightDates[weightDates.length - 1] : null;
    const daysSinceWeighIn = lastWeigh
      ? Math.round((Date.parse(today) - Date.parse(lastWeigh)) / 86400000)
      : null;

    const dow = now.getDay();
    const scheduledToday = ($_nudgeSchedule as any[]).find((s) => s.day_of_week === dow);

    scheduleNudges(situationalNudges({
      nowMinutes: minutesOfDay(now),
      proteinG: todayFood.reduce((s, f) => s + (f.protein_g || 0), 0),
      proteinTargetG: goalKg ? $body.proteinTargetG : null,
      kcal: todayFood.reduce((s, f) => s + (f.kcal || 0), 0),
      kcalTargetKcal: null,
      foodEntriesToday: todayFood.length,
      isTrainingDay: !!scheduledToday?.time,
      session: scheduledToday?.time
        ? { label: scheduledToday.label ?? 'Training', time: scheduledToday.time, sport: sportOf(scheduledToday), note: scheduledToday.note }
        : null,
      workoutLoggedToday: trainedDates($_nudgeCompletions as any[], ($_nudgeActivity as any[]) || [], $_nudgeWorkouts as any[]).has(today),
      watchTrains: (($_nudgeActivity as any[]) || []).some((a) => a.source === 'watch' && a.date >= shiftYmd(-28)),
      plans: ($_profile as any)?.plans ?? null,
      dow,
      sportDay: !!sportOf(scheduledToday)
        && !(sportOf(scheduledToday) === 'Badminton' && badmintonRule(($_profile as any)?.program, today)?.play === false),
      daysSinceWeighIn,
      briefing: briefingOn,
      hold: holdOn,
    }), now);
  });

  // ── THE COACH BRAIN ──────────────────────────────────────────────────────
  // Asked again as the clock and the day move; stores/brain decides whether
  // it's due (on, after 15:00, the day changed) and does nothing otherwise.
  $effect(() => {
    void $nowTick; void $body;
    if (!$user || $syncStatus !== 'synced') return;
    untrack(() => runBrainIfDue());
  });

  // Global safety net: catch any error that escapes normal event handlers or
  // async code (these never trigger <svelte:boundary>, which only catches
  // errors thrown *during rendering*). Without this, an uncaught error here
  // just silently swallows a button tap with no feedback — which reads to a
  // user as "the app crashed/froze". Surface it instead of hiding it.
  $effect(() => {
    function onError(e: ErrorEvent) {
      console.error('Uncaught error:', e.error || e.message);
      crashMsg = (e.error?.message || e.message || 'Unknown error').slice(0, 200);
      // Persist it. Until this existed, every error the user hit vanished on
      // reload and the only debugging protocol was "screenshot it next time".
      recordError(e.error?.message || e.message, { stack: e.error?.stack, kind: 'error' });
    }
    function onRejection(e: PromiseRejectionEvent) {
      console.error('Unhandled rejection:', e.reason);
      crashMsg = (e.reason?.message || String(e.reason) || 'Unknown error').slice(0, 200);
      recordError(e.reason?.message || String(e.reason), {
        stack: e.reason?.stack, kind: 'unhandledrejection',
      });
    }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  });

  // Register the service worker for real (it previously existed on disk but
  // was never registered anywhere, so offline caching + push never actually
  // worked). The SW activates aggressively (skipWaiting + claim, see
  // service-worker.ts) specifically so that closing and reopening the app
  // always picks up whatever is currently deployed -- a fresh app open
  // always fetches fresh HTML referencing the current build, so there's no
  // stale-chunk risk on a normal close/reopen.
  //
  // IMPORTANT: do NOT react to 'controllerchange' here by reloading the
  // page. skipWaiting()+clients.claim() fire routinely (essentially on
  // every registration/activation cycle, not only on genuine version
  // bumps), so listening for that event and calling location.reload()
  // causes a real, observed infinite reload loop: reload -> fresh
  // registration -> claim fires again -> controllerchange -> reload ->
  // forever. This was tried and reverted after being caught by a
  // Playwright test. If a "force refresh on update" feature is wanted
  // again later, it must be built around a genuinely new *waiting*
  // worker (reg.waiting after an update() call) with a manual,
  // user-triggered "Update available" tap -- never an automatic reload
  // driven by the ambient controllerchange event.
  $effect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/service-worker.js', { type: 'module' }).catch((e) => {
      console.error('SW registration failed:', e);
    });
    // Watch for new deploys and drive the top-bar update badge.
    initAppUpdate();
  });

  // Android draws the app under the status bar (forced edge-to-edge on
  // targetSdk 35+) but its WebView reports no safe-area inset, which put the
  // top bar — and the Update button — behind the camera cutout.
  $effect(() => {
    applySafeAreaFallback();
  });

  // Plays a short synthesized melody (see $lib/alarmSound.ts) whenever
  // the service worker tells us an alarm just fired -- the system
  // notification's own sound is a short, generic ping with no way to
  // attach a custom sound file via the Web Notification API, so this
  // gives a fuller "this is an alarm, not just a ping" experience
  // whenever the app is actually open (foreground/background tab) or
  // gets opened by tapping the notification.
  $effect(() => {
    if (!('serviceWorker' in navigator)) return;
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'PLAY_ALARM_SOUND') playAlarmMelody();
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  });

  $effect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  });

  // — Haptics —
  // Load the saved on/off preference at boot. Mirrored into reactive state so
  // the Settings toggle reflects and updates it live.
  let haptics = $state(true);
  $effect(() => {
    initHaptics();
    haptics = hapticsEnabled();
  });
  function toggleHaptics() {
    haptics = !haptics;
    setHapticsEnabled(haptics);
    if (haptics) haptic('success'); // let them feel what they just turned on
  }

  function toggleTheme() {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    html.toggleAttribute('data-theme', !isLight);
    localStorage.setItem('theme', isLight ? 'dark' : 'light');
  }

  // — Text size —
  // The complaint was simply "the font is WAY too small". Every font-size in
  // the app is a rem, so one number on <html> moves all of them at once; the
  // layout is flex/grid throughout and reflows around the larger text. The
  // three explicit steps now live in the Settings sheet (⋯) as A / A⁺ / A⁺⁺.
  // The applied value is read back from the DOM, so this stays in sync with
  // the pre-paint script in app.html rather than keeping a second copy of it.
  const UI_SCALES = [1, 1.15, 1.3];
  let uiScale = $state(1);
  $effect(() => {
    const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
    if (s >= 1 && s <= 1.4) uiScale = s;
  });

  function setTextSize(s: number) {
    uiScale = s;
    document.documentElement.style.setProperty('--ui-scale', String(s));
    try { localStorage.setItem('uiScale', String(s)); } catch { /* storage disabled */ }
  }
</script>

<div id="app">
  {#if !$authReady}
    <!-- The boot screen (src/app.html) is still up, its coin spinning. -->
  {:else if !$user}
    <AuthGate />
  {:else if needsOnboarding}
    <div id="topbar">
      <div id="topbar-title" class="wordmark"><b>Slim</b> Chance</div>
      <div class="flex ac gap2">
        <Diagnostics />
        <button class="icn-btn" onclick={signOut} title="Sign out">⎋</button>
      </div>
    </div>
    <main id="pages">
      <!-- Escape hatch. If an existing user's profile hasn't reached this device
           yet, they'd otherwise be stuck staring at first-run setup with no way
           to say "no, I already have an account". Re-pulling from the server
           usually clears it outright. -->
      {#if !$isTrial}
        <button class="ob-recover" onclick={doRefresh} disabled={$refreshing}>
          {$refreshing ? 'Checking…' : 'Already have an account? Re-check my data →'}
        </button>
      {/if}
      <Onboarding onDone={() => (onboardingDone = true)} />
    </main>
  {:else}
  <div id="topbar">
    <div class="flex ac gap2">
      <div id="topbar-title" class="wordmark"><b>Slim</b> Chance</div>
    </div>
    <div class="flex ac gap2">
      <UpdateBadge />
      <!-- The readiness score used to sit here as a second, unexplained number
           next to the Pulse score — two figures, neither showing its working,
           and no hint that one is a WEIGHTED INPUT to the other. It now appears
           as the "Recovery" row inside the Pulse breakdown, which is what it
           actually is. Full sleep/heart-rate detail is one tap further in. -->
      <a class="icn-btn" href="{base}/alarms" title="Alarms & reminders" aria-label="Alarms and reminders"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0"/></svg></a>
      <Diagnostics />
      <button class="icn-btn" onclick={() => (menuOpen = true)} title="More" aria-label="More options">⋯</button>
    </div>
  </div>

  <!-- A weight typed into the notification that's far off the trend: asked
       here, once, before it bends five weeks of numbers. Closing it asks again
       next time; only the buttons decide. -->
  <Modal open={!!$confirmWeight} onclose={() => confirmWeight.set(null)}>
    {#if $confirmWeight}
      <div class="cw-h">{wt(nativeKg($confirmWeight))}?</div>
      <p class="cw-p">
        You typed it on the notification{$confirmWeight.date !== $body.today ? ` on ${$confirmWeight.date}` : ''}. It's
        {confirmOff != null ? `${dwt(confirmOff)} ${confirmOff > 0 ? 'above' : 'below'}` : 'far from'} your trend
        {$body.currentKg != null ? `of ${wt($body.currentKg)}` : ''}. Scales misread and fingers slip.
      </p>
      <button class="btn bp bfl" onclick={() => answerWeight(untrack(momentCtx), true)}>Save {wt(nativeKg($confirmWeight))}</button>
      <button class="btn bg_ bfl cw-no" onclick={() => answerWeight(untrack(momentCtx), false)}>It was a typo: don't save it</button>
    {/if}
  </Modal>

  <SaveAccount open={$saveAccountOpen} onclose={() => saveAccountOpen.set(false)} />
  <ImportWeights open={$importOpen} onclose={() => importOpen.set(false)} />

  <Modal open={menuOpen} onclose={() => (menuOpen = false)}>
    <div class="menu-h">Settings</div>
    {#if $isTrial}
      <button class="menu-item menu-save" onclick={() => { menuOpen = false; saveAccountOpen.set(true); }}>
        <span>Save my account</span><span class="menu-val">Keep it if you lose this device</span>
      </button>
    {/if}
    <div class="menu-row">
      <span class="menu-lbl">Text size</span>
      <div class="menu-sizes">
        {#each UI_SCALES as s, i}
          <button class="menu-size" class:on={Math.abs(s - uiScale) < 0.01} onclick={() => setTextSize(s)}>{['A','A⁺','A⁺⁺'][i]}</button>
        {/each}
      </div>
    </div>
    <div class="menu-row">
      <span class="menu-lbl">Weight in</span>
      <div class="menu-sizes">
        {#each UNIT_CHOICES as c}
          <button class="menu-size" class:on={unitsKey === c.v} onclick={() => chooseUnits(c.v)}>{c.l}</button>
        {/each}
      </div>
    </div>
    {#if unitsErr}<div class="menu-note">{unitsErr}</div>{/if}
    <button class="menu-item" onclick={toggleCycle}>
      <span>Period-aware weight</span><span class="menu-val">{cycleOn ? 'On' : 'Off'}</span>
    </button>
    <button class="menu-item" onclick={toggleCoach}>
      <span>AI coach</span><span class="menu-val">{$coachOn ? 'On' : 'Off'}</span>
    </button>
    <div class="menu-note">
      {#if $coachOn}
        Each afternoon it writes tonight's message from your last two weeks, or stays quiet when the day needs nothing, and may notice one pattern on Today.
        {#if $brainNote}<br>{$brainNote}{/if}
        {#if $coachNotes}<br><br><b>What it has learned:</b> {$coachNotes} <button class="menu-size" onclick={forgetCoachNotes}>Forget</button>{/if}
      {:else}
        Lets an AI write tonight's message, or stay quiet, and notice one pattern a day. Once a day it sends Google's Gemini a two-week summary: weights, calories and protein per day, training, your plans and usual foods. No photos and no name. Off unless you turn it on.
      {/if}
    </div>
    <a class="menu-item" href="{base}/meds" onclick={() => (menuOpen = false)}>
      <span>GLP-1 companion</span><span class="menu-val">Plus preview</span>
    </a>
    {#if cycleOn}<div class="menu-note">Mark the first day of each period on Today. After three cycles Slim Chance learns how much your weight moves around a period and explains those mornings. Off by default; turning it off keeps the dates you marked.</div>{/if}
    <button class="menu-item" onclick={toggleTheme}>
      <span>Theme</span><span class="menu-val">☀️ / 🌙</span>
    </button>
    <button class="menu-item" onclick={toggleHaptics}>
      <span>Haptics</span><span class="menu-val">{haptics ? 'On 📳' : 'Off'}</span>
    </button>
    <button class="menu-item" onclick={() => { menuOpen = false; importOpen.set(true); }}>
      <span>Import weigh-ins</span><span class="menu-val">From another app</span>
    </button>
    <!-- Your data is yours. Everything the account owns, in one tap, in a format
         a spreadsheet or another app can actually read. -->
    <button class="menu-item" onclick={() => exportData('json')} disabled={!!exporting}>
      <span>Export my data</span>
      <span class="menu-val">{exporting === 'json' ? '…' : 'JSON'}</span>
    </button>
    <button class="menu-item" onclick={() => exportData('csv')} disabled={!!exporting}>
      <span>Export as spreadsheet</span>
      <span class="menu-val">{exporting === 'csv' ? '…' : 'CSV'}</span>
    </button>
    {#if exportMsg}<div class="menu-note">{exportMsg}</div>{/if}
    <a class="menu-item" href="/privacy.html">
      <span>Privacy</span><span class="menu-val">What's kept, and where</span>
    </a>
    <a class="menu-item" href="https://github.com/slimchanceapp/slimchance" target="_blank" rel="noopener noreferrer">
      <span>Source code</span><span class="menu-val">AGPL-3.0 ↗</span>
    </a>
    {#if !$isTrial}
      <button class="menu-item danger" onclick={signOut}>
        <span>Sign out</span><span class="menu-val">⎋</span>
      </button>
    {/if}
    <button class="menu-item danger" onclick={() => { menuOpen = false; deleteText = ''; deleteErr = ''; deleteOpen = true; }}>
      <span>Delete my account</span><span class="menu-val">Everything, for good</span>
    </button>
  </Modal>

  <!-- The right to erasure, with eyes open: what goes, a way to keep a copy,
       and a word to type so it never happens by a slipped tap. -->
  <Modal open={deleteOpen} onclose={() => { if (!deleteBusy) deleteOpen = false; }}>
    <div class="cw-h">Delete your account?</div>
    <p class="cw-p">This deletes your account and everything in it: weigh-ins, food, training, plans,
      notes and photos, from Slim Chance's servers and from this phone. It can't be undone.</p>
    <p class="cw-p">Want a copy first? Close this and use Export my data.</p>
    <label class="flbl" for="del-confirm">Type delete to confirm</label>
    <input id="del-confirm" bind:value={deleteText} autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-bottom:12px">
    {#if deleteErr}<div class="menu-note">{deleteErr}</div>{/if}
    <button class="btn bfl del-btn" disabled={deleteText.trim().toLowerCase() !== 'delete' || deleteBusy} onclick={confirmDelete}>
      {deleteBusy ? 'Deleting…' : 'Delete everything'}
    </button>
    <button class="btn bg_ bfl cw-no" onclick={() => (deleteOpen = false)} disabled={deleteBusy}>Keep my account</button>
  </Modal>

  <div id="ptr" style="height:{pull}px" class:active={$refreshing}>
    <div class="ptr-inner" style="opacity:{Math.min(1, pull / 24)}">
      <span class="ptr-spin" class:spinning={$refreshing} style="transform:rotate({pullPct * 270}deg)">↻</span>
      <span class="ptr-text">{refreshLabel()}</span>
    </div>
  </div>

  <main
    id="pages"
    use:pullToRefresh={{
      onRefresh: doRefresh,
      onPull,
      threshold: PULL_THRESHOLD,
      enabled: !$refreshing
    }}
  >
    <svelte:boundary onerror={(e) => { console.error('Render error:', e); crashMsg = (e as any)?.message || String(e); recordError((e as any)?.message || String(e), { stack: (e as any)?.stack, kind: 'render' }); }}>
      {#key unitsKey}{@render children()}{/key}
      {#snippet failed(error, reset)}
        <div class="crash-box">
          <div style="font-size:2rem;margin-bottom:8px">⚠️</div>
          <div style="font-weight:700;color:var(--text);margin-bottom:6px">Something broke on this screen</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-bottom:14px;word-break:break-word">{String((error as any)?.message || error)}</div>
          <button class="btn bp bfl" onclick={() => { crashMsg = null; reset(); }}>Try again</button>
          <button class="btn bg_ bfl" style="margin-top:8px" onclick={() => location.assign('/')}>Go to Today</button>
        </div>
      {/snippet}
    </svelte:boundary>
  </main>

  {#if $refreshError}
    <div class="crash-toast" role="alert" style="background:var(--amber);color:#111">
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{$refreshError}</div>
      <button style="color:#111" onclick={() => refreshError.set(null)}>&times;</button>
    </div>
  {/if}

  {#if crashMsg}
    <div class="crash-toast" role="alert">
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{crashMsg}</div>
      <button onclick={() => crashMsg = null}>&times;</button>
    </div>
  {/if}

  <BottomNav />
  <CoachToast />
  <NativeUpdateBanner />
  {/if}
</div>

<!-- A tab that takes a moment: the coin spins, after 300 ms, so a quick one never flashes it. -->
{#if navigating.to}
  <div class="nav-wait" role="status" aria-label="Loading"><div class="nav-coin"><CoinSpin size={40} /></div></div>
{/if}

<style>
  .nav-wait{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0;animation:nav-in .2s ease .3s forwards}
  .nav-coin{display:flex;align-items:center;justify-content:center;width:84px;height:84px;border-radius:50%;background:var(--bg2);border:1px solid var(--border);box-shadow:0 10px 30px rgba(0,0,0,.25)}
  @keyframes nav-in{to{opacity:1}}
  .cw-h{font-family:var(--font-display);font-size:1.75rem;font-weight:700;color:var(--text);margin-bottom:8px}
  .cw-p{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 14px}
  .cw-no{margin-top:8px}
#topbar{background:var(--bg);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:calc(var(--st) + 10px) 18px 12px;min-height:calc(var(--st) + var(--top-h));z-index:50;flex-shrink:0}
#topbar-title{font-family:var(--font-display);font-size:26px;font-weight:800;letter-spacing:-.01em;line-height:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* The topbar is chrome, so it is pinned in px and does NOT follow --ui-scale.
     At the largest text size a scaled brand mark plus the buttons is wider than
     a 360px phone, and what gets pushed off the edge is Sign out and the
     text-size control itself — i.e. you could make the text big enough that you
     could no longer make it small again. Pin the topbar and let buttons shrink. */
  .icn-btn{width:36px;height:36px;flex-shrink:0;border-radius:var(--r-sm);border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s var(--ease);font-size:16px;text-decoration:none}
.icn-btn:active{transform:scale(.9);border-color:var(--text)}
  .icn-btn svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .menu-h{font-family:var(--font-display);font-size:1.5rem;font-weight:700;color:var(--text);margin-bottom:14px;letter-spacing:0}
  .menu-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)}
  .menu-lbl{font-size:0.9375rem;font-weight:700;color:var(--text)}
  .menu-sizes{display:flex;gap:6px}
  .menu-size{width:42px;height:36px;border-radius:var(--r-sm);border:1px solid var(--border2);background:var(--bg3);color:var(--muted);font-weight:800;cursor:pointer;font-family:inherit}
  .menu-size.on{background:var(--amber);color:var(--bg);border-color:transparent}
  .del-btn{background:var(--red);color:var(--bg)}
  .menu-item{display:flex;text-decoration:none;align-items:center;justify-content:space-between;width:100%;gap:12px;padding:14px 0;border:none;border-bottom:1px solid var(--border);background:none;color:var(--text);font-size:0.9375rem;font-weight:700;cursor:pointer;font-family:inherit}
  .menu-item .menu-val{color:var(--muted);font-weight:600}
  .menu-item.danger{color:var(--red);border-bottom:none}
  .menu-item.menu-save{color:var(--amber)}
  .menu-item:disabled{opacity:.55}
  /* Says what actually left the app and where it went — an export you can't
     confirm is an export you don't trust. */
  .menu-note{font-size:0.6875rem;line-height:1.45;color:var(--muted);padding:8px 0 2px}
#pages{flex:1;overflow-y:auto;overflow-x:hidden;padding:18px 16px calc(var(--nav-h) + 28px + var(--sb));overscroll-behavior-y:contain}
  /* Pull-to-refresh indicator: a zero-height strip above the scroll area that
     grows with the drag, so the content moves down with the finger. */
  #ptr{flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--bg2);transition:height .25s var(--ease)}
  #ptr.active{transition:none}
  .ptr-inner{display:flex;align-items:center;gap:8px;font-size:0.7188rem;font-weight:700;color:var(--amber);white-space:nowrap}
  .ptr-spin{display:inline-block;font-size:0.9375rem;line-height:1}
  .ptr-spin.spinning{animation:ptr-rot .8s linear infinite}
  @keyframes ptr-rot{to{transform:rotate(360deg)}}
  .ptr-text{letter-spacing:.2px}
  #app{display:flex;flex-direction:column;height:100vh;height:calc(100dvh + var(--ios-gap,0px))}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  #pages > :global(*){animation:fadeUp .35s var(--ease)}
  .ob-recover{display:block;width:100%;max-width:460px;margin:0 auto 4px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px;color:var(--amber);font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit}
  .ob-recover:disabled{opacity:.6}
  .crash-box{text-align:center;padding:40px 20px}
  .crash-toast{position:fixed;left:12px;right:12px;bottom:calc(var(--nav-h) + var(--sb) + 12px);z-index:100;background:var(--red);color:#fff;font-size:0.75rem;font-weight:600;padding:10px 12px;border-radius:12px;display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
  .crash-toast button{background:none;border:none;color:#fff;font-size:1.125rem;line-height:1;cursor:pointer;opacity:.8}
</style>
