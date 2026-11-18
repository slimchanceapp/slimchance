<script lang="ts">
  // "Bring in your watch and phone?" on Today, Android app only (2026-11-18).
  // Asked in plain sight with a "Not now", instead of a dialog that fired on
  // its own when the account was made. After Connect it says which app the
  // data comes from (OHealth, Samsung Health…), or how to switch sharing on
  // in that app when nothing has arrived. "Not now" is remembered.
  // Then, once that's answered, the morning note: Android's notification
  // permission, asked here rather than by a background reminder.
  import { user } from '$lib/stores/user';
  import { noteEvent } from '$lib/metrics/events';
  import { isAndroidApp } from '$lib/platform';
  import { healthConnect, syncHealthConnect, openHealthConnectSettings } from '$lib/health/healthConnect';
  import { brandForPackage, setupHelp } from '$lib/health/watches';
  import { notesPermission } from '$lib/moments/nativeAlarms';
  import { healthAskOpen } from '$lib/stores/notices';
  import { speak } from '$lib/stores/toast';

  const KEY = 'recompos.healthAskLater';
  let later = $state((() => { try { return !!localStorage.getItem(KEY); } catch { return false; } })());
  let step = $state<'ask' | 'asking' | 'done'>('ask');
  const shared = $derived(($healthConnect.grantedPerms ?? []).length > 0);
  // Known to share nothing: a sync has checked and found no permission.
  const none = $derived($healthConnect.native && $healthConnect.available && $healthConnect.grantedPerms != null && !shared);
  // Opened again from the menu (··· → Watch & phone data).
  let reopened = $state(false);
  $effect(() => {
    if (!$healthAskOpen) return;
    healthAskOpen.set(false);
    later = false;
    reopened = true;
    step = 'ask';
    try { localStorage.removeItem(KEY); } catch { /* nothing remembered */ }
  });
  const show = $derived(isAndroidApp() && (((none || reopened) && !shared && !later) || step !== 'ask'));
  const brands = $derived([...new Set($healthConnect.sources.map((p) => brandForPackage(p)).filter((b) => b && b.id !== 'phone').map((b) => b!.companionApp))]);
  const help = $derived(setupHelp('other'));

  const NOTES_KEY = 'recompos.notesAskLater';
  let notesLater = $state((() => { try { return !!localStorage.getItem(NOTES_KEY); } catch { return false; } })());
  let notes = $state<'granted' | 'denied' | 'prompt' | null>(null);
  let notesStep = $state<'ask' | 'on' | 'blocked'>('ask');
  $effect(() => { if (isAndroidApp()) notesPermission().then((p) => (notes = p)); });
  const showNotes = $derived(isAndroidApp() && !show && notes != null && ((notes !== 'granted' && !notesLater) || notesStep !== 'ask'));

  async function allowNotes() {
    notes = await notesPermission(true);
    notesStep = notes === 'granted' ? 'on' : 'blocked';
  }
  function notesNotNow() {
    speak('notes-later', 'Any time: ··· menu → Notifications', { force: true });
    notesDone();
  }
  function notesDone() {
    notesLater = true;
    notesStep = 'ask';
    try { localStorage.setItem(NOTES_KEY, '1'); } catch { /* asked again on another visit */ }
  }

  async function connect() {
    const uid = $user?.id;
    if (!uid) return;
    noteEvent('health_yes');
    step = 'asking';
    await syncHealthConnect(uid, { force: true });
    step = 'done';
  }
  function notNow() {
    noteEvent('health_later');
    speak('health-later', 'Any time: ··· menu → Watch & phone data', { force: true });
    later = true;
    reopened = false;
    try { localStorage.setItem(KEY, '1'); } catch { /* asked again on another visit */ }
  }
</script>

{#if showNotes}
  <section class="card ha" aria-label="Morning note">
    {#if notesStep === 'ask'}
      <div class="ha-t">A quiet note each morning?</div>
      <p class="ha-b">One line at your first unlock after 6:00: where your weight really is and today's chance. No sound, never an alarm.</p>
      <div class="ha-row">
        <button class="ha-btn ha-yes" data-tap="notes-allow" onclick={allowNotes}>Allow</button>
        <button class="ha-btn" data-tap="notes-later" onclick={notesNotNow}>Not now</button>
      </div>
    {:else if notesStep === 'on'}
      <div class="ha-t">Morning note is on</div>
      <p class="ha-b">Tomorrow, at your first unlock after 6:00.</p>
      <button class="ha-close" onclick={notesDone}>Close</button>
    {:else}
      <div class="ha-t">Android has notifications off</div>
      <p class="ha-b">Turn them on in Settings → Apps → Slim Chance → Notifications.</p>
      <button class="ha-close" onclick={notesDone}>Close</button>
    {/if}
  </section>
{/if}

{#if show}
  <section class="card ha" aria-label="Watch and phone data">
    {#if step === 'ask'}
      <div class="ha-t">Bring in your watch and phone?</div>
      <p class="ha-b">Steps, sleep, heart rate and workouts, read from Health Connect, where OHealth, Samsung Health, Fitbit and others share them. Slim Chance only reads, and you can stop it any time.</p>
      <div class="ha-row">
        <button class="ha-btn ha-yes" data-tap="health-connect" onclick={connect}>Connect</button>
        <button class="ha-btn" data-tap="health-later" onclick={notNow}>Not now</button>
      </div>
    {:else if step === 'asking'}
      <div class="ha-t">Asking Android…</div>
    {:else if !shared}
      <div class="ha-t">Android didn't show the request</div>
      <p class="ha-b">Open Health Connect, find Slim Chance under app permissions, and allow what you're happy to share.</p>
      <div class="ha-row">
        <button class="ha-btn ha-yes" data-tap="health-settings" onclick={() => openHealthConnectSettings()}>Open Health Connect</button>
        <button class="ha-btn" onclick={() => (step = 'ask')}>Close</button>
      </div>
    {:else if brands.length}
      <div class="ha-t">Connected</div>
      <p class="ha-b">Reading from {brands.join(' and ')}. New data shows up each time you open Slim Chance.</p>
      <button class="ha-close" onclick={() => (step = 'ask')}>Close</button>
    {:else}
      <div class="ha-t">Connected, nothing in yet</div>
      <p class="ha-b">Your watch's app has to share with Health Connect too. Most ship with it off:</p>
      <ol class="ha-steps">{#each help.steps as s}<li>{s}</li>{/each}</ol>
      <button class="ha-close" onclick={() => (step = 'ask')}>Close</button>
    {/if}
  </section>
{/if}

<style>
  .ha{padding:13px 14px}
  .ha-t{font-family:var(--font-display);font-size:1.25rem;font-weight:700;color:var(--text);margin-bottom:6px}
  .ha-b{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 10px}
  .ha-row{display:flex;flex-wrap:wrap;gap:8px}
  .ha-btn{font:inherit;font-size:0.875rem;font-weight:700;color:var(--text);background:var(--bg3);border:1px solid var(--border2);border-radius:999px;padding:8px 13px;cursor:pointer;transition:transform .15s var(--ease)}
  .ha-yes{background:var(--amber);border-color:var(--amber);color:var(--bg)}
  .ha-btn:active{transform:scale(.96)}
  .ha-steps{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 10px;padding-left:1.2rem}
  .ha-close{background:none;border:none;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--muted);cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:0}
</style>
