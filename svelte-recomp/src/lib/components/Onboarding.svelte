<script lang="ts">
  // First-run setup: three short screens, then the app.
  //
  // It used to be seven, built around the gym (a weekly template, a sport,
  // the watch brand) before the person had seen a single number of their
  // own, and seven in eight of the people who ever logged anything left in
  // their first four entries. Now it asks only what the first number needs:
  // where you are and where you're going; the four things the starting
  // budget's formula needs; and, if you like, one plan for the moment that
  // tends to go wrong. Training, the watch and reminders are offered where
  // they're used (the Train tab, Settings), not here.
  //
  // Nothing is guessed silently: suggestions are shown as suggestions, and
  // everything can be changed later in Body & Goals.
  import { userId } from '$lib/stores/user';
  import { upsertRecord } from '$lib/stores/sync';
  import { liveProfile } from '$lib/stores/live';
  import db from '$lib/db/dexie';
  import { todayYmd } from '$lib/date';
  import { ageFrom, suggestGoalKg, proteinTargetG, ftInToCm, cmToFtIn, type Sex, type ActivityLevel } from '$lib/profile';
  import { calcTdee, projectGoalWithTdee, projectionSummary } from '$lib/tdee';
  import { notify } from '$lib/stores/notices';
  import { supabase } from '$lib/db/client';
  import { CUES, cleanPlans, type PlanCue } from '$lib/plans';
  import { saveWhy, savePlans, saveLine } from '$lib/commitments';
  import { LINE_MARGIN_KG } from '$lib/line';
  import { saveMoments } from '$lib/stores/moments';
  import { isIOSApp, isNativeApp } from '$lib/platform';
  import { CALENDAR_KEY, canPush, localTz } from '$lib/reminder';
  import { noteEvent } from '$lib/events';
  import WeightInput from './WeightInput.svelte';
  import { dwt, roundIn, type Units, wtShortU } from '$lib/units';
  import { useUnits } from '$lib/stores/units';

  let { onDone }: { onDone: () => void } = $props();

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  const STEPS = 3;
  let step = $state(0);
  let saving = $state(false);
  let error = $state('');

  // An EXISTING user can land here with a partial profile (height and sex
  // weren't saved by early versions). They must not be treated as new: answers
  // are prefilled, nothing of theirs is overwritten, and the copy says
  // "finish" rather than "welcome". Being dropped into first-run setup after
  // logging in reads as "my data is gone", which is what it must never feel like.
  const _existing = liveProfile();
  const returning = $derived(!!$_existing && ($_existing.goal_kg != null || $_existing.onboarded_at != null));
  // Where new people stop: each screen reached, then the finish (lib/events).
  // Someone coming back to fill a gap isn't new, so isn't counted.
  $effect(() => {
    if (!returning) noteEvent(step === 0 ? 'setup_1' : step === 1 ? 'setup_2' : 'setup_3');
  });
  let prefilled = $state(false);

  // Pounds in the US, stone in the UK, kilograms everywhere else, until they say.
  const lang = typeof navigator !== 'undefined' ? navigator.language : '';
  const firstUnits: Units = /^en-(US|LR|MM)$/i.test(lang) ? 'imperial' : /^en-GB$/i.test(lang) ? 'stone' : 'metric';
  let units = $state<Units>(firstUnits);
  // The weight boxes read the unit when they appear: it's set before they're
  // re-drawn (the {#key} below), never after.
  function pickUnits(u: Units) { useUnits(u); units = u; }
  useUnits(firstUnits);

  // — Screen 1: where you are, where you're going —
  let weightKg = $state<number | null>(null);
  let goalKg = $state<number | null>(null);
  let heightCm = $state('');
  let heightFt = $state('');
  let heightIn = $state('');

  // — Screen 2: the starting budget —
  let sex = $state<Sex | ''>('');
  let birthYear = $state('');
  let activityLevel = $state<ActivityLevel | ''>('');
  const ACTIVITY: Array<{ v: ActivityLevel; l: string; s: string }> = [
    { v: 'sedentary', l: 'Mostly sitting', s: 'A desk, the car, the sofa' },
    { v: 'light', l: 'On my feet a fair bit', s: 'Walking, chores, the odd workout' },
    { v: 'moderate', l: 'Active most days', s: 'Exercise three to five days a week' },
    { v: 'active', l: 'Very active', s: 'Hard training, or a physical job' },
  ];

  // — Screen 3: one plan, and the moments (optional) —
  let whyInput = $state('');
  let planCue = $state<PlanCue | ''>('');
  let planText = $state('');
  const HARD_MOMENTS: PlanCue[] = ['weekend', 'friday', 'evening'];
  // The suggestion is a hint, never pre-typed words: a plan only works in the
  // user's own words.
  function pickCue(c: PlanCue) {
    planCue = planCue === c ? '' : c;
    planText = planCue ? cleanPlans($_existing?.plans)[c] ?? '' : '';
  }
  const cueInfo = $derived(planCue ? CUES.find((x) => x.cue === planCue)! : null);
  // The unlock moments are Android's; everywhere else, a plain morning reminder.
  // Both phone apps carry the two quiet moments; a browser gets the weigh-in reminder.
  const native = isNativeApp();
  const iphoneApp = isIOSApp();
  const pushable = canPush();
  let wantMoments = $state(true);
  let wantWeighIn = $state(true);
  let weighInTime = $state('07:00');

  $effect(() => {
    const p = $_existing;
    if (!p || prefilled) return;
    if (p.units === 'metric' || p.units === 'imperial' || p.units === 'stone') pickUnits(p.units);
    if (p.sex === 'male' || p.sex === 'female') sex = p.sex;
    if (p.birth_year) birthYear = String(p.birth_year);
    if (p.height_cm) {
      heightCm = String(p.height_cm);
      const { ft, inch } = cmToFtIn(Number(p.height_cm));
      heightFt = String(ft); heightIn = String(inch);
    }
    if (p.start_kg) weightKg = +p.start_kg;
    if (p.goal_kg) goalKg = +p.goal_kg;
    if (p.activity_level) activityLevel = p.activity_level;
    if (p.why) whyInput = p.why;
    prefilled = true;
  });

  const currentYear = new Date().getFullYear();
  const feet = $derived(units !== 'metric');
  const heightInCm = $derived.by(() => {
    if (feet) {
      const ft = parseFloat(heightFt), inch = parseFloat(heightIn) || 0;
      return ft > 0 ? Math.round(ftInToCm(ft, inch) * 10) / 10 : null;
    }
    const cm = parseFloat(heightCm);
    return cm >= 100 && cm <= 250 ? cm : null;
  });
  const born = $derived(parseInt(birthYear, 10));
  const age = $derived(ageFrom(born));
  // A goal at today's weight means keeping it off (after a diet, a medicine,
  // or a loss years ago): the app holds instead of cutting.
  const keeping = $derived(weightKg != null && goalKg != null && Math.abs(weightKg - goalKg) < 0.5);
  // Slim Chance is for adults: weight loss under 18 belongs with a doctor, and the
  // AI services it uses are for adults only.
  const tooYoung = $derived(!!born && born > currentYear - 18 && born <= currentYear);
  const suggestedGoal = $derived.by(() => {
    const g = suggestGoalKg(heightInCm);
    return g ? roundIn(g, units === 'stone' ? 0.5 : 1, units === 'metric' ? 'kg' : units === 'imperial' ? 'lb' : 'st') : null;
  });

  const canNext = $derived.by(() => {
    if (step === 0) return weightKg != null && goalKg != null && heightInCm != null;
    if (step === 1) return sex !== '' && age != null && !tooYoung && activityLevel !== '';
    return true;
  });

  // What the numbers buy them: the reason to answer at all.
  const preview = $derived.by(() => {
    if (!heightInCm || !weightKg || !age || !sex || !goalKg || !activityLevel) return null;
    const tdee = calcTdee({ weightKg, heightCm: heightInCm, age, gender: sex, activityLevel });
    const proj = projectGoalWithTdee(tdee, weightKg, goalKg);
    return { tdee, proj, protein: proteinTargetG(goalKg, weightKg) };
  });
  const weeksPhrase = $derived(preview && preview.proj.weeksToGoal > 0
    ? `about ${preview.proj.weeksToGoal} week${preview.proj.weeksToGoal === 1 ? '' : 's'}` : null);

  async function finish() {
    if (!uid || !canNext || saving) return;
    saving = true;
    error = '';
    try {
      const p = preview;
      // Keep an existing goal narrative when the goal itself hasn't changed: it
      // may carry a body-composition rationale this flow cannot reproduce.
      const goalUnchanged = $_existing?.goal_kg != null && Number($_existing.goal_kg) === goalKg;
      const reason = goalUnchanged && $_existing?.goal_reason ? $_existing.goal_reason : p ? projectionSummary(p.proj, p.protein) : null;

      await upsertRecord('user_settings', {
        user_id: uid,
        sex,
        birth_year: born,
        height_cm: heightInCm,
        activity_level: activityLevel,
        units,
        // Never move the original starting weight: it anchors "how far you've
        // come", and resetting it to today's weight erases the whole journey.
        start_kg: $_existing?.start_kg ?? weightKg,
        goal_kg: goalKg,
        goal_reason: reason,
        ...(keeping && !$_existing?.keep_since ? { keep_since: todayYmd() } : {}),
        onboarded_at: $_existing?.onboarded_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (!returning) noteEvent('setup_done');

      // Today's weight is the first dot on the trend, unless today has one.
      if (weightKg) {
        const existingToday = await db.table('weights').where('[user_id+date]').equals([uid, todayYmd()]).count().catch(() => 0);
        if (!existingToday) {
          await upsertRecord('weights', { user_id: uid, date: todayYmd(), weight: weightKg, created_at: new Date().toISOString() });
        }
      }

      // Optional, and never fatal: the profile above is what the app needs.
      try {
        if (whyInput.trim() && whyInput.trim() !== ($_existing?.why ?? '').trim()) await saveWhy(whyInput);
        if (planCue && planText.trim()) await savePlans({ ...cleanPlans($_existing?.plans), [planCue]: planText.trim() });
        if (keeping && weightKg && !$_existing?.line) await saveLine(weightKg + LINE_MARGIN_KG, todayYmd());
        if (native) await saveMoments({ on: wantMoments, after: '06:00', hold: wantMoments });
        else if (wantWeighIn) {
          // The tap on Start is the gesture browsers want before asking. A
          // reminder is stored only when this browser can actually receive it:
          // setup used to store one either way, and no stranger ever got one.
          const { subscribeWebPush } = await import('$lib/push');
          if (pushable && (await subscribeWebPush(uid))) {
            // One weigh-in reminder per user, ever (a fixed auto_key), so finishing
            // setup twice can't stack two. At the person's own time, in their zone.
            const { error: alarmErr } = await supabase.from('alarms').upsert({
              id: crypto.randomUUID(), user_id: uid, auto_key: 'auto-weigh-in',
              title: '⚖️ Morning weigh-in',
              message: 'Before food or drink. Same conditions every day make the numbers comparable.',
              time: weighInTime, tz: localTz(), days: [0, 1, 2, 3, 4, 5, 6], enabled: true,
            }, { onConflict: 'user_id,auto_key' });
            if (alarmErr) throw alarmErr;
            noteEvent('reminder_push');
          } else {
            // Safari on an iPhone, or notifications refused: Today offers the
            // same reminder in their own calendar instead.
            try { localStorage.setItem(CALENDAR_KEY, weighInTime); } catch { /* storage disabled */ }
            noteEvent('reminder_failed');
          }
        }
      } catch (e: any) {
        notify('Setup', `Your profile is saved, but your plan or reminder couldn't be: ${e?.message || e}`, { level: 'warn' });
      }
      onDone();
    } catch (e: any) {
      error = e?.message || String(e);
      notify('Setup', `Could not save your profile: ${error}`);
    } finally {
      saving = false;
    }
  }
</script>

<div class="ob">
  <div class="ob-progress" aria-label={`Step ${step + 1} of ${STEPS}`}>
    {#each Array(STEPS) as _, s}<div class="ob-dot" class:on={s <= step}></div>{/each}
  </div>

  {#if step === 0}
    {#if returning}
      <h2 class="ob-h">Welcome back: just finishing your profile</h2>
      <div class="ob-reassure">
        <strong>Nothing has been lost.</strong> Your weigh-ins, food and training are all still here.
        Older versions didn't save a few of these answers, and the maths needs them.
      </div>
    {:else}
      <h2 class="ob-h">Where you are, and where you're going</h2>
      <p class="ob-p">Three short screens. Today's weight is the first dot on your trend.</p>
    {/if}

    <div class="flbl" id="ob-units-l">Weigh in</div>
    <div class="tab-row" role="group" aria-labelledby="ob-units-l">
      <button class="tab" class:on={units === 'metric'} onclick={() => pickUnits('metric')}>kg</button>
      <button class="tab" class:on={units === 'imperial'} onclick={() => pickUnits('imperial')}>lb</button>
      <button class="tab" class:on={units === 'stone'} onclick={() => pickUnits('stone')}>st</button>
    </div>

    {#key units}
      <label class="flbl" for="ob-weight">Today's weight</label>
      <WeightInput id="ob-weight" bind:kg={weightKg} label="Today's weight" class="ob-wi" />

      <label class="flbl" for="ob-height">Height</label>
      {#if feet}
        <div class="ob-row2">
          <input id="ob-height" type="number" inputmode="numeric" bind:value={heightFt} placeholder="ft" aria-label="Height, feet">
          <input type="number" inputmode="numeric" bind:value={heightIn} placeholder="in" aria-label="Height, inches">
        </div>
      {:else}
        <input id="ob-height" type="number" inputmode="decimal" bind:value={heightCm} placeholder="cm, e.g. 175">
      {/if}

      <label class="flbl" for="ob-goal">Goal weight</label>
      <WeightInput id="ob-goal" bind:kg={goalKg} label="Goal weight" class="ob-wi" />
      {#if suggestedGoal && goalKg == null}
        <button class="ob-suggest" onclick={() => (goalKg = suggestedGoal)}>
          Not sure? Start with {wtShortU(suggestedGoal)}, the top of the healthy BMI range for your height. You can change it any time.
        </button>
      {/if}
      {#if weightKg != null && goalKg != null && Math.abs(weightKg - goalKg) >= 0.5}
        <div class="ob-ok">{dwt(weightKg - goalKg)} to {weightKg > goalKg ? 'lose' : 'gain'}.</div>
      {:else if keeping}
        <div class="ob-ok">Keeping it where it is: your budget will be what you maintain on, with a ceiling {dwt(LINE_MARGIN_KG)} above.</div>
      {/if}
      {#if weightKg != null && !keeping}
        <button class="ob-keep" onclick={() => (goalKg = weightKg)}>Already lost the weight? Keep it where it is</button>
      {/if}
    {/key}

  {:else if step === 1}
    <h2 class="ob-h">Your starting budget</h2>
    <p class="ob-p">
      A formula needs these four to guess your calories for the first two weeks. After that, Slim Chance sets
      your budget from your own scale and your own log, and the guess stops mattering.
    </p>

    <div class="flbl" id="ob-sex-l">Sex</div>
    <div class="ob-hint">The calorie formula is different for men and women. It's used for the maths, nothing else.</div>
    <div class="tab-row" role="group" aria-labelledby="ob-sex-l">
      <button class="tab" class:on={sex === 'male'} onclick={() => (sex = 'male')}>Male</button>
      <button class="tab" class:on={sex === 'female'} onclick={() => (sex = 'female')}>Female</button>
    </div>

    <label class="flbl" for="ob-year">Year of birth</label>
    <input id="ob-year" type="number" inputmode="numeric" bind:value={birthYear} placeholder={String(currentYear - 35)} min="1900" max={currentYear - 18}>
    {#if tooYoung}
      <div class="ob-err">Slim Chance is for adults. If you're under 18 and worried about your weight, talk to a doctor or a parent first; they can help in ways an app can't.</div>
    {:else if birthYear && age == null}
      <div class="ob-err">That doesn't look like a year of birth.</div>
    {/if}

    <div class="flbl" id="ob-act-l">On a normal day you're…</div>
    <div class="ob-acts" role="group" aria-labelledby="ob-act-l">
      {#each ACTIVITY as a}
        <button class="ob-act" class:on={activityLevel === a.v} onclick={() => (activityLevel = a.v)}>
          <b>{a.l}</b><span>{a.s}</span>
        </button>
      {/each}
    </div>

    {#if preview}
      <div class="ob-preview">
        <div class="ob-preview-h">To start with</div>
        <div class="ob-pv"><span>Budget</span><strong>{preview.proj.targetIntakeKcal.toLocaleString()} kcal a day</strong></div>
        <div class="ob-pv"><span>Protein</span><strong>{preview.protein} g a day</strong></div>
        {#if weeksPhrase}<div class="ob-pv"><span>To your goal</span><strong>{weeksPhrase}</strong></div>{/if}
        <div class="ob-preview-f">A guess from a formula, replaced by what your own results show.</div>
      </div>
    {/if}

  {:else}
    <h2 class="ob-h">One plan for the hard moment</h2>
    <p class="ob-p">
      Optional. Diets rarely break on a Tuesday lunchtime. Decide now what you'll do at the moment that tends to
      go wrong, and Slim Chance hands it back to you then.
    </p>

    <div class="ob-stops" role="group" aria-label="The moment">
      {#each HARD_MOMENTS as c}
        <button type="button" class="ob-stop" class:on={planCue === c} onclick={() => pickCue(c)}>{CUES.find((x) => x.cue === c)?.label}</button>
      {/each}
    </div>
    {#if cueInfo}
      <label class="flbl" for="ob-plan">{cueInfo.when}, I'll…</label>
      <textarea id="ob-plan" rows="2" bind:value={planText} placeholder={cueInfo.suggestion}></textarea>
      {#if !planText}<button type="button" class="ob-use" onclick={() => (planText = cueInfo.suggestion)}>Use this one</button>{/if}
      <div class="ob-hint">Plans this specific, made ahead, clearly raise the odds you follow through.</div>
    {/if}

    <label class="flbl ob-gap" for="ob-why">Why you're doing this <span class="ob-opt">(only you see it)</span></label>
    <textarea id="ob-why" rows="2" bind:value={whyInput} placeholder="In your own words."></textarea>

    {#if native}
      <button class="ob-alarm" class:on={wantMoments} onclick={() => (wantMoments = !wantMoments)}>
        <span class="f1">
          <span class="ob-alarm-n">Two quiet notifications a day</span>
          <span class="ob-alarm-s">
            {#if iphoneApp}
              From 6:00, waiting on your lock screen: the day ahead. From 19:30 (17:00 Friday to Sunday): your
              plan for the evening. No sound, and the screen stays dark: never an alarm.
            {:else}
              The first time you unlock after 6:00: the day ahead, and a box to log your weight. The first time
              after 19:30 (17:00 Friday to Sunday): your plan for the evening. No sound, never an alarm.
            {/if}
          </span>
        </span>
        <span class="ob-alarm-x">{wantMoments ? '✓' : ''}</span>
      </button>
    {:else}
      <button class="ob-alarm" class:on={wantWeighIn} onclick={() => (wantWeighIn = !wantWeighIn)}>
        <span class="f1">
          <span class="ob-alarm-n">A morning weigh-in reminder</span>
          <span class="ob-alarm-s">The trend needs a run of mornings; one reading says nothing.{#if !pushable} This browser can't send notifications, so it comes as a daily event in your own calendar.{/if}</span>
        </span>
        <span class="ob-alarm-x">{wantWeighIn ? '✓' : ''}</span>
      </button>
      {#if wantWeighIn}
        <label class="flbl" for="ob-weigh-time">At</label>
        <input id="ob-weigh-time" type="time" bind:value={weighInTime}>
      {/if}
    {/if}
  {/if}

  {#if error}<div class="ob-err">{error}</div>{/if}

  <div class="ob-nav">
    {#if step > 0}<button class="btn bg_ bfl" onclick={() => step--}>Back</button>{/if}
    {#if step < STEPS - 1}
      <button class="btn bp bfl" disabled={!canNext} onclick={() => step++}>Continue</button>
    {:else}
      <button class="btn bp bfl" disabled={!canNext || saving} onclick={finish}>
        {saving ? 'Saving…' : returning ? 'Save and continue' : planCue && planText.trim() ? 'Start' : 'Skip and start'}
      </button>
    {/if}
  </div>
</div>

<style>
  .ob{padding:24px 20px 40px;max-width:460px;margin:0 auto}
  .ob-gap{margin-top:18px}
  .ob .flbl{margin-top:18px}
  .ob-stops{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px}
  .ob-stop{font-size:0.875rem;font-weight:700;color:var(--text);cursor:pointer;font-family:inherit;
    background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r-sm);padding:9px 14px}
  .ob-stop.on{border-color:var(--amber);background:var(--ab)}
  .ob-use{background:none;border:none;padding:6px 0 0;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--text);
    text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border2);cursor:pointer}
  .ob-progress{display:flex;gap:6px;margin-bottom:24px}
  .ob-dot{flex:1;height:3px;border-radius:2px;background:var(--bg3);transition:background .3s var(--ease)}
  .ob-dot.on{background:var(--amber)}
  .ob-h{font-family:var(--font-display);font-size:1.75rem;font-weight:700;color:var(--text);margin:0 0 8px;line-height:1.15}
  .ob-p{font-size:0.875rem;color:var(--muted);line-height:1.55;margin:0 0 18px}
  .ob-hint{font-size:0.75rem;color:var(--muted);line-height:1.45;margin:-2px 0 6px}
  .ob-opt{color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0}
  .ob-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .ob-err{font-size:0.8125rem;color:var(--led-bad);margin-top:6px;line-height:1.45}
  .ob-ok{font-size:0.8125rem;color:var(--muted);margin-top:8px}
  :global(.ob-wi){width:100%;font-size:1.125rem;font-weight:700;text-align:center}
  .ob-keep{display:block;background:none;border:none;padding:10px 0 0;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--amber);cursor:pointer;text-align:left}
  .ob-suggest{display:block;width:100%;text-align:left;margin-top:8px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);font-size:0.8125rem;line-height:1.45;cursor:pointer;font-family:inherit}
  .ob-acts{display:grid;gap:6px}
  .ob-act{display:flex;flex-direction:column;gap:2px;text-align:left;background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;color:var(--text)}
  .ob-act b{font-size:0.875rem}
  .ob-act span{font-size:0.75rem;color:var(--muted)}
  .ob-act.on{border-color:var(--amber);background:var(--ab)}
  .ob-preview{margin-top:18px;background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:14px}
  .ob-preview-h{font-family:var(--font-label);font-size:0.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .ob-pv{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:0.875rem;color:var(--muted)}
  .ob-pv strong{color:var(--text);font-family:var(--font-display);font-size:1.125rem;font-variant-numeric:lining-nums tabular-nums}
  .ob-preview-f{font-size:0.75rem;color:var(--muted);line-height:1.45;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
  .ob-reassure{background:color-mix(in srgb,var(--green) 8%,var(--bg3));border-radius:8px;padding:11px 12px;font-size:0.8125rem;color:var(--text);line-height:1.55;margin-bottom:18px}
  .ob-alarm{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;margin-top:18px;background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:12px;cursor:pointer;font-family:inherit;color:var(--text)}
  .ob-alarm.on{border-color:var(--amber)}
  .ob-alarm-n{display:block;font-size:0.875rem;font-weight:700;margin-bottom:3px}
  .ob-alarm-s{display:block;font-size:0.75rem;color:var(--muted);line-height:1.45}
  .ob-alarm-x{width:22px;height:22px;flex-shrink:0;border-radius:6px;border:1px solid var(--border2);display:grid;place-items:center;font-weight:800;color:var(--amber)}
  .ob-nav{display:flex;gap:8px;margin-top:24px}
</style>
