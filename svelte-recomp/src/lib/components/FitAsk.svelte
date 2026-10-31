<script lang="ts">
  // "Is Slim Chance for you?" on days 3 to 7, once (src/lib/fit.ts). One tap,
  // then one tap for what's in the way; words go to hello@. Asked once even
  // if the reason is skipped: a question that comes back is a nag.
  import { user } from '$lib/stores/user';
  import { liveProfile } from '$lib/stores/live';
  import { todayDate } from '$lib/stores/refresh';
  import { noteEvent } from '$lib/events';
  import { ymd } from '$lib/date';
  import { FIT_ANSWERS, FIT_REASONS, fitAskDue } from '$lib/fit';

  const KEY = 'recompos.fitAsked';
  const _p = liveProfile();
  let answered = $state((() => { try { return !!localStorage.getItem(KEY); } catch { return false; } })());
  let step = $state<'ask' | 'why' | 'thanks' | 'closed'>('ask');
  let pleased = $state(false);
  const due = $derived(fitAskDue({
    joined: $user?.created_at ? ymd($user.created_at) : null,
    today: $todayDate as string,
    setupDone: !!($_p as any)?.onboarded_at,
    answered,
  }));

  function answer(event: (typeof FIT_ANSWERS)[number]['event']) {
    noteEvent(event);
    answered = true;
    try { localStorage.setItem(KEY, '1'); } catch { /* asked again on another visit */ }
    pleased = event === 'fit_yes';
    step = pleased ? 'thanks' : 'why';
  }
  function reason(event: (typeof FIT_REASONS)[number]['event']) {
    noteEvent(event);
    step = 'thanks';
  }
</script>

{#if (due && step === 'ask') || step === 'why' || step === 'thanks'}
  <section class="card fa" aria-label="Is Slim Chance for you?">
    {#if step === 'ask'}
      <div class="fa-t">Is Slim Chance for you?</div>
      <p class="fa-b">A few days in. One tap tells us what to fix; we only ever look at the totals.</p>
      <div class="fa-row">
        {#each FIT_ANSWERS as a}<button class="fa-btn" onclick={() => answer(a.event)}>{a.label}</button>{/each}
      </div>
    {:else if step === 'why'}
      <div class="fa-t">What's in the way?</div>
      <div class="fa-row">
        {#each FIT_REASONS as r}<button class="fa-btn" onclick={() => reason(r.event)}>{r.label}</button>{/each}
      </div>
    {:else}
      <div class="fa-t">{pleased ? 'Good to hear.' : 'Thank you, that helps.'}</div>
      <p class="fa-b">{pleased ? 'If anything gets in your way, ' : 'Words help even more: '}<a href="mailto:hello@slimchance.app?subject=Slim%20Chance">hello@slimchance.app</a>{pleased ? ' reaches the person who builds it.' : ' reaches the person who builds Slim Chance.'}</p>
      <button class="fa-close" onclick={() => (step = 'closed')}>Close</button>
    {/if}
  </section>
{/if}

<style>
  .fa{padding:13px 14px}
  .fa-t{font-family:var(--font-display);font-size:1.25rem;font-weight:700;color:var(--text);margin-bottom:6px}
  .fa-b{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 10px}
  .fa-b a{color:var(--amber);font-weight:700}
  .fa-row{display:flex;flex-wrap:wrap;gap:8px}
  .fa-btn{font:inherit;font-size:0.875rem;font-weight:700;color:var(--text);background:var(--bg3);border:1px solid var(--border2);border-radius:999px;padding:8px 13px;cursor:pointer;transition:transform .15s var(--ease)}
  .fa-btn:active{transform:scale(.96)}
  .fa-close{background:none;border:none;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--muted);cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:0}
</style>
