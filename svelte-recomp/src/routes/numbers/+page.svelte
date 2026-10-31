<script lang="ts">
  // The owner's Numbers page: where new people give up, who comes back, and
  // what broke for them. Totals only, from owner_metrics (migration
  // 20261029100000_app_events), which answers only the accounts in app_owners;
  // anyone else gets nothing. Not linked from the app: the owner keeps the URL.
  import { supabase } from '$lib/db/client';
  import PageHero from '$lib/components/PageHero.svelte';

  interface Step { step: string; people: number }
  interface Metrics {
    days: number;
    funnel: Step[];
    logged_food: number;
    trials: number;
    saved_accounts: number;
    weeks: Array<{ week: string; people: number }>;
    opens: Array<{ day: string; people: number }>;
    errors: Array<{ message: string; times: number; people: number; last: string }>;
    /** The same steps per link tag (migration 20261031120000_came_from). */
    by_from?: Array<{ from: string; joined: number; setup: number; weighed: number; three_of_seven: number; week: number; month: number }>;
  }

  const SPANS = [30, 90, 365] as const;
  let days = $state<number>(90);
  let m = $state<Metrics | null>(null);
  let failed = $state('');
  let loading = $state(false);

  async function load() {
    loading = true;
    failed = '';
    const { data, error } = await supabase.rpc('owner_metrics', { p_days: days });
    loading = false;
    if (error) {
      m = null;
      failed = error.code === '42501' ? 'This page is only for the owner.' : error.message;
      return;
    }
    m = data as Metrics;
  }
  $effect(() => { void days; load(); });

  const first = $derived(m?.funnel[0]?.people || 0);
  const pct = (n: number) => (first ? Math.round((n / first) * 100) : 0);
  const peak = $derived(Math.max(1, ...(m?.opens.map((o) => o.people) ?? [1])));
</script>

<PageHero title="Numbers" sub="Where new people give up, and who comes back. Totals only; you're left out." />

<div class="tab-row" role="group" aria-label="Who joined in the last">
  {#each SPANS as s}
    <button class="tab" class:on={days === s} onclick={() => (days = s)}>{s} days</button>
  {/each}
</div>

{#if failed}
  <div class="card nb-note">{failed}</div>
{:else if !m}
  <div class="card nb-note">{loading ? 'Counting…' : ''}</div>
{:else}
  <section class="card" aria-label="From sign-up to staying">
    <div class="card-lbl">From sign-up to staying · joined in the last {m.days} days</div>
    {#each m.funnel as s, i}
      <div class="nb-row">
        <div class="nb-step">{s.step}</div>
        <div class="nb-bar" aria-hidden="true"><span style="width:{pct(s.people)}%"></span></div>
        <div class="nb-n">{s.people}{#if i > 0}{' '}· {pct(s.people)}%{/if}</div>
      </div>
    {/each}
    <p class="nb-foot">
      Setup screens are counted from 29 October 2026; earlier people show only whether they finished.
      "Back" means a weigh-in, a food entry or an app open that many days after joining.
    </p>
  </section>

  <section class="card" aria-label="Accounts">
    <div class="card-lbl">Accounts</div>
    <div class="nb-pair"><span>Still trials (no email)</span><b>{m.trials}</b></div>
    <div class="nb-pair"><span>Saved with an email</span><b>{m.saved_accounts}</b></div>
    <div class="nb-pair"><span>Logged any food</span><b>{m.logged_food}</b></div>
  </section>

  <section class="card" aria-label="By the link they came by">
    <div class="card-lbl">By the link they came by</div>
    {#each m.by_from ?? [] as g}
      <div class="nb-pair"><span>{g.from === 'untagged' ? 'No tag' : g.from}</span><b>{g.joined}</b></div>
      <p class="nb-foot nb-from">{g.setup} finished setup · {g.three_of_seven} weighed in on 3 of their first 7 days · {g.week} back after a week · {g.month} after four</p>
    {/each}
    <p class="nb-foot">A link like slimchance.app/?from=r-loseit-1 tags everyone who arrives by it; the first tag a person brings is theirs.</p>
  </section>

  <section class="card" aria-label="New people per week">
    <div class="card-lbl">New people per week</div>
    {#each m.weeks as w}
      <div class="nb-pair"><span>Week of {w.week}</span><b>{w.people}</b></div>
    {:else}
      <p class="nb-foot">Nobody new in this span.</p>
    {/each}
  </section>

  <section class="card" aria-label="People who opened the app, last 30 days">
    <div class="card-lbl">People who opened the app, last 30 days</div>
    {#if m.opens.length}
      <div class="nb-days">
        {#each m.opens as o}
          <div class="nb-day" title="{o.day}: {o.people}"><span style="height:{(o.people / peak) * 100}%"></span></div>
        {/each}
      </div>
      <p class="nb-foot">Most in a day: {peak}. Counted from 29 October 2026.</p>
    {:else}
      <p class="nb-foot">No opens counted yet. They're counted from 29 October 2026.</p>
    {/if}
  </section>

  <section class="card" aria-label="What broke for people, last 14 days">
    <div class="card-lbl">What broke for people · last 14 days</div>
    {#each m.errors as e}
      <div class="nb-err">
        <div class="nb-msg">{e.message}</div>
        <div class="nb-foot">{e.times} times · {e.people} {e.people === 1 ? 'person' : 'people'} · last {e.last.slice(0, 16).replace('T', ' ')}</div>
      </div>
    {:else}
      <p class="nb-foot">Nothing recorded.</p>
    {/each}
  </section>
{/if}

<style>
  .nb-note { color: var(--muted); }
  .nb-row { display: grid; grid-template-columns: minmax(0, 11rem) 1fr auto; gap: 10px; align-items: center; margin: 8px 0; font-size: 0.875rem; }
  .nb-step { color: var(--text); }
  .nb-bar { height: 10px; border-radius: 5px; background: var(--border); overflow: hidden; }
  .nb-bar span { display: block; height: 100%; background: var(--amber); border-radius: 5px; }
  .nb-n { font-variant-numeric: lining-nums tabular-nums; color: var(--text); white-space: nowrap; }
  .nb-pair { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: 0.875rem; color: var(--text); border-top: 1px solid var(--border); }
  .nb-pair:first-of-type { border-top: none; }
  .nb-pair b { font-variant-numeric: lining-nums tabular-nums; }
  .nb-days { display: flex; align-items: flex-end; gap: 3px; height: 64px; }
  .nb-day { flex: 1; height: 100%; display: flex; align-items: flex-end; }
  .nb-day span { display: block; width: 100%; background: var(--amber); border-radius: 2px 2px 0 0; min-height: 2px; }
  .nb-err { padding: 8px 0; border-top: 1px solid var(--border); }
  .nb-err:first-of-type { border-top: none; }
  .nb-msg { font-size: 0.8125rem; color: var(--text); word-break: break-word; }
  .nb-foot { font-size: 0.75rem; color: var(--muted); margin: 6px 0 0; line-height: 1.45; }
</style>
