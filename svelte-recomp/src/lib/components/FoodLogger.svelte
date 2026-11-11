<script lang="ts">
  // ONE place to log food. It replaces five separate controls — a search box, a
  // second "food name" box with four macro fields, "Scan barcode", "Photo of
  // food", "Describe food" — plus a kcal-only quick log on Today that kept a
  // second set of books.
  //
  // Type and it searches your own foods, the built-in basics and Open Food Facts
  // at once. Enter (or the ✨ row) sends the words to the AI estimator. The two
  // buttons in the box scan a barcode or take a photo — of a meal, or of a
  // nutrition table. Every path ends in the same review card: portion, macros,
  // Log. Empty, the box shows your staples, yesterday, and yesterday's meals.
  import { historyFoods, searchLocal, scale, times, sum, estimateLocally, type Candidate, type Macros, type NewFood } from '$lib/nutrition';
  import { searchProducts, lookupBarcode, estimateWithAI, type AiItem } from '$lib/nutrition/foodSources';
  import { frequentFoods, proteinFillers, repeatDay, groupIntoMeals, usualMeals, notYetLogged } from '$lib/nutrition';
  import { fileToDownscaledDataUrl } from '$lib/image';
  import { shiftYmd } from '$lib/date';
  import { haptic } from '$lib/haptics';
  import BarcodeScanner from './BarcodeScanner.svelte';

  let { logs, today, onLog, proteinLeft = 0 }: {
    logs: any[];
    today: string;
    onLog: (foods: NewFood[], what: string) => Promise<void>;
    /** Grams of protein still to go today; the protein row shows from 15 g. */
    proteinLeft?: number;
  } = $props();

  type Pending =
    | { kind: 'food'; c: Candidate; grams: number | null; mult: number }
    | { kind: 'meal'; name: string; items: AiItem[]; note: string; source: 'ai' | 'offline'; mult: number }
    | { kind: 'manual'; name: string; kcal: string; p: string; c: string; f: string };

  let query = $state('');
  let pending = $state<Pending | null>(null);
  let products = $state<Candidate[]>([]);
  let productState = $state<'idle' | 'loading' | 'error'>('idle');
  let working = $state(''); // what the AI / lookup is doing right now
  let notice = $state('');  // a problem, or what happened, in one line
  let missBarcode = $state<string | null>(null); // a scan nobody knows — offer the label photo
  let scanning = $state(false);
  let saving = $state(false);
  let photoMode: 'meal' | 'label' = 'meal';
  let fileInput: HTMLInputElement | undefined = $state();
  // Kept after a failed attempt, so trying again doesn't mean taking it again.
  let retryPhoto: { image: string; mode: 'meal' | 'label' } | null = $state(null);
  let inputEl: HTMLInputElement | undefined = $state();

  const history = $derived(historyFoods(logs));
  const local = $derived(searchLocal(query, history));
  const yesterday = $derived(shiftYmd(-1, new Date(today + 'T12:00:00')));
  const fillers = $derived(proteinLeft >= 15 ? proteinFillers(logs, 3) : []);
  const staples = $derived(frequentFoods(logs, 8).filter((s) => !fillers.some((f) => f.name === s.name)));
  const yesterdayLeft = $derived(repeatDay(logs, yesterday, today));
  // Your usual meals, one tap each (the same foods on 5 of the last 14 days),
  // with what's already logged today left out so a second tap adds nothing.
  const usuals = $derived(usualMeals(logs, today).map((m) => ({ ...m, left: notYetLogged(logs, m.items, today) })).filter((m) => m.left.length));
  const sameFoods = (a: { items: Array<{ name: string }> }, b: { items: Array<{ name: string }> }) =>
    a.items.map((x) => x.name.toLowerCase()).sort().join('|') === b.items.map((x) => x.name.toLowerCase()).sort().join('|');
  const meals = $derived(groupIntoMeals(logs, yesterday).filter((m) => !usuals.some((u) => u.label === m.label && sameFoods(u, m))));
  const hasQuery = $derived(query.trim().length >= 2);

  // ── Online search: debounced, one request in flight, every request timed ──
  let ctrl: AbortController | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const q = query.trim();
    clearTimeout(debounce);
    ctrl?.abort();
    if (q.length < 2 || pending) { products = []; productState = 'idle'; return; }
    productState = 'loading';
    debounce = setTimeout(async () => {
      const mine = (ctrl = new AbortController());
      try {
        const { results } = await searchProducts(q, mine.signal);
        if (mine === ctrl) { products = results; productState = 'idle'; }
      } catch {
        if (mine === ctrl && !mine.signal.aborted) { products = []; productState = 'error'; }
      }
    }, 320);
  });

  // ── Review card arithmetic ──────────────────────────────────────────────
  const result = $derived.by((): (Macros & { grams: number | null }) | null => {
    const p = pending;
    if (!p) return null;
    if (p.kind === 'food') {
      if (p.c.per100 && p.grams != null) return { ...scale(p.c.per100, p.grams), grams: p.grams };
      if (p.c.portion) return { ...times(p.c.portion, p.mult), grams: p.c.portion.grams ? Math.round(p.c.portion.grams * p.mult) : null };
      return null;
    }
    if (p.kind === 'meal') {
      const grams = p.items.every((i) => i.grams) ? Math.round(p.items.reduce((s, i) => s + (i.grams ?? 0), 0) * p.mult) : null;
      return { ...times(sum(p.items), p.mult), grams };
    }
    const n = (v: string) => Math.max(0, parseFloat(v) || 0);
    return { kcal: Math.round(n(p.kcal)), protein_g: n(p.p), carbs_g: n(p.c), fat_g: n(p.f), grams: null };
  });

  function displayName(c: Candidate) {
    return c.brand && !c.name.toLowerCase().includes(c.brand.toLowerCase()) ? `${c.name} · ${c.brand}` : c.name;
  }

  function pick(c: Candidate) {
    haptic('select');
    notice = ''; retryPhoto = null;
    const grams = c.per100 ? (c.portion?.grams ?? c.servings[0]?.g ?? 100) : null;
    pending = { kind: 'food', c, grams, mult: 1 };
  }

  function reset() {
    pending = null; query = ''; notice = ''; working = ''; missBarcode = null; retryPhoto = null;
    products = []; productState = 'idle';
  }

  async function describe() {
    const text = query.trim();
    if (text.length < 2 || working) return;
    haptic('tap');
    notice = ''; working = 'Estimating…';
    try {
      const r = await estimateWithAI({ description: text });
      if ('error' in r) { notice = r.error; return; }
      if (r.mode !== 'meal') return;
      pending = { kind: 'meal', name: r.name, items: r.items.length ? r.items : [{ ...r, name: r.name, grams: null }], note: `AI estimate · ${r.confidence} confidence`, source: 'ai', mult: 1 };
    } catch {
      // Every AI provider failed (or there's no network): fall back to what we
      // know offline, and say so.
      const est = estimateLocally(text, history);
      if (est) {
        pending = {
          kind: 'meal', name: text, source: 'offline', mult: 1,
          items: est.items.map((i) => ({ ...i, name: `${i.name} → ${i.from}` })),
          note: est.unmatched.length ? `Offline estimate — couldn't place: ${est.unmatched.join(', ')}` : 'Offline estimate from known foods',
        };
      } else {
        notice = 'The AI services are unreachable and these foods aren’t in the offline list — enter the numbers yourself.';
      }
    } finally {
      working = '';
    }
  }

  function photo(mode: 'meal' | 'label') {
    photoMode = mode;
    fileInput?.click();
  }

  // From the home-screen widget (the Food page calls these): the scanner opens
  // straight away; the camera needs a tap, so a big button asks for it.
  let photoAsk = $state(false);
  export function startScan() { notice = ''; photoAsk = false; scanning = true; }
  export function askPhoto() { notice = ''; scanning = false; photoAsk = true; }

  // A meal photo waits for a few optional words before it goes (the owner,
  // 2026-11-03: "before I could say a few words describing the food").
  let snap = $state<string | null>(null);
  let snapWords = $state('');
  async function onPhoto(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (photoMode !== 'meal') { await readPhoto(file, photoMode); return; }
    try { snap = await fileToDownscaledDataUrl(file, { maxEdge: 1024, quality: 0.85 }); snapWords = query.trim(); }
    catch { notice = 'Couldn’t open that photo. Try another, or describe the food in words.'; }
  }
  function sendSnap() {
    const image = snap;
    snap = null;
    if (image) readPhoto(image, 'meal', snapWords);
  }

  async function readPhoto(photo: File | string, mode: 'meal' | 'label', words?: string) {
    retryPhoto = null;
    notice = ''; working = mode === 'label' ? 'Reading the label…' : 'Looking at your plate…';
    let image = typeof photo === 'string' ? photo : '';
    try {
      // A label needs legible small print; a plate doesn't.
      image ||= await fileToDownscaledDataUrl(photo as File, { maxEdge: mode === 'label' ? 1600 : 1024, quality: 0.85 });
      const r = await estimateWithAI({ image, mode, description: mode === 'meal' ? (words ?? query).trim() || undefined : undefined });
      if ('error' in r) {
        // Photo reading paused (the AI's credit ran out): trying the same photo
        // again can't help, so no retry, just the way that still works.
        if (r.paused) { notice = r.error; return; }
        // A dish it can't place (a home-cooked one) is a question, not a dead
        // end: a few typed words go along with the same photo on the next try.
        // A label it can't read needs a new photo, so that one isn't kept.
        if (mode === 'meal') retryPhoto = { image, mode };
        notice = mode === 'meal' && !query.trim() ? `${r.error} Type what it is above, then try the same photo again.` : r.error;
        return;
      }
      if (r.mode === 'label') {
        const servings = [
          ...(r.serving_g ? [{ label: 'serving', g: r.serving_g }] : []),
          ...(r.package_g && r.package_g !== r.serving_g ? [{ label: 'whole pack', g: r.package_g }] : []),
        ];
        const c: Candidate = {
          key: `l:${Date.now()}`, source: 'off', name: r.name || query.trim() || 'Packaged food',
          per100: r.per100, servings, barcode: missBarcode,
        };
        pending = { kind: 'food', c, grams: servings[0]?.g ?? 100, mult: 1 };
        notice = r.source === 'label' ? 'Read from the label — check the numbers.' : 'No table in view — these are the product’s usual values. Check them.';
      } else {
        pending = { kind: 'meal', name: r.name, items: r.items.length ? r.items : [{ ...r, name: r.name, grams: null }], note: `AI estimate · ${r.confidence} confidence`, source: 'ai', mult: 1 };
      }
    } catch {
      if (image) retryPhoto = { image, mode };
      notice = image
        ? 'The photo reader didn’t answer this time. Try again in a minute, or describe the food in words — that works offline too.'
        : 'Couldn’t open that photo. Try another, or describe the food in words.';
    } finally {
      working = '';
    }
  }

  async function onScanned(code: string) {
    scanning = false;
    notice = ''; working = `Looking up ${code}…`;
    try {
      const c = await lookupBarcode(code, history);
      if (c) { pick({ ...c, barcode: code }); return; }
      missBarcode = code;
      notice = `${code} isn't in Open Food Facts, USDA's database or your history.`;
    } finally {
      working = '';
    }
  }

  function manual() {
    pending = { kind: 'manual', name: query.trim(), kcal: '', p: '', c: '', f: '' };
  }

  async function logPending() {
    const p = pending, r = result;
    if (!p || !r || saving) return;
    const name = p.kind === 'food' ? displayName(p.c) : p.name.trim() || 'Food';
    const source = p.kind === 'manual' ? 'manual'
      : p.kind === 'meal' ? p.source
      : p.c.key.startsWith('l:') ? 'label' : p.c.source;
    saving = true;
    try {
      await onLog([{
        name, kcal: r.kcal, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
        grams: r.grams, barcode: p.kind === 'food' ? p.c.barcode ?? null : null, source,
      }], name);
      haptic('success');
      reset();
      inputEl?.blur();
    } catch (e: any) {
      notice = 'Couldn’t save: ' + String(e?.message ?? e).slice(0, 140);
    } finally {
      saving = false;
    }
  }

  async function quick(foods: Array<Macros & { name: string; grams?: number | null }>, what: string) {
    if (saving || !foods.length) return;
    haptic('tap');
    saving = true;
    try { await onLog(foods.map((f) => ({ ...f, source: 'quick' })), what); }
    catch (e: any) { notice = 'Couldn’t save: ' + String(e?.message ?? e).slice(0, 140); }
    finally { saving = false; }
  }

  const unit = (c: Candidate) => (c.ml ? 'ml' : 'g');
  const macroLine = (m: Macros) => `${Math.round(m.kcal)} kcal · ${Math.round(m.protein_g)} P · ${Math.round(m.carbs_g)} C · ${Math.round(m.fat_g)} F`;
