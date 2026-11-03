<script lang="ts">
  // Train's offer of a program, at the bottom of the page and put away with
  // "Not now" (the owner, 2026-11-03: back injury-free, the offer had no way
  // to go, and a back can still flare up again). Put away, it folds to one
  // line that opens it again. A running program keeps its card at the top
  // (BackRebuild).
  import { liveProfile, liveSchedule } from '$lib/stores/live';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';
  import { todayDate } from '$lib/stores/refresh';
  import { haptic } from '$lib/haptics';
  import { nextMonday, gymKeysInOrder } from '$lib/program';

  const KEY = 'recompos.programOfferAway';
  const _profile = liveProfile();
  const _schedule = liveSchedule();
  let away = $state((() => { try { return !!localStorage.getItem(KEY); } catch { return false; } })());
  let open = $state(false);
  let busy = $state(false);
  const today = $derived($todayDate as string);
  const show = $derived(!($_profile as any)?.program?.start && gymKeysInOrder($_schedule as any[]).length > 0);
  const startLabel = $derived(new Date(nextMonday(today) + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }));

  function notNow() {
    away = true; open = false;
    try { localStorage.setItem(KEY, '1'); } catch { /* offered again next visit */ }
  }
  async function start(on: string) {
    if (!$userId || busy) return;
    busy = true;
    try {
      await upsertRecord('user_settings', { user_id: $userId, program: { id: 'back-rebuild', start: on }, updated_at: new Date().toISOString() });
      haptic('success');
    } finally { busy = false; }
  }
</script>

{#if show}
  {#if away && !open}
    <button class="po-row" onclick={() => (open = true)}>
      <span><b>Back Rebuild</b><em>Coming back from a back injury? Six weeks that pace themselves.</em></span>
      <span class="po-go" aria-hidden="true">›</span>
    </button>
  {:else}
    <section class="card po">
      <span class="po-eyebrow">Programs</span>
      <h2 class="po-t">Coming back from a back injury?</h2>
      <p class="po-b">Back Rebuild: six weeks in three phases. It takes over your gym days, paces itself on how your back feels each morning, and gives you your own plan back at the end.</p>
      <div class="po-actions">
        <button class="btn bp bsm" disabled={busy} onclick={() => start(nextMonday(today))}>Start {startLabel}</button>
        <button class="btn bg_ bsm" disabled={busy} onclick={() => start(today)}>Start today</button>
        <button class="po-later" onclick={notNow}>Not now</button>
      </div>
    </section>
  {/if}
{/if}

<style>
  .po-eyebrow{font-family:var(--font-label);font-size:0.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .po-t{font-family:var(--font-display);font-size:1.75rem;font-weight:700;line-height:1;color:var(--text);margin:6px 0 10px}
  .po-b{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 6px}
  .po-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
  .po-later{background:none;border:none;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--muted);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
  .po-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer;
    background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px;margin:14px 0}
  .po-row span:first-child{display:flex;flex-direction:column;gap:2px;min-width:0}
  .po-row b{font-size:0.9375rem;font-weight:800;color:var(--text)}
  .po-row em{font-style:normal;font-size:0.8125rem;line-height:1.4;color:var(--muted)}
  .po-go{color:var(--muted);font-size:1.25rem}
</style>
