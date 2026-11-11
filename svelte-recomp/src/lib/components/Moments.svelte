<script lang="ts">
  // The morning briefing and the evening hold: their switches, the morning's
  // time, and each one exactly as it would arrive. What goes in them:
  // src/lib/briefing.ts and src/lib/hold.ts. When they go out: MomentClock.java
  // on Android, Moments.swift on the iPhone.
  import { onMount } from 'svelte';
  import { briefings, holds, momentSetting, forecast, refreshForecast, saveMoments, type MomentSetting } from '$lib/stores/moments';
  import { momentsStatus, momentsSupport, showMomentNow, type MomentsState } from '$lib/moments/nativeAlarms';
  import { isAndroidApp, isIOSApp, isNativeApp } from '$lib/platform';
  import { holdAfter } from '$lib/moments';
  import { locationRefused } from '$lib/moments/weather';
  import { todayDate } from '$lib/stores/refresh';
  import { updateState } from '$lib/stores/nativeUpdate';

  // The moments live in the phone apps: Android posts each at the first unlock,
  // the iPhone (which tells no app it was unlocked) leaves it on the lock screen.
  const native = isNativeApp();
  const iphone = isIOSApp();
  const elsewhere = 'It comes with the Android app, and soon the iPhone app.';
  let support = $state<'all' | 'morning' | null | undefined>(undefined);
  let status = $state<MomentsState | null>(null);
  let saving = $state(false);
  let locating = $state(false);
  let error = $state('');

  onMount(async () => {
    support = await momentsSupport();
    if (support) status = await momentsStatus();
  });

  const s = $derived<MomentSetting>($momentSetting ?? { on: false, after: '06:00', hold: false });
  /** Build 8 put buttons on the briefing; older builds show it without. The
   *  iPhone's carry none yet. */
  const buttons = $derived(isAndroidApp() && ($updateState.installedBuild ?? 0) >= 8);
  /** Build 9 can post today's at once, to see where its buttons are. */
  const canShow = $derived(iphone || ($updateState.installedBuild ?? 0) >= 9);
  let sent = $state<string[] | null>(null);
  let sending = $state(false);
  const tomorrow = $derived($briefings[1] ?? null);
  const tonight = $derived($holds[0] ?? null);
  const startsAt = (dow: number) => { const m = holdAfter(dow); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const todayDow = $derived(new Date(`${$todayDate}T12:00:00`).getDay());
  const refused = $derived(!$forecast && !locating && locationRefused());
  const shownAt = (k: 'morning' | 'evening') => {
    const x = status?.[k];
    return x?.shown === $todayDate && x?.postedAt ? new Date(x.postedAt).toTimeString().slice(0, 5) : null;
  };

  async function save(next: MomentSetting) {
    if (saving) return;
    saving = true;
    error = '';
    try {
      await saveMoments(next);
    } catch (e: any) {
      error = 'Could not save — ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      saving = false;
    }
  }
  function setAfter(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (/^\d\d:\d\d$/.test(v) && v >= '04:00' && v <= '11:00' && v !== s.after) save({ ...s, after: v });
  }
  async function showNow() {
    sending = true;
    error = '';
    try {
      sent = await showMomentNow($todayDate, 'morning');
    } catch (e: any) {
      error = (e?.message || String(e)).slice(0, 160);
    } finally {
      sending = false;
    }
  }
  async function useLocation() {
    locating = true;
    try { await refreshForecast(true); } finally { locating = false; }
  }
  const keys = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
</script>

{#snippet preview(label: string, n: { title: string; body: string; actions?: { weigh: boolean; back: boolean; meal: unknown } })}
  <div class="mb-tag">{label}</div>
  <div class="mb-note-card">
    <div class="mb-app">Slim Chance</div>
    <div class="mb-title">{n.title}</div>
    {#each n.body.split('\n') as line}<div class="mb-line">{line}</div>{/each}
    {#if n.actions && buttons}
      <div class="mb-acts">
        {#if n.actions.weigh}<span>Log weight</span>{/if}
        {#if n.actions.back}<span>Rate back</span>{/if}
        {#if n.actions.meal}<span>Log usual breakfast</span>{/if}
      </div>
    {/if}
  </div>
  {#if n.actions && !buttons && !iphone}<div class="mb-meta">The update adds buttons to it: log your weight, rate your back and log your usual breakfast, from the watch too.</div>{/if}
{/snippet}

<div class="acard mb">
  <div class="flex jb ac">
    <div>
      <div class="mb-h">Morning briefing</div>
      <div class="amsg">{iphone ? `Waiting on the lock screen from ${s.after}` : `The first time you unlock after ${s.after}`}</div>
    </div>
    {#if support}
      <div class="tog" class:on={s.on} role="switch" tabindex="0" aria-checked={s.on} aria-label="Morning briefing"
        onclick={() => save({ ...s, on: !s.on })} onkeydown={keys(() => save({ ...s, on: !s.on }))}></div>
    {/if}
  </div>
  <p class="mb-lede">
    One notification: the weather where you are, the day's session and food, and your plan for the day.
    {iphone ? 'It\'s not an alarm: no sound, and the screen stays dark. It waits on the lock screen for your first look.'
      : 'It\'s not an alarm and makes no sound. If you don\'t pick the phone up, nothing comes.'}
  </p>

  {#if !native}
    <div class="mb-note">{elsewhere}</div>
  {:else if support === null}
    <div class="mb-note">It needs the app update: tap Update at the top of the screen.</div>
  {:else if support && s.on}
    <label class="flbl mb-lbl" for="mb-after">After</label>
    <input id="mb-after" type="time" min="04:00" max="11:00" value={s.after} onchange={setAfter} disabled={saving}>
    {#if tomorrow}{@render preview("Tomorrow's, as it stands", tomorrow)}{/if}
    {#if buttons || iphone}
      <div class="mb-meta">
        {#if buttons}On the phone the buttons sit under the notification: drag it down, or tap its arrow.{/if}
        {#if canShow}{' '}<button type="button" class="mb-link" onclick={showNow} disabled={sending}>{sending ? 'Sending…' : 'Show today’s now'}</button>{/if}
      </div>
      {#if sent}<div class="mb-meta">{sent.length ? `Sent, with ${sent.join(' · ')}.` : buttons ? 'Sent. Today’s has no buttons left: everything on it is logged.' : 'Sent.'}</div>{/if}
    {/if}
    <div class="mb-meta">
      {#if $forecast}
        Weather for roughly where the phone is.
      {:else if refused}
        Location is off for Slim Chance. Allow it in {iphone ? 'Settings → Slim Chance → Location' : 'Android Settings → Apps → Slim Chance → Permissions'}, then
        <button type="button" class="mb-link" onclick={useLocation}>try again</button>.
      {:else}
        <button type="button" class="mb-link" onclick={useLocation} disabled={locating}>{locating ? 'Finding the weather…' : 'Use my location for the weather'}</button>
      {/if}
      {#if shownAt('morning')}<div>Shown today at {shownAt('morning')}.</div>{/if}
    </div>
  {/if}
</div>

<div class="acard mb">
  <div class="flex jb ac">
    <div>
      <div class="mb-h">Evening hold</div>
      <div class="amsg">{iphone ? 'Waiting on the lock screen from 19:30' : 'The first time you unlock after 19:30'}, or 17:00 Friday to Sunday</div>
    </div>
    {#if support === 'all'}
      <div class="tog" class:on={s.hold} role="switch" tabindex="0" aria-checked={s.hold} aria-label="Evening hold"
        onclick={() => save({ ...s, hold: !s.hold })} onkeydown={keys(() => save({ ...s, hold: !s.hold }))}></div>
    {/if}
  </div>
  <p class="mb-lede">
    Evenings and weekends are when old habits pull hardest. This hands you your own plan for the evening,
    what's left of the day, and one line from the Stoics: Epictetus or Marcus Aurelius. On Friday it says
    the weekend has started.
  </p>

  {#if !native}
    <div class="mb-note">{elsewhere}</div>
  {:else if support === null || support === 'morning'}
    <div class="mb-note">It needs the app update: tap Update at the top of the screen.</div>
  {:else if support && s.hold}
    {#if tonight}{@render preview(`Tonight's, from ${startsAt(todayDow)}, as it stands`, tonight)}{/if}
    {#if shownAt('evening')}<div class="mb-meta">Shown today at {shownAt('evening')}.</div>{/if}
  {/if}
  {#if status?.allowed === false && (s.on || s.hold)}
    <div class="mb-note">Notifications are off for Slim Chance. Turn them on in Settings → Notifications → Slim Chance.</div>
  {/if}
  {#if error}<div class="mb-err">{error}</div>{/if}
</div>

<style>
  .mb{margin-bottom:14px}
  .mb-h{font-family:var(--font-display);font-size:1.25rem;font-weight:700;color:var(--text);letter-spacing:0;line-height:1.1}
  .mb-lede{font-size:0.8125rem;line-height:1.5;color:var(--muted);margin:10px 0 0}
  .mb-note{font-size:0.8125rem;color:var(--text);margin-top:10px}
  .mb-lbl{margin-top:12px}
  .mb-tag{font-family:var(--font-label);font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:14px 0 6px}
  /* Drawn as the notification it will be. */
  .mb-note-card{background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r-md);padding:10px 12px}
  .mb-app{font-size:0.6875rem;color:var(--muted);margin-bottom:3px}
  .mb-title{font-size:0.9375rem;font-weight:800;color:var(--text);margin-bottom:3px}
  .mb-line{font-size:0.8125rem;line-height:1.45;color:var(--text)}
  .mb-line + .mb-line{margin-top:2px}
  .mb-meta{font-size:0.75rem;line-height:1.5;color:var(--muted);margin-top:8px}
  .mb-acts{display:flex;flex-wrap:wrap;gap:14px;margin-top:9px;padding-top:8px;border-top:1px solid var(--border2)}
  .mb-acts span{font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text)}
  .mb-link{background:none;border:none;padding:0;font:inherit;font-weight:700;color:var(--text);cursor:pointer;
    text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2)}
  .mb-err{font-size:0.8125rem;color:var(--led-bad);margin-top:8px}
</style>