</script>

<section class="logger" aria-label="Log food">
  <div class="lg-box" class:busy={!!working}>
    <input
      bind:this={inputEl}
      class="lg-input"
      placeholder="What did you eat?"
      bind:value={query}
      oninput={() => { if (pending?.kind !== 'manual') pending = null; notice = ''; missBarcode = null; }}
      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); describe(); } }}
      autocomplete="off" enterkeyhint="send" aria-label="What did you eat?"
    />
    <button class="lg-icon" onclick={() => { notice = ''; scanning = true; }} aria-label="Scan a barcode" title="Scan a barcode">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13 8v8M16 8v8"/></svg>
    </button>
    <button class="lg-icon" onclick={() => photo('meal')} aria-label="Photo of a meal" title="Photo of a meal">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
    </button>
  </div>
  <input bind:this={fileInput} type="file" accept="image/*" capture="environment" onchange={onPhoto} hidden>
  {#if photoAsk}
    <button class="btn bp lg-ask" onclick={() => { photoAsk = false; photo('meal'); }}>Take a photo of your meal</button>
  {/if}

  {#if snap && !working}
    <div class="lg-snap">
      <img src={snap} alt="Your meal" />
      <div class="lg-snap-in">
        <input bind:value={snapWords} placeholder="A few words, if you like: what it is, how much" aria-label="What's in the photo (optional)" enterkeyhint="send"
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendSnap(); } }} />
        <div class="lg-snap-row"><button class="btn bp bsm" onclick={sendSnap}>Estimate</button><button class="lg-snap-x" onclick={() => (snap = null)}>Cancel</button></div>
      </div>
    </div>
  {/if}
  {#if working}<div class="lg-working" aria-live="polite"><span class="lg-dot"></span>{working}</div>{/if}
  {#if notice}<div class="lg-notice" aria-live="polite">{notice}</div>{/if}
  {#if retryPhoto && !working && !pending}
    <div class="lg-miss"><button class="btn bp" onclick={() => retryPhoto && readPhoto(retryPhoto.image, retryPhoto.mode)}>Try the same photo again</button></div>
  {/if}
  {#if missBarcode && !pending}
    <div class="lg-miss">
      <button class="btn bp" onclick={() => photo('label')}>Snap its nutrition table</button>
      <span>It's saved with the barcode, so the next scan finds it instantly.</span>
    </div>
  {/if}

  {#if pending && result}
    <!-- REVIEW: every path lands here. -->
    <div class="lg-review">
      {#if pending.kind === 'manual'}
        <input class="lg-name" bind:value={pending.name} placeholder="Food name">
        <div class="lg-manual">
          <label><span>kcal</span><input type="number" inputmode="decimal" bind:value={pending.kcal}></label>
          <label><span>protein</span><input type="number" inputmode="decimal" bind:value={pending.p}></label>
          <label><span>carbs</span><input type="number" inputmode="decimal" bind:value={pending.c}></label>
          <label><span>fat</span><input type="number" inputmode="decimal" bind:value={pending.f}></label>
        </div>
      {:else}
        {#if pending.kind === 'food'}
          <div class="lg-title">{displayName(pending.c)}</div>
          <div class="lg-src">
            {#if pending.c.key.startsWith('l:')}From the label
            {:else if pending.c.source === 'history'}Yours · logged {pending.c.count}×
            {:else if pending.c.source === 'builtin'}Basic food · per 100 {unit(pending.c)}: {macroLine(pending.c.per100!)}
            {:else if pending.c.source === 'usda'}USDA FoodData Central{#if pending.c.per100}{' · '}per 100 {unit(pending.c)}: {macroLine(pending.c.per100)}{/if}
            {:else}Open Food Facts{pending.c.local ? ' · sold in SK/CZ' : ''}{#if pending.c.per100}{' · '}per 100 {unit(pending.c)}: {macroLine(pending.c.per100)}{/if}{/if}
          </div>
          {#if pending.c.per100 && pending.grams != null}
            <div class="lg-portions">
              {#each pending.c.servings as s (s.label + s.g)}
                <button class="chip" class:on={pending.grams === s.g} onclick={() => { if (pending?.kind === 'food') pending.grams = s.g; }}>{s.label} · {s.g} {unit(pending.c)}</button>
              {/each}
              {#if !pending.c.servings.some((s) => s.g === 100)}
                <button class="chip" class:on={pending.grams === 100} onclick={() => { if (pending?.kind === 'food') pending.grams = 100; }}>100 {unit(pending.c)}</button>
              {/if}
              <label class="lg-grams"><input type="number" inputmode="decimal" min="0" bind:value={pending.grams} aria-label="Amount"><span>{unit(pending.c)}</span></label>
            </div>
          {:else}
            <div class="lg-portions">
              {#each [0.5, 1, 1.5, 2] as k}
                <button class="chip" class:on={pending.mult === k} onclick={() => { if (pending?.kind === 'food') pending.mult = k; }}>{k === 0.5 ? '½' : k === 1.5 ? '1½' : k}×</button>
              {/each}
            </div>
          {/if}
        {:else}
          <input class="lg-name" bind:value={pending.name} aria-label="Name">
          <div class="lg-src">{pending.note}</div>
          <ul class="lg-items">
            {#each pending.items as it, i (i)}
              <li>
                <span class="lg-it-n">{it.name}{#if it.grams && !/\d\s*(g|ml)\b/i.test(it.name)}<em> · {Math.round(it.grams)} g</em>{/if}</span>
                <span class="lg-it-k">{Math.round(it.kcal)}</span>
                {#if pending.items.length > 1}
                  <button class="lg-it-x" aria-label="Remove {it.name}" onclick={() => { if (pending?.kind === 'meal') pending.items = pending.items.filter((_, j) => j !== i); }}>×</button>
                {/if}
              </li>
            {/each}
          </ul>
          <div class="lg-portions">
            {#each [0.5, 1, 1.5, 2] as k}
              <button class="chip" class:on={pending.mult === k} onclick={() => { if (pending?.kind === 'meal') pending.mult = k; }}>{k === 0.5 ? '½' : k === 1.5 ? '1½' : k}×</button>
            {/each}
          </div>
        {/if}
        <div class="lg-total">
          <b>{result.kcal}</b><span>kcal</span>
          <i>{Math.round(result.protein_g)} P</i><i>{Math.round(result.carbs_g)} C</i><i>{Math.round(result.fat_g)} F</i>
        </div>
      {/if}
      {#if result.kcal === 0 && pending.kind !== 'manual'}<div class="lg-warn">0 kcal — check the amount before logging.</div>{/if}
      <div class="lg-actions">
        <button class="btn bg_" onclick={reset} disabled={saving}>Cancel</button>
        <button class="btn bp" onclick={logPending} disabled={saving || (pending.kind === 'manual' && !pending.name.trim())}>{saving ? 'Logging…' : 'Log it'}</button>
      </div>
    </div>
  {:else if hasQuery}
    <div class="lg-results">
      <button class="lg-row lg-ai" onclick={describe} disabled={!!working}>
        <span>✨ Estimate “{query.trim()}”</span><em>AI · understands whole meals</em>
      </button>
      {#if local.mine.length}
        <div class="lg-sec">Yours</div>
        {#each local.mine as c (c.key)}
          <button class="lg-row" onclick={() => pick(c)}>
            <span>{c.name}</span><em>{c.portion ? `${Math.round(c.portion.kcal)} kcal · ${Math.round(c.portion.protein_g)} P` : ''} · {c.count}×</em>
          </button>
        {/each}
      {/if}
      {#if local.basics.length}
        <div class="lg-sec">Basics</div>
        {#each local.basics as c (c.key)}
          <button class="lg-row" onclick={() => pick(c)}>
            <span>{c.name}</span><em>{c.per100?.kcal} kcal · {c.per100?.protein_g} P /100 {unit(c)}</em>
          </button>
        {/each}
      {/if}
      <div class="lg-sec">Products {#if productState === 'loading'}<span class="lg-spin">searching…</span>{/if}</div>
      {#if productState === 'error'}
        <div class="lg-empty">Product search is unreachable — basics and ✨ still work.</div>
      {:else if products.length}
        {#each products as c (c.key)}
          <button class="lg-row" onclick={() => pick(c)}>
            <span>{displayName(c)}{#if c.local}<b class="lg-flag">SK/CZ</b>{/if}</span>
            <em>{c.per100 ? `${c.per100.kcal} kcal · ${c.per100.protein_g} P /100 ${unit(c)}` : 'no nutrition data'}</em>
          </button>
        {/each}
      {:else if productState === 'idle'}
        <div class="lg-empty">No packaged products match.</div>
      {/if}
      <button class="lg-row lg-manual-row" onclick={manual}><span>✎ Enter the numbers myself</span></button>
    </div>
  {:else if fillers.length || staples.length || yesterdayLeft.length || meals.length || usuals.length}
    <!-- Empty box: the taps that replace typing, all from your own history. -->
    <div class="lg-quick">
      {#if fillers.length}
        <!-- Protein first: the gap the whole plan hinges on, closed in a tap
             with food already eaten three times or more. -->
        <div class="lg-protein"><b>Fastest protein</b> from your usuals</div>
        <div class="lg-chips">
          {#each fillers as f (f.name)}
            <button class="lg-chip lg-chip-p" disabled={saving} onclick={() => quick([f], f.name)}>
              <b>{f.name}</b><em>{Math.round(f.protein_g)} P · {Math.round(f.kcal)} kcal</em>
            </button>
          {/each}
        </div>
      {/if}
      {#if staples.length}
        <div class="lg-chips">
          {#each staples as f (f.name)}
            <button class="lg-chip" disabled={saving} onclick={() => quick([f], f.name)}>
              <b>{f.name}</b><em>{Math.round(f.kcal)} kcal · {Math.round(f.protein_g)} P</em>
            </button>
          {/each}
        </div>
      {/if}
      {#each usuals as m (m.key)}
        <button class="lg-row" disabled={saving} onclick={() => quick(m.left, `usual ${m.label.toLowerCase()}`)}>
          <span>★ Your usual {m.label.toLowerCase()}</span><em>{Math.round(m.left.reduce((s, f) => s + f.kcal, 0))} kcal — {m.left.map((i) => i.name).join(', ')}</em>
        </button>
      {/each}
      {#if yesterdayLeft.length}
        <button class="lg-row" disabled={saving} onclick={() => quick(yesterdayLeft, 'yesterday')}>
          <span>↺ Repeat yesterday</span><em>{yesterdayLeft.length} items · {Math.round(yesterdayLeft.reduce((s, f) => s + f.kcal, 0))} kcal</em>
        </button>
      {/if}
      {#each meals as m (m.key)}
        <button class="lg-row" disabled={saving} onclick={() => quick(m.items, m.label.toLowerCase())}>
          <span>↺ Yesterday’s {m.label.toLowerCase()}</span><em>{m.kcal} kcal · {m.protein_g} P — {m.items.map((i) => i.name).join(', ')}</em>
        </button>
      {/each}
      <button class="lg-link" onclick={() => photo('label')}>Packaged food with no barcode? Photograph its nutrition table →</button>
    </div>
  {/if}
</section>

{#if scanning}
  <BarcodeScanner onCode={onScanned} onClose={() => (scanning = false)} />
{/if}

<style>
  .logger{margin-bottom:14px}
  .lg-box{display:flex;align-items:center;gap:6px;background:var(--bg2);border:1.5px solid var(--border2);border-radius:var(--r-lg,14px);padding:5px 5px 5px 14px;transition:border-color .15s}
  .lg-box:focus-within{border-color:var(--text)}
  .lg-box.busy{border-color:var(--led-ok,#4da3ff)}
  .lg-input{flex:1;min-width:0;background:none;border:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;padding:10px 0;font-size:1.0625rem;color:var(--text)}
  .lg-input:focus{box-shadow:none}
  .lg-icon{flex-shrink:0;width:44px;height:44px;border-radius:var(--r-md,10px);border:1px solid var(--border);background:var(--bg3);color:var(--text);display:grid;place-items:center;cursor:pointer}
  .lg-icon:active{transform:scale(.94)}
  .lg-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .lg-working{display:flex;align-items:center;gap:8px;font-size:0.8125rem;color:var(--muted);padding:10px 4px 0}
  .lg-dot{width:8px;height:8px;border-radius:50%;background:var(--led-ok,#4da3ff);animation:lgpulse 1s ease-in-out infinite}
  @keyframes lgpulse{50%{opacity:.25}}
  @media (prefers-reduced-motion:reduce){.lg-dot{animation:none}}
  .lg-notice{font-size:0.8125rem;color:var(--text);padding:10px 4px 0;line-height:1.45}
  .lg-miss{display:flex;flex-direction:column;gap:6px;padding-top:10px}
  .lg-snap{display:flex;gap:10px;align-items:flex-start;padding-top:10px}
  .lg-snap img{width:72px;height:72px;object-fit:cover;border-radius:var(--r-md);flex-shrink:0}
  .lg-snap-in{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
  .lg-snap-in input{width:100%}
  .lg-snap-row{display:flex;align-items:center;gap:12px}
  .lg-snap-x{background:none;border:none;font:inherit;font-size:0.8125rem;font-weight:700;color:var(--muted);cursor:pointer;text-decoration:underline}
  .lg-miss span{font-size:0.75rem;color:var(--muted)}

  .lg-protein{font-size:0.8125rem;color:var(--muted);padding:8px 8px 2px}
  .lg-protein b{color:var(--text)}
  .lg-chip-p em{color:var(--led-good)}
  .lg-results,.lg-quick,.lg-review{margin-top:8px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-lg,14px);padding:4px;overflow:hidden}
  .lg-sec{font-family:var(--font-label);font-size:0.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:12px 10px 4px}
  .lg-spin{font-family:var(--font-body,inherit);letter-spacing:0;text-transform:none;font-weight:600;color:var(--led-ok,#4da3ff)}
  .lg-row{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;background:none;border:none;border-radius:var(--r-md,10px);padding:10px;text-align:left;cursor:pointer;color:var(--text);font-family:inherit}
  .lg-row:active,.lg-row:hover{background:var(--bg3)}
  .lg-row:disabled{opacity:.5}
  .lg-row span{font-size:0.9375rem;font-weight:650;line-height:1.3}
  .lg-row em{font-style:normal;font-size:0.75rem;color:var(--muted);line-height:1.35}
  .lg-ai span{color:var(--text)}
  .lg-ai{border-bottom:1px solid var(--border);border-radius:var(--r-md,10px) var(--r-md,10px) 0 0}
  .lg-flag{font-size:0.6875rem;font-weight:800;margin-left:6px;padding:1px 5px;border-radius:4px;background:var(--bg3);color:var(--muted)}
  .lg-empty{font-size:0.8125rem;color:var(--muted);padding:6px 10px 10px}
  .lg-manual-row{border-top:1px solid var(--border);border-radius:0 0 var(--r-md,10px) var(--r-md,10px);margin-top:4px}
  .lg-manual-row span{font-weight:600;color:var(--muted)}

  .lg-chips{display:flex;gap:6px;overflow-x:auto;padding:6px 6px 8px;scrollbar-width:none}
  .lg-chips::-webkit-scrollbar{display:none}
  .lg-chip{flex:0 0 auto;max-width:180px;display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r-md,10px);padding:8px 11px;cursor:pointer;font-family:inherit}
  .lg-chip:active{transform:scale(.95)}
  .lg-chip b{font-size:0.8125rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .lg-chip em{font-style:normal;font-size:0.6875rem;color:var(--muted);white-space:nowrap}
  .lg-link{display:block;width:100%;background:none;border:none;border-top:1px solid var(--border);padding:11px 10px;text-align:left;font-size:0.75rem;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit}

  .lg-review{padding:14px}
  .lg-title{font-size:1.0625rem;font-weight:800;color:var(--text);line-height:1.25}
  .lg-name{font-size:1rem;font-weight:700;margin-bottom:4px}
  .lg-src{font-size:0.75rem;color:var(--muted);margin:3px 0 10px;line-height:1.4}
  .lg-portions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px}
  .chip{background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:999px;padding:7px 12px;font-size:0.8125rem;font-weight:650;cursor:pointer;font-family:inherit}
  .chip.on{background:var(--amber);color:var(--bg);border-color:var(--amber)}
  .lg-grams{display:flex;align-items:center;gap:4px}
  .lg-grams input{width:84px;padding:7px 9px;text-align:right}
  .lg-grams span{font-size:0.8125rem;color:var(--muted)}
  .lg-items{list-style:none;margin:0 0 10px;padding:0;border-top:1px solid var(--border)}
  .lg-items li{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.8125rem}
  .lg-it-n{flex:1;min-width:0;color:var(--text)}
  .lg-it-n em{font-style:normal;color:var(--muted)}
  .lg-it-k{font-variant-numeric:lining-nums tabular-nums;color:var(--muted)}
  .lg-it-x{background:none;border:none;color:var(--muted);font-size:1.125rem;cursor:pointer;width:32px;height:32px}
  .lg-total{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:2px 0 12px}
  .lg-total b{font-family:var(--font-display);font-size:2.25rem;font-weight:700;letter-spacing:-.02em;line-height:1;color:var(--text);font-variant-numeric:lining-nums tabular-nums}
  .lg-total span{font-size:0.8125rem;color:var(--muted);margin-right:6px}
  .lg-total i{font-style:normal;font-size:0.875rem;font-weight:700;color:var(--text);background:var(--bg3);border-radius:6px;padding:3px 7px;font-variant-numeric:lining-nums tabular-nums}
  .lg-manual{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0 12px}
  .lg-manual label{display:flex;flex-direction:column;gap:3px}
  .lg-manual span{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .lg-manual input{padding:9px 8px;text-align:center}
  .lg-warn{font-size:0.75rem;color:var(--led-warn,#ffb020);margin:-4px 0 10px}
  .lg-actions{display:grid;grid-template-columns:1fr 2fr;gap:8px}
  .lg-ask{display:block;width:100%;margin:10px 0 2px;min-height:48px}
</style>
