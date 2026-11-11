<script lang="ts">
  import { todayYmd } from '$lib/date';
  import { userId } from '$lib/stores/user';
  import { upsertRecord } from '$lib/stores/sync';
  import { liveWeights, liveGoal, liveLog, liveGoalReason, liveTracks, liveProfile } from '$lib/stores/live';
  import { ageFrom } from '$lib/profile';
  import { projectGoal, projectGoalWithTdee, ACTIVITY_LABELS, type ActivityLevel } from '$lib/nutrition';
  import { waterTargetLitres } from '$lib/nutrition';
  import { body } from '$lib/stores/body';
  import { saveWeighIn, NeedsConfirm } from '$lib/body/weighIn';
  import MiniChart from '$lib/components/MiniChart.svelte';
  import WeightInput from '$lib/components/WeightInput.svelte';
  import { dwt, unitWord, wt as fmtW, wtShortU } from '$lib/units';

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  const _goal = liveGoal();
  const _goalReason = liveGoalReason();
  const GOAL_KG = $derived($_goal ?? 0);

  // — Weight — live from IndexedDB (see live.ts).
  const _weights = liveWeights();
  const weights = $derived([...$_weights].sort((a, b) => a.date.localeCompare(b.date)).map((r: any) => ({ date: r.date?.slice(5), weight: r.weight })));

  // The maintenance this week's target is built on (stores/body), so these
  // projections and the Food page can never disagree. When it's learned it is
  // in the log's own units — what the log leaves out, it leaves out of both.
  const learnedBurn = $derived($body.learned);
  const useLearned = $derived($body.target.basis === 'learned' && $body.target.maintenance != null);
  const learnedKcal = $derived($body.target.maintenance as number);
  let weightKg = $state<number | null>(null);
  let savingWeight = $state(false);

  let weightMsg = $state('');
  let confirmKg: number | null = null;
  async function saveWeight() {
    if (!uid || weightKg == null) return;
    savingWeight = true;
    weightMsg = '';
    const kg = weightKg;
    try {
      await saveWeighIn(uid, kg, {
        today: todayYmd(), weights: $_weights as any[], goalKg: GOAL_KG || null,
        trendKg: $body.currentKg, confirmed: confirmKg === kg,
        startKg: $_profile?.start_kg != null ? +$_profile.start_kg : null,
      });
      weightKg = null;
      confirmKg = null;
    } catch (e: any) {
      if (e instanceof NeedsConfirm) { confirmKg = kg; weightMsg = e.message; }
      else { console.error('Weight save failed:', e); weightMsg = 'Save failed: ' + (e?.message || String(e)).slice(0, 120); }
    } finally { savingWeight = false; }
  }

  // — Water — live from IndexedDB.
  const today = todayYmd();
  const _todayLog = liveLog(today);
  const waterGlasses = $derived($_todayLog?.water_glasses ?? 0);

  async function toggleWater() {
    if (!uid) return;
    const next = Math.min(waterGlasses + 1, 20);
    try { await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: next }); }
    catch (e) { console.error('Water save failed:', e); }
  }
  async function removeWater() {
    if (!uid || waterGlasses <= 0) return;
    const next = waterGlasses - 1;
    try { await upsertRecord('daily_logs', { user_id: uid, date: today, water_glasses: next }); }
    catch (e) { console.error('Water save failed:', e); }
  }

  const recentWeight = $derived(weights.length > 0 ? weights[weights.length - 1].weight : null);

  // ————————————————————————————————————————————————————————————
  // Body composition (formerly the Plan page)
  // ————————————————————————————————————————————————————————————
  // Seeded from the saved profile rather than blank. These were previously
  // local-only state, so height, age and sex had to be retyped on EVERY visit
  // and nothing outside this component could ever read them — which meant the
  // TDEE engine only worked while you happened to be filling in this form.
  const _profile = liveProfile();
  let gender = $state<'male' | 'female'>('male');
  let height = $state('');
  let neck = $state('');
  let waist = $state('');
  let hip = $state('');
  let age = $state('');
  let activityLevel = $state<ActivityLevel>('moderate');
  let profileSeeded = $state(false);

  $effect(() => {
    const p = $_profile;
    if (!p || profileSeeded) return;
    if (p.sex === 'male' || p.sex === 'female') gender = p.sex;
    if (p.height_cm) height = String(p.height_cm);
    const a = ageFrom(p.birth_year);
    if (a != null) age = String(a);
    if (p.activity_level) activityLevel = p.activity_level;
    profileSeeded = true;
  });
  let bodyFat = $state<number | null>(null);
  let lbm = $state<number | null>(null);

  function calcNavy() {
    const h = parseFloat(height);
    const n = parseFloat(neck);
    const w = parseFloat(waist);
    const hp = parseFloat(hip);
    if (!h || !n || !w || h < 100 || h > 250) return;
    if (gender === 'female' && (!hp || hp < 40)) return;
    if (n < 20 || w < 40 || (gender === 'female' && hp < 40)) return;

    let bf: number;
    if (gender === 'male') {
      const log = Math.log10(w - n) * 0.19077;
      const logH = Math.log10(h) * 0.15456;
      bf = 495 / (1.0324 - log + logH) - 450;
    } else {
      const log = Math.log10(w + hp - n) * 0.35004;
      const logH = Math.log10(h) * 0.22100;
      bf = 495 / (1.29579 - log + logH) - 450;
    }
    bodyFat = Math.max(3, Math.min(60, parseFloat(bf.toFixed(1))));
    lbm = null;
  }

  const latestWeight = $derived.by(() => {
    const sorted = [...$_weights].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.length > 0 ? sorted[sorted.length - 1].weight : null;
  });

  const waterL = $derived(waterGlasses * 0.25);
  const waterGoalL = $derived(waterTargetLitres(latestWeight));
  const dropsGoal = $derived(Math.round(waterGoalL / 0.25));

  $effect(() => {
    if (latestWeight && bodyFat) {
      lbm = parseFloat((latestWeight * (1 - bodyFat / 100)).toFixed(1));
    }
  });

  type Scenario = { label: string; bf: string; desc: string };
  const scenarios: Scenario[] = [
    { label: 'Lean', bf: '10', desc: 'Athlete — visible abs, vascular' },
    { label: 'Fit', bf: '14', desc: 'Fit — defined, lean physique' },
    { label: 'Healthy', bf: '18', desc: 'Healthy — good shape, comfortable' },
  ];
  const femaleScenarios: Scenario[] = [
    { label: 'Lean', bf: '18', desc: 'Athlete — very defined' },
    { label: 'Fit', bf: '23', desc: 'Fit — toned, athletic' },
    { label: 'Healthy', bf: '28', desc: 'Healthy — good shape' },
  ];
  const activeScenarios = $derived(gender === 'male' ? scenarios : femaleScenarios);
  const goalWeight = $derived.by(() => {
    if (!lbm || !bodyFat) return null;
    const lbmVal = lbm;
    const wt = latestWeight;
    return activeScenarios.map((s) => ({
      label: s.label, desc: s.desc,
      bf: parseInt(s.bf),
      weight: parseFloat((lbmVal / (1 - parseInt(s.bf) / 100)).toFixed(1)),
      lose: wt ? parseFloat((wt - lbmVal / (1 - parseInt(s.bf) / 100)).toFixed(1)) : 0,
    }));
  });

  const goalProjections = $derived.by(() => {
    if (!goalWeight || !latestWeight || !height || !age) return null;
    const ageNum = parseInt(age);
    if (!ageNum || ageNum < 10 || ageNum > 100) return null;
    return goalWeight.map((g) => ({
      ...g,
      ...(useLearned
        ? projectGoalWithTdee(learnedKcal, latestWeight, g.weight)
        : projectGoal(
            { weightKg: latestWeight, heightCm: parseFloat(height), age: ageNum, gender, activityLevel, bodyFatPct: bodyFat ?? null },
            g.weight
          )),
      learned: useLearned,
    }));
  });

  let settingGoal = $state<string | null>(null);

  async function setAsGoal(scenario: NonNullable<typeof goalProjections>[number]) {
    if (!uid) return;
    settingGoal = scenario.label;
    const src = (scenario as any).learned
      ? `the ~${scenario.tdee} kcal/day your own log and scale hold weight at (${learnedBurn.loggedDays} logged days)`
      : `your TDEE of ~${scenario.tdee} kcal/day`;
    const reason = `${scenario.label} (${scenario.bf}% body fat) — based on ${lbm != null ? fmtW(lbm) : '?'} lean mass measured ${todayYmd()}. `
      + `At ${src} and a moderate ~${Math.abs(scenario.dailyEnergyDeltaKcal)} kcal `
      + `${scenario.direction === 'gain' ? 'surplus' : scenario.direction === 'maintain' ? 'hold' : 'deficit'} `
      + `(target intake ~${scenario.targetIntakeKcal} kcal/day), expect roughly ${scenario.weeksToGoal} weeks to reach it.`;
    try {
      await upsertRecord('user_settings', {
        user_id: uid, goal_kg: scenario.weight, goal_reason: reason,
        // Persist the body fields too, so the profile stays the single source of
        // truth and these never have to be retyped. birth_year rather than age:
        // a stored age goes stale and silently shifts every calorie target.
        birth_year: parseInt(age) > 0 ? new Date().getFullYear() - parseInt(age) : null,
        height_cm: parseFloat(height) || null,
        sex: gender,
        activity_level: activityLevel,
        updated_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Set goal failed:', e);
    } finally { settingGoal = null; }
  }

  async function saveMeasurement() {
    if (!uid || !bodyFat) return;
    try {
      await upsertRecord('tracks', {
        id: crypto.randomUUID(),
        user_id: uid,
        date: todayYmd(),
        name: 'body_fat',
        value: bodyFat,
        unit: '%',
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('Save measurement failed:', e); }
  }

  // — Body-fat measurement history (NEW) — tracks table, name='body_fat'.
  const _tracks = liveTracks();
  const bodyFatHistory = $derived(
    [...$_tracks]
      .filter((t: any) => t.name === 'body_fat')
      .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
      .map((t: any) => ({ date: t.date, value: t.value }))
  );

</script>

<!-- Why this plan — surfaced right beside body/goal tracking -->
{#if $_goalReason}
  <div class="note-box">💡 <strong>Why this plan:</strong> {$_goalReason}</div>
{:else}
  <div class="note-box warn">⚠️ No calorie/protein plan yet — measure your body composition below and tap <strong>Set as my goal</strong> to generate a TDEE-backed target.</div>
{/if}

<div class="card">
  <div class="card-lbl">Weight</div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="bg-weight">Weight ({unitWord()})</label>
      <WeightInput id="bg-weight" bind:kg={weightKg} hint={recentWeight} class="bg-wi" />
    </div>
  </div>
  <button class="btn bp bfl" onclick={saveWeight} disabled={weightKg == null || savingWeight}>Log Weight</button>
  {#if weightMsg}<div class="bg-weight-msg">{weightMsg}</div>{/if}

</div>

<div class="card">
  <div class="card-lbl">Water</div>
  <div style="font-size:0.75rem;color:var(--muted);margin-bottom:6px">{waterL.toFixed(2)} of {waterGoalL.toFixed(1)} L today <span style="opacity:.6">· tap a drop = 250 ml</span></div>
  <div class="water-drops">
    {#each Array(dropsGoal) as _, i}
      <div class="drop {i < waterGlasses ? 'on' : ''}" onclick={i < waterGlasses ? removeWater : toggleWater} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (i < waterGlasses ? removeWater : toggleWater)(); } }} style="cursor:pointer">
        {i < waterGlasses ? '💧' : ''}
      </div>
    {/each}
  </div>
  {#if waterL >= waterGoalL}
    <div style="font-size:0.75rem;color:var(--green);margin-top:6px;text-align:center">✓ Hydration goal met!</div>
  {/if}
</div>

{#if bodyFat !== null}
  <div class="srow">
    <div class="scard"><span class="sval">{bodyFat}%</span><span class="slbl">Body Fat</span></div>
    <div class="scard"><span class="sval">{lbm != null ? fmtW(lbm) : '--'}</span><span class="slbl">Lean Mass</span></div>
    <div class="scard"><span class="sval">{latestWeight != null ? fmtW(latestWeight) : '--'}</span><span class="slbl">Weight</span></div>
  </div>
{/if}

<div class="card">
  <div class="card-lbl">Body Measurements</div>
  <div class="flex gap2" style="margin-bottom:10px">
    <button class="tab {gender === 'male' ? 'on' : ''}" onclick={() => { gender = 'male'; bodyFat = null; }}>Male</button>
    <button class="tab {gender === 'female' ? 'on' : ''}" onclick={() => { gender = 'female'; bodyFat = null; }}>Female</button>
  </div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="bg-height">Height (cm)</label>
      <input id="bg-height" type="number" bind:value={height} placeholder="180" oninput={calcNavy}>
    </div>
    <div class="f1">
      <label class="flbl" for="bg-neck">Neck (cm)</label>
      <input id="bg-neck" type="number" step="0.5" bind:value={neck} placeholder="40" oninput={calcNavy}>
    </div>
  </div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="bg-waist">Waist (cm)</label>
      <input id="bg-waist" type="number" step="0.5" bind:value={waist} placeholder="95" oninput={calcNavy}>
    </div>
    {#if gender === 'female'}
      <div class="f1">
        <label class="flbl" for="bg-hip">Hip (cm)</label>
        <input id="bg-hip" type="number" step="0.5" bind:value={hip} placeholder="100" oninput={calcNavy}>
      </div>
    {/if}
  </div>
  <div class="flex gap2" style="margin-bottom:8px">
    <div class="f1">
      <label class="flbl" for="bg-age">Age</label>
      <input id="bg-age" type="number" bind:value={age} placeholder="35">
    </div>
  </div>
  <label class="flbl" for="bg-activity">Activity level</label>
  <select id="bg-activity" bind:value={activityLevel} style="margin-bottom:8px">
    {#each Object.entries(ACTIVITY_LABELS) as [key, label]}
      <option value={key}>{label}</option>
    {/each}
  </select>
  {#if bodyFat !== null}
    <button class="btn bp bfl" onclick={saveMeasurement}>Save {bodyFat}%</button>
  {/if}
</div>

{#if bodyFatHistory.length >= 2}
  <div class="card">
    <div class="card-lbl">Body Fat History</div>
    <MiniChart data={bodyFatHistory} color="var(--blue)" />
    <div style="font-size:0.6875rem;color:var(--muted);text-align:center">{bodyFatHistory.length} measurements &middot; latest {bodyFatHistory[bodyFatHistory.length - 1].value}%</div>
  </div>
{/if}

{#if goalWeight}
  <div class="card">
    <div class="card-lbl">Goal Projections</div>
    <div style="font-size:0.75rem;color:var(--muted);margin-bottom:10px">
      Based on {lbm != null ? fmtW(lbm) : '--'} lean mass at {bodyFat}% body fat
      {#if !goalProjections}<br><span style="color:#ffd166">Enter your age above to see TDEE, calorie target, and a realistic timeline for each option.</span>{/if}
    </div>
    {#if useLearned}
      <div class="note-box" style="margin-bottom:10px">
        🧠 <strong>Learned from your data:</strong> you hold weight at ~{learnedKcal} kcal a day, as you log it
        (from {learnedBurn.loggedDays} logged days{#if learnedBurn.weightRateKgPerWeek !== 0}{' · '}{learnedBurn.weightRateKgPerWeek > 0 ? 'losing' : 'gaining'} ~{dwt(learnedBurn.weightRateKgPerWeek, 2)}/wk{/if}).
        The targets below use this number, not a textbook formula — in the same units as your log, so they self-correct to what your body's actually doing.
      </div>
    {/if}
    {#each (goalProjections ?? goalWeight) as g}
      <div class="gi" style="border-color:var(--border);flex-direction:column;align-items:stretch;gap:6px">
        <div class="flex jb ac">
          <div style="flex:1">
            <div style="font-weight:700;color:var(--text);font-size:0.875rem">{g.label} — {wtShortU(g.weight)}</div>
            <div style="font-size:0.6875rem;color:var(--muted)">{g.desc} ({g.bf}% BF)</div>
          </div>
          <div style="text-align:right">
            {#if g.lose > 0}
              <div style="font-size:0.6875rem;color:var(--red)">{dwt(g.lose)} to lose</div>
            {:else}
              <div style="font-size:0.6875rem;color:var(--green)">Achieved ✓</div>
            {/if}
          </div>
        </div>
        {#if 'tdee' in g}
          {@const gp = g as any}
          <div class="tdee-box">
            {(g as any).learned ? 'Your real burn' : 'TDEE'} ~{gp.tdee} kcal/day &middot; target intake ~{gp.targetIntakeKcal} kcal/day ({Math.abs(gp.dailyEnergyDeltaKcal)} kcal {gp.direction === 'gain' ? 'surplus' : gp.direction === 'maintain' ? 'hold' : 'deficit'})
            {#if gp.weeksToGoal > 0}<br>~{gp.weeksToGoal} weeks at this rate{/if}
          </div>
        {/if}
        <button class="btn bg_ bsm" onclick={() => setAsGoal(g as any)} disabled={settingGoal === g.label || !('tdee' in g)}>
          {settingGoal === g.label ? 'Setting…' : $_goal === g.weight ? 'Current goal ✓' : 'Set as my goal'}
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  :global(.bg-wi){text-align:center;width:100%}
  .bg-weight-msg{font-size:0.8125rem;line-height:1.45;color:var(--led-warn);text-align:center;margin-top:8px}
</style>
