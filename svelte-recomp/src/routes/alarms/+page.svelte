<script lang="ts">
  import { userId } from '$lib/stores/user';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveAlarms } from '$lib/stores/live';
  import Modal from '$lib/components/Modal.svelte';
  import { swipeActions } from '$lib/actions/swipe';
  import { scheduleNativeAlarms, type AlarmRow } from '$lib/moments/nativeAlarms';
  import db from '$lib/db/dexie';
  import Moments from '$lib/components/Moments.svelte';

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  // Reads live from IndexedDB via Dexie's liveQuery (see live.ts) instead
  // of a one-shot load re-triggered from a $syncStatus effect. That old
  // pattern was the same race found in meal_plans: once syncStatus
  // settles to 'synced' and stays there, a later realtime push (e.g. a
  // delete from another device) updates IndexedDB correctly but never
  // re-triggers the reload effect, since $syncStatus itself didn't
  // change value again -- so the page kept showing a stale, already-
  // deleted alarm until a full manual reload. liveQuery reacts directly
  // to the IndexedDB write, so this is fixed for every device instantly.
  const _alarms = liveAlarms();
  const alarms = $derived([...$_alarms].sort((a, b) => a.time.localeCompare(b.time)));
  const loading = $derived(false);

  // Swipe-left-to-reveal Delete (see $lib/actions/swipe.ts) -- tapping the
  // card opens Edit, swiping reveals a large Delete button behind it. This
  // replaces the old pair of tiny inline Edit/Delete buttons, which were
  // too small to hit reliably on a phone.
  let swipeOffsets = $state<Record<string, number>>({});
  let revealedId = $state<string | null>(null);

  let editing = $state<any | null>(null);
  let showModal = $state(false);

  let formTitle = $state('');
  let formMsg = $state('');
  let formTime = $state('08:00');
  let formDays = $state<number[]>([]);

  function openNew() {
    formTitle = ''; formMsg = ''; formTime = '08:00'; formDays = [];
    editing = null; showModal = true;
  }

  function openEdit(a: any) {
    formTitle = a.title; formMsg = a.message || ''; formTime = a.time;
    formDays = [...(a.days || [])]; editing = a; showModal = true;
  }

  function toggleDay(n: number) {
    if (formDays.includes(n)) formDays = formDays.filter(d => d !== n);
    else formDays = [...formDays, n].sort();
  }

  async function saveAlarm() {
    if (!uid || !formTitle.trim() || !formTime) return;
    const data: any = {
      id: editing?.id || crypto.randomUUID(),
      user_id: uid,
      title: formTitle.trim(),
      message: formMsg.trim(),
      time: formTime,
      days: [...formDays],
      enabled: editing?.enabled ?? true,
      // Detach from auto-management on any manual edit. Supabase's
      // upsert() only updates the columns present in this payload (a
      // real row was found with an edited title/time/days that still
      // carried its ORIGINAL auto_key from when it was first
      // auto-created) -- without this, tapping "Sync" on the Gym page
      // later would silently overwrite a hand-edited alarm back to
      // whatever the schedule currently says, undoing the user's
      // customization with no warning.
      auto_key: null,
    };
    await upsertRecord('alarms', data);
    showModal = false;
    scheduleAlarms();
  }

  async function toggleEnabled(alarm: any) {
    await upsertRecord('alarms', { ...alarm, enabled: !alarm.enabled });
    scheduleAlarms();
  }

  // NOTE: this used to gate on window.confirm(), but native
  // alert/confirm/prompt dialogs are well known to be unreliable (often
  // silently suppressed, returning immediately without ever showing UI)
  // inside installed PWAs running in standalone display mode on Android
  // -- which made this delete button silently do nothing there. The
  // swipe-to-reveal gesture itself already requires a deliberate action,
  // so no extra confirmation dialog is needed on top of it.
  async function deleteAlarm(alarm: any) {
    await db.table('alarms').delete(alarm.id);
    syncStatus.set('syncing');
    const { error } = await (await import('$lib/db/client')).supabase
      .from('alarms').delete().eq('id', alarm.id).eq('user_id', uid);
    if (error) console.error('Delete failed:', error);
    syncStatus.set('synced');
    scheduleAlarms();
  }

  // Web only: whether reminders can reach this browser.
  let webPushState = $state<'na' | 'ask' | 'blocked' | 'on'>('na');
  $effect(() => {
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return;
    webPushState = Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'blocked' : 'ask';
  });
  async function allowWebPush() {
    const { subscribeWebPush } = await import('$lib/push');
    await subscribeWebPush(uid);
    webPushState = Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'blocked' : 'ask';
  }

  async function scheduleAlarms() {
    // In the APK, Android owns the schedule (see nativeAlarms.ts) — the WebView has
    // no Notifications API, so the service-worker path below can only ever work on
    // the web. Fall through to it when this isn't the native app.
    if (await scheduleNativeAlarms(alarms as AlarmRow[])) return;

    if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) return;

    const now = Date.now();
    const alarmsToSchedule: Array<{ id: string; title: string; msg: string; fireAt: number }> = [];

    for (const a of alarms) {
      if (!a.enabled || !a.days?.length) continue;
      const [h, m] = a.time.split(':').map(Number);
      for (const day of a.days) {
        let d = new Date();
        const today = d.getDay();
        let diff = day - today;
        if (diff < 0 || (diff === 0 && (h < d.getHours() || (h === d.getHours() && m <= d.getMinutes())))) diff += 7;
        d.setDate(d.getDate() + diff);
        d.setHours(h, m, 0, 0);
        const fireAt = d.getTime();
        if (fireAt > now) {
          alarmsToSchedule.push({ id: a.id, title: a.title, msg: a.message || '', fireAt });
        }
      }
    }

    navigator.serviceWorker.controller.postMessage({
      type: 'SCHEDULE_ALARMS',
      alarms: alarmsToSchedule,
    });
  }

  function dayLabel(alarm: any): string {
    if (!alarm.days?.length) return 'Once';
    const d = alarm.days;
    if (d.length === 7) return 'Daily';
    if (d.join(',') === '1,2,3,4,5') return 'Weekdays';
    if (d.join(',') === '0,6') return 'Weekends';
    return d.map((i: number) => DAYS[i]).join(', ');
  }
