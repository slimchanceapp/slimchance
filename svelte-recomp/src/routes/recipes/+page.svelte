<script lang="ts">
  import { userId } from '$lib/stores/user';
  import CoachPlan from '$lib/components/CoachPlan.svelte';
  import { upsertRecord, syncStatus } from '$lib/stores/sync';
  import { liveFoodLogs, liveGoalReason, liveCustomRecipes } from '$lib/stores/live';
  import { goalSummary, goalDirection } from '$lib/coach';
  import { body } from '$lib/stores/body';
  import Modal from '$lib/components/Modal.svelte';
  import MiniChart from '$lib/components/MiniChart.svelte';
  import { swipeActions } from '$lib/actions/swipe';
  import FoodLogger from '$lib/components/FoodLogger.svelte';
  import NutritionInsights from '$lib/components/NutritionInsights.svelte';
  import { cleanName, sourceOf, type NewFood } from '$lib/food';
  import { saveFoods } from '$lib/foodLog';
  import { evaluateFood } from '$lib/foodCoach';
  import { speak } from '$lib/stores/toast';
  import { haptic } from '$lib/haptics';
  import db from '$lib/db/dexie';
  import { todayDate } from '$lib/stores/refresh';
  import PageHero from '$lib/components/PageHero.svelte';

  // The modal renders both built-in and generated recipes, so it works on a
  // normalised shape rather than the static Recipe type specifically.
  type ViewRecipe = {
    id: string | number; name: string; e: string; t: number;
    k: number; p: number; c: number; f: number;
    desc: string; ing: Array<{ n: string; a: string; cat: string }>;
    prep: string[]; steps: string[]; instantPot: string[];
    kid?: boolean; custom?: boolean; coachNote?: string; batch?: number;
  };
  let selected = $state<ViewRecipe | null>(null);
  let method: 'stovetop' | 'instantPot' = $state('stovetop');

  const catOrder = ['protein', 'veg', 'dairy', 'dry'] as const;
  const catLabel: Record<string, string> = { protein: 'Protein', veg: 'Vegetables', dairy: 'Dairy', dry: 'Pantry' };

  const today = new Date();

  let uid = $state('');
  userId.subscribe((v) => { if (v) uid = v; });

  // — Nutrition / food log — real macro tracking (protein/carbs/fat), not
  // just the single kcal number on the Today page. Protein target is the
  // evidence-based ~1.8 g per kg of GOAL bodyweight (not total bodyweight):
  // for someone carrying significant fat mass, scaling to total weight
  // overestimates need. 1.8 g/kg of goal weight converges with both the
  // g/kg-lean-mass approach (Helms 2014) and clinical adjusted-body-weight,
  // and sits mid-range of the 1.6–2.4 g/kg deficit guideline (Morton 2018
  // saturation ~1.6; ISSN 2017) — enough to protect muscle, without the
  // protein-industry-inflated 2.2–3.1 numbers that apply to lean athletes.
  const _foodLogs = liveFoodLogs();
  // Re-derived on the clock tick: a page left open past midnight must file the
  // next entry under the new day, not the day it was opened.
  const todayStr = $derived($todayDate);

  // Weight, targets and the learned burn come from stores/body — the same
  // numbers Today, Progress and the weekly check-in show.
  const currentWeightKg = $derived($body.currentKg);
  const goalKg = $derived($body.goalKg);
  const proteinTargetG = $derived($body.proteinTargetG);
  const liveTarget = $derived($body.target);
  const latestBodyFat = $derived($body.bodyFatPct);
  const _goalReason = liveGoalReason();

  const todayFoods = $derived(
    $_foodLogs
      .filter((f: any) => f.date === todayStr)
      .sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''))
  );

  const todayTotals = $derived(
    todayFoods.reduce(
      (t: any, f: any) => ({
        kcal: t.kcal + (f.kcal || 0),
        protein: t.protein + (f.protein_g || 0),
        carbs: t.carbs + (f.carbs_g || 0),
        fat: t.fat + (f.fat_g || 0),
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    )
  );

  // — Plan target banner — surface WHY the plan is what it is, right where
  // food is logged. goal_reason (set on the Plan flow) already embeds the
  // TDEE, deficit and calorie target narrative; the protein target is the
  // ~2g/kg recomp guideline. Shown together so the daily log is always
  // read against the plan, not in isolation.

  // — Food history — past days grouped, newest first, each with its daily
  // totals. All dates already live in liveFoodLogs (IndexedDB); the page
  // previously only ever rendered today, so this is purely a display gap.
  const historyByDay = $derived.by(() => {
    const byDate = new Map<string, any[]>();
    for (const f of $_foodLogs) {
      if (f.date === todayStr) continue; // today shown separately above
      if (!byDate.has(f.date)) byDate.set(f.date, []);
      byDate.get(f.date)!.push(f);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, foods]) => ({
        date,
        foods: foods.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')),
        totals: foods.reduce(
          (t, f) => ({
            kcal: t.kcal + (f.kcal || 0),
            protein: t.protein + (f.protein_g || 0),
            carbs: t.carbs + (f.carbs_g || 0),
            fat: t.fat + (f.fat_g || 0),
          }),
          { kcal: 0, protein: 0, carbs: 0, fat: 0 }
        ),
      }));
  });

  // — Calorie/protein trend over time — daily kcal totals across ALL logged
  // days (incl. today), oldest→newest, for the MiniChart. What's the point
  // of tracking without seeing the trend.
  const kcalTrend = $derived.by(() => {
    const byDate = new Map<string, number>();
    for (const f of $_foodLogs) byDate.set(f.date, (byDate.get(f.date) || 0) + (f.kcal || 0));
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, kcal]) => ({ date, value: Math.round(kcal) }));
  });
  const proteinTrend = $derived.by(() => {
    const byDate = new Map<string, number>();
    for (const f of $_foodLogs) byDate.set(f.date, (byDate.get(f.date) || 0) + (f.protein_g || 0));
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, p]) => ({ date, value: Math.round(p) }));
  });
  let trendMetric = $state<'kcal' | 'protein'>('kcal');

  type FoodView = 'today' | 'history' | 'recipes';
  const VIEW_KEY = 'recompos.food.view';
  let view = $state<FoodView>((() => {
    try { const v = sessionStorage.getItem(VIEW_KEY); return v === 'history' || v === 'recipes' ? v : 'today'; } catch { return 'today'; }
  })());
  function setView(v: FoodView) {
    view = v;
    try { sessionStorage.setItem(VIEW_KEY, v); } catch { /* storage disabled */ }
  }
  let shownDays = $state(14);
  let foodSwipeOffsets = $state<Record<string, number>>({});
  let repeatingId = $state<string | null>(null);

  // Provenance as a quiet tag on the row, not words baked into its name.
  const SOURCE_TAG: Record<string, string> = { ai: 'AI', offline: 'estimate', label: 'label', plan: 'plan' };
  const sourceLabel = (f: any) => SOURCE_TAG[sourceOf(f) ?? ''] ?? '';

  /** Food logged on this page: FoodLogger (search, scan, photo, AI, quick
   *  add) and re-logging all land here and save through saveFoods, one
   *  request for the whole meal. A failure shows in the logger with the meal
   *  still in the review card, and tapping Log again can't double the items
   *  that had already gone through. */
  async function logFoods(foods: NewFood[], _what: string) {
    const before = { kcal: todayTotals.kcal, protein: todayTotals.protein };
    await saveFoods(uid, todayStr, foods);
    announceFood(before, {
      kcal: foods.reduce((s, f) => s + f.kcal, 0),
      protein: foods.reduce((s, f) => s + f.protein_g, 0),
    });
  }

  // Speak the moment an entry tips a threshold: protein target just hit, or the
  // calorie budget just crossed into the red (only nagged when cutting). The
  // per-day keys mean each milestone is celebrated once, not on every bite.
  function announceFood(
    before: { kcal: number; protein: number },
    added: { kcal: number; protein: number }
  ) {
    const afterProtein = before.protein + added.protein;
    const afterKcal = before.kcal + added.kcal;
    const dir = goalDirection(currentWeightKg, goalKg ?? 0);

    if (proteinTargetG > 0 && before.protein < proteinTargetG && afterProtein >= proteinTargetG) {
      speak(`protein-hit-${todayStr}`, 'Protein target hit 💪', {
        tone: 'good', icon: '💪',
        body: 'That’s the muscle-protecting lever locked in for today. Nicely done.',
      });
    }

    // Past today's share: say what it costs the rest of the week, never that
    // the day is lost — that thought is what turns one meal into a weekend.
    if (todayShare && dir !== 'gain' && before.kcal <= todayShare && afterKcal > todayShare) {
      const over = Math.round(afterKcal - todayShare);
      const w = restOfWeek(afterKcal);
      speak(`past-share-${todayStr}`, `${over} kcal past today’s share`, {
        tone: 'warn', icon: '⚖️', ttl: 8000,
        body: w && w.days > 0
          ? `The week absorbs it — about ${w.perDay.toLocaleString()} a day for the next ${w.days} day${w.days === 1 ? '' : 's'}.`
          : 'That’s the week. Monday starts clean.',
      });
    }
  }

  // Instantly re-logs an already-saved food entry as a new entry for
  // today -- the one-tap "redo" for meals you eat again (esp. when you
  // cook once and eat the same thing across several days) without
  // retyping macros.
  async function repeatFood(f: any) {
    haptic('tap');
    repeatingId = f.id;
    try {
      await logFoods([{
        name: cleanName(f.name), kcal: f.kcal || 0, protein_g: f.protein_g || 0, carbs_g: f.carbs_g || 0, fat_g: f.fat_g || 0,
        grams: f.grams ?? null, barcode: f.barcode ?? null, source: 'quick',
      }], f.name);
    } catch (e) {
      console.error('Repeat failed:', e);
    } finally {
      repeatingId = null;
    }
  }

  // — Recipe generation —
  // The hardcoded 19 recipes were never a technical limit: the app is online by
  // definition. This asks for a recipe built around what you actually want AND
  // the macro gap you actually have left today, then keeps it.
  const _customRecipes = liveCustomRecipes();
  let recipeAsk = $state('');
  let generating = $state(false);
  let genMsg = $state('');

  const IDEAS = [
    'high-protein, 20 minutes, one pan',
    'chicken + whatever veg, Indian, batch of 4',
    'vegetarian, 500 kcal, filling',
    'no cooking — assemble only',
    'kid-friendly, freezes well',
    'paneer, Instant Pot, low oil'
  ];

  // The week is the budget; today's share is what's left of it spread over
  // the days left (stores/body). A big Saturday leaves less for Sunday — it
  // doesn't "break" anything.
  const week = $derived($body.week);
  const todayShare = $derived(week?.share ?? null);
  const weekLeft = $derived(week ? week.budget - week.before - Math.round(todayTotals.kcal) : null);
  /** What the rest of the week has per day once today's total is `kcalToday`. */
  function restOfWeek(kcalToday: number) {
    if (!week) return null;
    const days = week.daysLeft - 1;
    return { days, perDay: days > 0 ? Math.max(0, Math.round((week.budget - week.before - kcalToday) / days)) : 0 };
  }
  const usualKcal = $derived($body.learned.meanIntake != null ? Math.round($body.learned.meanIntake / 10) * 10 : null);

  // — Live food coach — the running totals turned into one honest, actionable
  // line that refreshes the instant a new entry lands (it reads todayTotals,
  // which is reactive).
  const foodEval = $derived(
    evaluateFood({
      calorieTarget: todayShare,
      kcalSoFar: todayTotals.kcal,
      proteinTarget: proteinTargetG,
      proteinSoFar: todayTotals.protein,
      carbsSoFar: todayTotals.carbs,
      fatSoFar: todayTotals.fat,
      direction: goalDirection(currentWeightKg, goalKg ?? 0),
      weekAfter: restOfWeek(todayTotals.kcal),
    })
  );

  // Normalise a saved row (Postgres column names) into the render shape.
  function toView(r: any): ViewRecipe {
    return {
      id: r.id, name: r.name, e: r.e, t: r.t,
      k: r.k, p: r.p, c: r.c, f: r.f, batch: r.batch,
      desc: r.descr ?? '', ing: r.ing ?? [],
      prep: r.prep ?? [], steps: r.steps ?? [], instantPot: r.instant_pot ?? [],
      kid: r.kid, custom: true, coachNote: r.coach_note ?? ''
    };
  }

  const customRecipes = $derived(
    [...$_customRecipes]
      .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
      .map(toView)
  );

  async function generateRecipe() {
    const ask = recipeAsk.trim();
    if (!ask) { genMsg = 'Say what you feel like eating.'; return; }
    if (!uid) { genMsg = 'Not signed in — please sign back in.'; return; }
    generating = true;
    genMsg = '';
    try {
      const { supabase } = await import('$lib/db/client');
      const { data, error } = await supabase.functions.invoke('generate-recipe', {
        body: {
          request: ask,
          proteinTarget: proteinTargetG,
          kcalTarget: todayShare,
          proteinSoFar: Math.round(todayTotals.protein),
          kcalSoFar: Math.round(todayTotals.kcal),
          // Don't serve the same dinner twice in a week.
          avoid: customRecipes.slice(0, 6).map((r) => r.name)
        }
      });
      if (error) throw error;
      if (data?.error) { genMsg = data.error; return; }

      await upsertRecord('recipes_custom', {
        id: crypto.randomUUID(), user_id: uid,
        name: data.name, e: data.e, t: data.t,
        k: data.k, p: data.p, c: data.c, f: data.f, batch: data.batch,
        descr: data.desc ?? '', ing: data.ing ?? [],
        prep: data.prep ?? [], steps: data.steps ?? [], instant_pot: data.instantPot ?? [],
        kid: !!data.kid, coach_note: data.coachNote ?? '', request: ask,
        created_at: new Date().toISOString()
      });
      recipeAsk = '';
      genMsg = '';
      // Open it straight away — you asked for a recipe, you want to read it.
      selected = { ...data, id: 'new', desc: data.desc, custom: true };
    } catch (e: any) {
      genMsg = 'Could not generate: ' + (e?.message || String(e)).slice(0, 180);
    } finally {
      generating = false;
    }
  }

  async function deleteCustomRecipe(id: string) {
    try {
      await db.table('recipes_custom').delete(id);
      const { supabase } = await import('$lib/db/client');
      const { error } = await supabase.from('recipes_custom').delete().eq('id', id).eq('user_id', uid);
      if (error) console.error('Recipe delete failed:', error);
    } catch (e) { console.error('Recipe delete failed:', e); }
  }

  // Log a cooked portion straight into today's food log — the point of a recipe
  // in a tracking app is that eating it costs one tap, not a retype of macros.
  let loggingRecipe = $state(false);
  async function logRecipePortion(r: ViewRecipe) {
    if (!uid) return;
    haptic('tap');
    loggingRecipe = true;
    try {
      const before = { kcal: todayTotals.kcal, protein: todayTotals.protein };
      await saveFoods(uid, todayStr, [{ name: `${r.name} (1 portion)`, kcal: r.k, protein_g: r.p, carbs_g: r.c, fat_g: r.f, source: 'recipe' }]);
      announceFood(before, { kcal: r.k, protein: r.p });
      selected = null;
    } catch (e: any) {
      genMsg = 'Log failed: ' + (e?.message || String(e)).slice(0, 150);
    } finally {
      loggingRecipe = false;
    }
  }

  async function removeFood(id: string) {
    await db.table('food_logs').delete(id);
    syncStatus.set('syncing');
    const { error } = await (await import('$lib/db/client')).supabase
      .from('food_logs').delete().eq('id', id).eq('user_id', uid);
    if (error) console.error('Food delete failed:', error);
    syncStatus.set('synced');
  }

  // ── FUEL hero ── protein is the lever that decides whether a deficit costs
  // fat or muscle, so it leads. The orb fills with today's protein vs target.
  const proteinPct = $derived(proteinTargetG ? Math.round((todayTotals.protein / proteinTargetG) * 100) : 0);
  const fuelPct = $derived(Math.min(100, proteinPct));
  // Praised when it's hit, never judged on the way: half a day's protein at
  // noon is a fasting morning, not a shortfall (some people eat from 15:00),
  // and the hero turned copper every morning until the first meal.
  const fuelTone: 'good' | 'na' = $derived(proteinTargetG && proteinPct >= 100 ? 'good' : 'na');
  const fuelStory = $derived.by(() => {
    if (!proteinTargetG) return 'Set a goal to see targets';
    const left = Math.max(0, Math.round(proteinTargetG - todayTotals.protein));
    if (proteinPct >= 100) return 'Protein target hit 💪';
    if (todayFoods.length === 0) return 'Log a protein-forward meal';
    return `${left}g protein to go`;
  });
