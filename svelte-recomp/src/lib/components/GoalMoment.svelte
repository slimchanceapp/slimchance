<script lang="ts">
  // The goal, reached and held for three days. Most diets stop helping here,
  // and it's where most weight comes back, so the app changes its job instead
  // of throwing confetti: keeping it, with the budget at maintenance and the
  // ceiling a kilo above. It asks rather than switching by itself, because
  // some people want to go a little lower.
  import { body, line } from '$lib/stores/body';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';
  import { todayDate } from '$lib/stores/refresh';
  import { saveLine } from '$lib/commitments';
  import { LINE_MARGIN_KG } from '$lib/body';
  import { haptic } from '$lib/haptics';
  import { wtShortU } from '$lib/units';

  let { onAimLower }: { onAimLower: () => void } = $props();
  let saving = $state(false);
  let error = $state('');

  const goal = $derived($body.goalKg);
  const ceiling = $derived(goal != null ? Math.round((goal + LINE_MARGIN_KG) * 10) / 10 : null);
  const maintenance = $derived($body.target.maintenance);

  async function keep() {
    if (!$userId || goal == null || saving) return;
    saving = true; error = '';
    try {
      await upsertRecord('user_settings', { user_id: $userId, keep_since: $todayDate, updated_at: new Date().toISOString() });
      // A ceiling a kilo over the goal, unless theirs already sits lower.
      if (!$line || $line.misdrawn || $line.kg > ceiling!) await saveLine(ceiling, $todayDate);
      haptic('success');
    } catch (e: any) {
      error = 'Could not save: ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      saving = false;
    }
  }
</script>

{#if $body.goalHeld && goal != null}
  <section class="gm" aria-label="Goal reached">
    <h2 class="gm-h">You're there.</h2>
    <p class="gm-p">
      Your trend has held at or under {wtShortU(goal)} for three days. This is where most diets stop helping, and where
      most weight comes back, so Slim Chance's job changes now: keeping it.
    </p>
    <ul class="gm-l">
      <li>Your budget becomes what you maintain on{#if maintenance}, about <b>{maintenance.toLocaleString()} kcal a day</b> as you log it{/if}.</li>
      <li>Your ceiling sits at <b>{wtShortU(ceiling)}</b>. Stay under it and nothing changes; go over and your plan for that day comes back, with one gentle step down until you're under again.</li>
      <li>Today shows how many days the trend stayed inside your range. A day over costs one day, never the whole count.</li>
    </ul>
    <button class="btn bp bfl" onclick={keep} disabled={saving}>{saving ? 'Saving…' : 'Keep it here'}</button>
    <button class="gm-lower" onclick={onAimLower} disabled={saving}>Aim a little lower instead</button>
    {#if error}<div class="gm-err">{error}</div>{/if}
  </section>
{/if}

<style>
  .gm{background:color-mix(in srgb,var(--led-good) 8%,var(--bg2));border:1px solid var(--border2);border-radius:var(--r-lg);padding:18px 16px 14px;margin-bottom:14px}
  .gm-h{font-family:var(--font-display);font-size:2rem;font-weight:700;color:var(--text);margin:0 0 8px}
  .gm-p{font-size:0.9375rem;line-height:1.5;color:var(--text);margin:0 0 10px}
  .gm-l{margin:0 0 14px;padding-left:1.1rem;font-size:0.875rem;line-height:1.5;color:var(--text)}
  .gm-l li{margin:6px 0}
  .gm-lower{display:block;width:100%;margin-top:10px;background:none;border:none;font:inherit;font-size:0.875rem;font-weight:700;color:var(--muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
  .gm-err{font-size:0.8125rem;color:var(--led-bad);margin-top:8px;text-align:center}
</style>