</script>

<div class="page-hd">Alarms</div>
<div class="page-sub sync-sub">
  <span class="sync-dot" class:synced={$syncStatus === 'synced'} class:syncing={$syncStatus === 'syncing'} class:error={$syncStatus === 'error'}></span>
  {#if $syncStatus === 'synced'}Synced just now{:else if $syncStatus === 'syncing'}Syncing…{:else if $syncStatus === 'error'}Sync error — check your connection{:else}Not connected{/if}
</div>

{#if webPushState === 'ask'}
  <!-- On the web, reminders need the browser's permission; asked only here
       and in setup, when the person chooses them. -->
  <div class="card" style="padding:13px 14px">
    <p style="font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 10px">Allow notifications so your reminders can reach you.</p>
    <button class="btn bp bsm" onclick={allowWebPush}>Allow notifications</button>
  </div>
{:else if webPushState === 'blocked'}
  <div class="card" style="padding:13px 14px"><p style="font-size:0.875rem;line-height:1.5;color:var(--muted);margin:0">Notifications are blocked for this site in your browser's settings, so reminders can't reach you here.</p></div>
{/if}

<Moments />

{#if loading}
  <div style="color:var(--muted);text-align:center;padding:20px">Loading...</div>
{:else if alarms.length === 0}
  <div class="card" style="text-align:center;padding:30px">
    <div style="font-size:2rem;margin-bottom:8px">⏰</div>
    <div style="font-size:0.9375rem;font-weight:600;color:var(--text);margin-bottom:4px">No alarms yet</div>
    <div style="font-size:0.8125rem;color:var(--muted);margin-bottom:12px">Add your first alarm to get started</div>
  </div>
{:else}
  {#each alarms as alarm}
    <div class="swipe-row">
      <div class="swipe-actions">
        <div class="swipe-delete" onclick={() => deleteAlarm(alarm)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); deleteAlarm(alarm); } }}>Delete</div>
      </div>
      <div class="acard swipe-content"
        style="transform:translateX({swipeOffsets[alarm.id] ?? 0}px)"
        use:swipeActions={{
          onOffset: (px) => swipeOffsets = { ...swipeOffsets, [alarm.id]: px },
          onSettle: (open) => { revealedId = open ? alarm.id : null; }
        }}
        onclick={() => { if (revealedId !== alarm.id) openEdit(alarm); }}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (revealedId !== alarm.id) openEdit(alarm); } }}
        role="button"
        tabindex="0"
      >
        <div class="flex jb ac">
          <div class="atime">{alarm.time}</div>
          <div class="tog" class:on={alarm.enabled} onclick={(e) => { e.stopPropagation(); toggleEnabled(alarm); }} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleEnabled(alarm); } }} role="switch" tabindex="0" aria-checked={alarm.enabled}></div>
        </div>
        <div class="atitle">{alarm.title}</div>
        {#if alarm.message}
          <div class="amsg">{alarm.message}</div>
        {/if}
        <div class="dchips">
          {#each DAYS as day, i}
            <div class="dc" class:on={alarm.days?.includes(i)}>{day}</div>
          {/each}
        </div>
        <div style="font-size:0.6875rem;color:var(--muted);margin-top:6px">{dayLabel(alarm)} &middot; tap to edit, swipe left to delete</div>
      </div>
    </div>
  {/each}
{/if}

<button class="btn bp bfl" style="margin-top:4px" onclick={openNew}>+ Add Alarm</button>

<Modal open={showModal} onclose={() => showModal = false}>
  <div style="font-size:1.125rem;font-weight:700;color:var(--text);margin-bottom:12px">{editing ? 'Edit Alarm' : 'New Alarm'}</div>

  <label class="flbl" for="alarm-title">Title</label>
  <input id="alarm-title" type="text" bind:value={formTitle} placeholder="e.g. Morning weigh-in" style="margin-bottom:12px">

  <label class="flbl" for="alarm-msg">Message (optional)</label>
  <input id="alarm-msg" type="text" bind:value={formMsg} placeholder="e.g. Step on the scale" style="margin-bottom:12px">

  <label class="flbl" for="alarm-time">Time</label>
  <input id="alarm-time" type="time" bind:value={formTime} style="margin-bottom:12px">

  <div class="flbl" style="margin-bottom:6px">Repeat</div>
  <div class="dchips" style="margin-bottom:16px">
    {#each DAYS as day, i}
      <div class="dc" class:on={formDays.includes(i)} onclick={() => toggleDay(i)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDay(i); } }} style="cursor:pointer">{day}</div>
    {/each}
  </div>

  <div class="flex gap2">
    <button class="btn bg_ bfl" onclick={() => showModal = false}>Cancel</button>
    <button class="btn bp bfl" onclick={saveAlarm} disabled={!formTitle.trim()}>Save</button>
  </div>
</Modal>