</script>

<PageHero title="Food" sub="Today so far"
  tone={fuelTone} pct={fuelPct}
  value={`${Math.round(todayTotals.protein)}g`}
  caption={proteinTargetG ? `of ${proteinTargetG}g protein` : 'protein today'}
  story={fuelStory}
  stats={week ? [
    { v: Math.round(todayTotals.kcal).toLocaleString(), l: `of ${week.share.toLocaleString()} today` },
    { v: weekLeft != null && weekLeft < 0 ? `+${(-weekLeft).toLocaleString()}` : (weekLeft ?? 0).toLocaleString(), l: weekLeft != null && weekLeft < 0 ? 'over this week' : 'left this week' },
    { v: week.daysLeft, l: week.daysLeft === 1 ? 'day to go' : 'days to go' }
  ] : [
    { v: Math.round(todayTotals.kcal), l: 'kcal today' },
    { v: `${Math.round(todayTotals.carbs)}g`, l: 'carbs' },
    { v: `${Math.round(todayTotals.fat)}g`, l: 'fat' }
  ]} />

<!-- Three things to do here, one at a time: log today, look back, cook. -->
<div class="food-views" role="tablist" aria-label="Food">
  {#each [['today', 'Today'], ['history', 'History'], ['recipes', 'Recipes']] as [v, label]}
    <button type="button" role="tab" aria-selected={view === v} class:on={view === v} onclick={() => setView(v as FoodView)}>{label}</button>
  {/each}
</div>

{#if view === 'today'}
<!-- Where the number comes from, in the log's own terms: a log that leaves the
     same things out every week is still a good ruler, so the target is set in
     its units and nobody is asked to weigh the oil. -->
{#if liveTarget.target && liveTarget.basis === 'learned'}
  <div class="live-target">
    This week: <b>{liveTarget.target.toLocaleString()} kcal</b> a day{#if usualKcal && usualKcal - liveTarget.target >= 50}, {(usualKcal - liveTarget.target).toLocaleString()} under your usual {usualKcal.toLocaleString()}{/if}.
    Your log and scale say you hold weight at about <b>{liveTarget.maintenance?.toLocaleString()}</b> as you log it. Whatever the log
    leaves out (cooking oil, a handful of nuts, a kid's leftovers) is left out of both numbers, so it cancels. Keep logging the way you do.
    {#if liveTarget.adjustKcal}Includes {liveTarget.adjustKcal > 0 ? '+' : '−'}{Math.abs(liveTarget.adjustKcal)} from your check-in.{/if}
    New number every Monday.
  </div>
{:else if liveTarget.target && liveTarget.basis === 'formula'}
  <div class="live-target">
    This week: <b>{liveTarget.target.toLocaleString()} kcal</b> a day, from a formula (~{liveTarget.maintenance?.toLocaleString()} maintenance{#if latestBodyFat}, lean-mass BMR at {latestBodyFat}% bf{/if}).
    A few weeks of logging the way you do and weighing most mornings, and it comes from your own numbers instead.
  </div>
{/if}

<FoodLogger logs={$_foodLogs as any[]} today={todayStr} onLog={logFoods}
  proteinLeft={Math.max(0, proteinTargetG - todayTotals.protein)} />

<div class="card">
  <div class="card-lbl">Today</div>
  {#if todayFoods.length > 0}
    <div class="food-list">
      {#each todayFoods as f}
        <div class="swipe-row">
          <div class="swipe-actions">
            <div class="swipe-delete" onclick={() => removeFood(f.id)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeFood(f.id); } }}>Delete</div>
          </div>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="food-item swipe-content"
            style="transform:translateX({foodSwipeOffsets[f.id] ?? 0}px)"
            use:swipeActions={{
              onOffset: (px) => foodSwipeOffsets = { ...foodSwipeOffsets, [f.id]: px },
              onSettle: () => {}
            }}
          >
            <div class="fi-main">
              <div class="fi-name">{cleanName(f.name)}{#if sourceLabel(f)}<span class="fi-src">{sourceLabel(f)}</span>{/if}</div>
              <div class="fi-macros">{Math.round(f.kcal)} kcal &middot; P{Math.round(f.protein_g)} C{Math.round(f.carbs_g)} F{Math.round(f.fat_g)}</div>
            </div>
            <button type="button" class="fi-repeat" onclick={() => repeatFood(f)} disabled={repeatingId === f.id} title="Log this again">
              {repeatingId === f.id ? '…' : '⟳'}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div style="font-size:0.75rem;color:var(--muted);text-align:center;padding:10px 0">No food logged today yet.</div>
  {/if}
</div>

<!-- The coach's plan comes after the logging: making it is occasional, logging
     is every meal (2026-11-03). -->
<CoachPlan />

{#if foodEval.tone !== 'na'}
  <div class="card coach-card coach-{foodEval.tone}">
    <div class="coach-hd">
      <span class="coach-dot"></span>
      <span class="coach-title">{foodEval.headline}</span>
    </div>
    <div class="coach-body">{foodEval.detail}</div>
  </div>
{/if}

{#if $_goalReason}
  <div class="note-box">🎯 {goalSummary($_goalReason)}</div>
{:else}
  <div class="note-box warn">🎯 No plan yet — set one in <strong>Progress → Body &amp; Goals</strong>.</div>
{/if}
{:else if view === 'history'}
{#if kcalTrend.length >= 2}
  <div class="card">
    <div class="flex jb ac">
      <div class="card-lbl" style="margin-bottom:0">Intake Trend</div>
      <div class="flex gap2">
        <button class="tab {trendMetric === 'kcal' ? 'on' : ''}" style="padding:3px 10px;font-size:0.6875rem" onclick={() => trendMetric = 'kcal'}>kcal</button>
        <button class="tab {trendMetric === 'protein' ? 'on' : ''}" style="padding:3px 10px;font-size:0.6875rem" onclick={() => trendMetric = 'protein'}>protein</button>
      </div>
    </div>
    <div style="margin-top:10px">
      {#if trendMetric === 'kcal'}
        <MiniChart data={kcalTrend} color="var(--amber)" unit=" kcal" />
      {:else}
        <MiniChart data={proteinTrend} color="var(--green, #2ecc71)" unit="g" />
      {/if}
    </div>
    <div style="font-size:0.6875rem;color:var(--muted);text-align:center">Daily {trendMetric === 'kcal' ? 'calories' : 'protein (g)'} over {kcalTrend.length} logged days</div>
  </div>
{/if}

{#if historyByDay.length > 0}
  <div class="card">
    <div class="card-lbl">Every day you logged</div>
    {#each historyByDay.slice(0, shownDays) as day (day.date)}
      <div class="hist-day">
        <div class="flex jb ac">
          <div style="font-size:0.8125rem;font-weight:700;color:var(--text)">{new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          <div style="font-size:0.6875rem;color:var(--amber);font-weight:600">{Math.round(day.totals.kcal)} kcal &middot; P{Math.round(day.totals.protein)}</div>
        </div>
        {#each day.foods as f}
          <div class="hist-item">
            <span class="hist-name">{cleanName(f.name)}</span>
            <div class="flex ac gap2">
              <span class="hist-macros">{Math.round(f.kcal)}kcal</span>
              <button type="button" class="fi-repeat fi-repeat-sm" onclick={() => repeatFood(f)} disabled={repeatingId === f.id} title="Re-log today">
                {repeatingId === f.id ? '…' : '⟳'}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/each}
    {#if historyByDay.length > shownDays}
      <button type="button" class="btn bg_ bsm bfl hist-more" onclick={() => (shownDays += 14)}>Show {Math.min(14, historyByDay.length - shownDays)} more days</button>
    {/if}
  </div>
{:else}
  <div class="card hist-empty">The days you log land here, newest first, each meal ready to log again with one tap.</div>
{/if}

<!-- Weekly eating patterns. -->
<NutritionInsights />
{:else}
<div class="card gen-card">
  <div class="card-lbl">Cook something new</div>
  <div class="gen-sub">
    Describe what you feel like — ingredients, cuisine, time, equipment, who's eating.
    It's written around the
    {#if todayShare}{Math.max(0, todayShare - Math.round(todayTotals.kcal))} kcal and {/if}
    {Math.max(0, proteinTargetG - Math.round(todayTotals.protein))}g of protein you still have left today.
  </div>
  <textarea class="gen-input" rows="2" bind:value={recipeAsk}
    placeholder="e.g. chicken and spinach, Indian, 30 min, Instant Pot, enough for 4"></textarea>
  <div class="gen-ideas">
    {#each IDEAS as idea}
      <button type="button" class="gen-chip" onclick={() => recipeAsk = idea}>{idea}</button>
    {/each}
  </div>
  <button class="btn bp bfl" style="margin-top:8px" onclick={generateRecipe} disabled={generating}>
    {generating ? 'Writing your recipe…' : 'Generate recipe'}
  </button>
  {#if genMsg}<div class="gen-msg">{genMsg}</div>{/if}
</div>

{#if customRecipes.length > 0}
  <h3>Your recipes</h3>
  {#each customRecipes as r (r.id)}
    <div class="rcard" onclick={() => selected = r} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = r; } }}>
      <div class="flex jb ac">
        <div style="min-width:0">
          <div style="font-weight:700;color:var(--text);font-size:0.9375rem">{r.e} {r.name}</div>
          <div style="font-size:0.6875rem;color:var(--muted);margin-top:2px">{r.desc}</div>
        </div>
        <div style="text-align:right;font-size:0.75rem;flex-shrink:0">
          <div style="color:var(--amber);font-weight:700">{r.k} kcal</div>
          <div style="color:var(--muted)">{r.p}p &middot; {r.c}c &middot; {r.f}f</div>
        </div>
      </div>
      <div class="flex gap2 ac" style="margin-top:8px">
        <span class="badge bg">{r.t} min</span>
        <span class="badge ba">{r.p}g protein</span>
        {#if r.kid}<span class="badge bk">👶 Kid-friendly</span>{/if}
        <button type="button" class="rcard-del" onclick={(ev) => { ev.stopPropagation(); deleteCustomRecipe(String(r.id)); }} aria-label="Delete recipe">✕</button>
      </div>
    </div>
  {/each}
{:else}
  <!-- The 19 built-ins used to carry a new user through this space. With them
       gone the area under the generator is blank, so the empty state says what
       happens; the idea chips one card up start it in one tap. -->
  <div class="rcard rcard-empty">
    <div style="font-weight:700;color:var(--text);font-size:0.9375rem">No recipes yet</div>
    <div style="font-size:0.75rem;color:var(--muted);margin-top:4px">
      Describe a meal above, or tap one of the ideas, and it gets written around
      your remaining macros for today — then saved here for one-tap logging.
    </div>
  </div>
{/if}
{/if}

<Modal open={selected !== null} onclose={() => selected = null}>
  {#if selected}
    <div style="font-size:1.25rem;font-weight:700;color:var(--text);margin-bottom:4px">{selected.e} {selected.name}</div>
    <div style="font-size:0.75rem;color:var(--muted);margin-bottom:8px">
      {selected.k} kcal &middot; {selected.p}g protein &middot; {selected.c}g carbs &middot; {selected.f}g fat &middot; {selected.t} min
      {#if selected.batch}&middot; makes {selected.batch}{/if}
    </div>
    {#if selected.coachNote}<div class="note-box" style="margin-bottom:10px">🎯 {selected.coachNote}</div>{/if}

    <button class="btn bp bfl" style="margin-bottom:12px" onclick={() => logRecipePortion(selected!)} disabled={loggingRecipe}>
      {loggingRecipe ? 'Logging…' : `Log 1 portion (${selected.k} kcal · ${selected.p}g protein)`}
    </button>

    <h3>Ingredients</h3>
    {#each catOrder as cat}
      {#if selected.ing.some((i) => i.cat === cat)}
        <div style="font-size:0.6875rem;color:var(--muted);margin:6px 0 3px">{catLabel[cat]}</div>
        {#each selected.ing.filter(i => i.cat === cat) as ing}
          <div class="gi" style="padding:5px 0">
            <div class="gn">{ing.n}</div>
            <div class="gp">{ing.a}</div>
          </div>
        {/each}
      {/if}
    {/each}

    <h3>Method</h3>
    <div class="tab-row">
      <button class="tab" class:on={method === 'stovetop'} onclick={() => method = 'stovetop'}>Stovetop</button>
      <button class="tab" class:on={method === 'instantPot'} onclick={() => method = 'instantPot'}>Instant Pot</button>
    </div>

    <div class="card" style="margin-bottom:0">
      <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);margin-bottom:8px">PREP</div>
      {#each selected.prep as step, i}
        <div class="gi" style="padding:5px 0"><div class="gn">{i+1}. {step}</div></div>
      {/each}
      <hr style="border:none;border-top:1px solid var(--border);margin:8px 0">
      <div style="font-size:0.6875rem;font-weight:700;color:var(--muted);margin-bottom:8px">{method === 'instantPot' ? 'INSTANT POT' : 'STOVETOP'}</div>
      {#each (method === 'instantPot' ? selected.instantPot : selected.steps) as step, i}
        <div class="gi" style="padding:5px 0"><div class="gn">{i+1}. {step}</div></div>
      {/each}
    </div>
  {/if}
</Modal>

<style>
  .food-views{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px;margin:0 0 14px;
    background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-md)}
  .food-views button{border:none;background:none;padding:9px 0;border-radius:calc(var(--r-md) - 3px);cursor:pointer;
    font-family:var(--font-label);font-size:0.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);
    transition:background .18s var(--ease),color .18s var(--ease)}
  .food-views button.on{background:var(--bg3);color:var(--text)}
  .hist-more{margin-top:12px}
  .hist-empty{font-size:0.8125rem;color:var(--muted);text-align:center;padding:22px 16px}
  .live-target{font-size:0.75rem;color:var(--amber2);line-height:1.5;background:var(--glass-2);border:1px solid var(--glass-brd);border-radius:11px;padding:9px 11px;margin-bottom:12px}
  .live-target b{color:var(--text)}
  .fi-src{margin-left:6px;font-size:0.6875rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 4px;vertical-align:1px}
  .gen-card{border:1px solid color-mix(in srgb, var(--amber) 45%, transparent)}
  .gen-sub{font-size:0.6875rem;color:var(--muted);line-height:1.45;margin-bottom:8px}
  .gen-input{width:100%;resize:vertical;font-family:inherit}
  .gen-ideas{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .rcard-empty{border-style:dashed;cursor:default}
  .gen-chip{background:var(--bg3);border:1px solid var(--border);color:var(--muted);font-size:0.6875rem;border-radius:999px;padding:4px 10px;cursor:pointer;font-family:inherit}
  .gen-chip:disabled{opacity:.5;cursor:default}
  .gen-chip:active{transform:scale(.97)}
  .gen-msg{font-size:0.75rem;color:var(--amber);text-align:center;margin-top:8px;line-height:1.45}
  .rcard-del{margin-left:auto;background:none;border:none;color:var(--muted);font-size:0.875rem;cursor:pointer;padding:2px 6px;font-family:inherit}

  /* Live food coach — talks to you after every entry. Tone drives the accent. */
  .coach-card{--coach:var(--blue,#60a5fa);border:1px solid color-mix(in srgb, var(--coach) 40%, transparent);background:color-mix(in srgb, var(--coach) 8%, var(--bg2))}
  .coach-good{--coach:var(--green,#2ecc71)}
  .coach-ok{--coach:var(--blue,#60a5fa)}
  .coach-warn{--coach:var(--amber,#f5a623)}
  .coach-bad{--coach:#ff6b6b}
  .coach-hd{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .coach-dot{width:8px;height:8px;border-radius:50%;background:var(--coach);flex-shrink:0;box-shadow:0 0 10px var(--coach)}
  .coach-title{font-size:0.8125rem;font-weight:800;color:var(--text)}
  .coach-body{font-size:0.75rem;color:var(--text);line-height:1.5}
</style>
