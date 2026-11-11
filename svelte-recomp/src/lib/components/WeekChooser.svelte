<script lang="ts">
  // "How do you move?", asked on the Train tab the first time it opens with no
  // week saved. It used to be onboarding's second screen, and before that the
  // Train tab quietly saved a three-day gym week for everyone, so people who
  // don't lift were handed one. Nothing is saved until they choose.
  import { upsertRecords } from '$lib/stores/sync';
  import { PLAN_TEMPLATES, buildSchedule, describeSchedule } from '$lib/training';
  import { DEFAULT_SESSIONS } from '$lib/training';
  import db from '$lib/db/dexie';

  let { uid }: { uid: string } = $props();

  // Nothing pre-chosen: a default is silently somebody else's answer.
  let templateId = $state('');
  let sportName = $state('');
  let sportTime = $state('');
  let sportDays = $state<number[]>([]);
  let saving = $state(false);
  let error = $state('');

  const DOW = [{ n: 1, s: 'Mon' }, { n: 2, s: 'Tue' }, { n: 3, s: 'Wed' }, { n: 4, s: 'Thu' }, { n: 5, s: 'Fri' }, { n: 6, s: 'Sat' }, { n: 0, s: 'Sun' }];
  const tpl = $derived(PLAN_TEMPLATES.find((t) => t.id === templateId) ?? null);
  const preview = $derived(tpl ? buildSchedule({ templateId, sportName, sportDays, sportTime }) : []);
  const ready = $derived(!!tpl && (!tpl.usesSport || sportDays.length > 0));
  const toggle = (n: number) => (sportDays = sportDays.includes(n) ? sportDays.filter((d) => d !== n) : [...sportDays, n]);

  async function save() {
    if (!uid || !ready || saving) return;
    saving = true;
    error = '';
    try {
      // Never over someone's own week, whatever raced us here.
      if (await db.table('workout_schedule').where('user_id').equals(uid).count()) return;
      const at = new Date().toISOString();
      // Schedule first: if the sessions then fail, Train falls back to these
      // same built-in sessions.
      await upsertRecords('workout_schedule', preview.map((d) => ({ user_id: uid, ...d, updated_at: at })));
      if (tpl!.liftDays > 0) await upsertRecords('workout_sessions_custom', DEFAULT_SESSIONS.map((s) => ({ user_id: uid, ...s, updated_at: at })));
    } catch (e: any) {
      error = 'Could not save your week: ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      saving = false;
    }
  }
</script>

<section class="card wc" aria-labelledby="wc-h">
  <h2 class="wc-h" id="wc-h">How do you move?</h2>
  <p class="wc-p">Pick a week to start from. You can change any day afterwards.</p>
  <div class="wc-tpls">
    {#each PLAN_TEMPLATES as t}
      <button class="wc-tpl" class:on={templateId === t.id} onclick={() => (templateId = t.id)}>
        <b>{t.name}</b><span>{t.blurb}</span>
      </button>
    {/each}
  </div>
  {#if tpl?.usesSport}
    <label class="flbl" for="wc-sport">What sport?</label>
    <input id="wc-sport" bind:value={sportName} placeholder="Football, climbing, tennis…">
    <div class="flbl" id="wc-days-l">Which days?</div>
    <div class="wc-days" role="group" aria-labelledby="wc-days-l">
      {#each DOW as d}<button class="wc-day" class:on={sportDays.includes(d.n)} onclick={() => toggle(d.n)}>{d.s}</button>{/each}
    </div>
    <label class="flbl" for="wc-time">Time <span class="wc-opt">(optional)</span></label>
    <input id="wc-time" bind:value={sportTime} placeholder="7–9 pm">
  {/if}
  {#if tpl}<div class="wc-sum">{describeSchedule(preview)}</div>{/if}
  <button class="btn bp bfl" onclick={save} disabled={!ready || saving}>{saving ? 'Saving…' : 'Use this week'}</button>
  {#if error}<div class="wc-err">{error}</div>{/if}
</section>

<style>
  .wc{padding:16px}
  .wc-h{font-family:var(--font-display);font-size:1.5rem;font-weight:700;margin:0 0 4px;color:var(--text)}
  .wc-p{font-size:0.8125rem;color:var(--muted);margin:0 0 12px}
  .wc-tpls{display:grid;gap:8px;margin-bottom:6px}
  .wc-tpl{display:flex;flex-direction:column;gap:3px;text-align:left;background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:11px 12px;cursor:pointer;font-family:inherit;color:var(--text)}
  .wc-tpl b{font-size:0.875rem}
  .wc-tpl span{font-size:0.75rem;color:var(--muted);line-height:1.45}
  .wc-tpl.on{border-color:var(--amber);background:var(--ab)}
  .wc-days{display:flex;gap:5px;flex-wrap:wrap}
  .wc-day{flex:1;min-width:40px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 2px;color:var(--muted);font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit}
  .wc-day.on{border-color:var(--amber);color:var(--text)}
  .wc-opt{font-weight:400;text-transform:none;letter-spacing:0}
  .wc-sum{margin:12px 0;padding:9px 11px;background:var(--bg3);border-radius:10px;font-size:0.8125rem;color:var(--text);text-align:center}
  .wc-err{font-size:0.8125rem;color:var(--led-bad);margin-top:8px;text-align:center}
</style>
