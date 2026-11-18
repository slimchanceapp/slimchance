<script lang="ts">
  // A body weight, typed in the person's own unit. Binds `kg`: null until what
  // is typed is a weight. Kilograms and pounds take one box (a comma decimal
  // works too); stone takes two, stones and pounds, as UK scales show it.
  import { fromStLb, parseWt, toStLb, unitWord, weightUnit, wtNum } from '$lib/units';

  let { kg = $bindable(null), id = '', hint = null, label = 'Weight', autofocus = false, onenter, onblur, class: cls = '' }: {
    kg?: number | null; id?: string;
    /** A weight to show greyed in the empty box, in kg (the trend, say). */
    hint?: number | null;
    label?: string; autofocus?: boolean; onenter?: () => void; onblur?: () => void; class?: string;
  } = $props();

  const u = weightUnit();
  let a = $state('');
  let b = $state('');
  // The last value this box handed out, so a change made by the parent (a
  // reset after saving, a prefill) is told apart from the person typing.
  let emitted: number | null | undefined = undefined;

  function show(v: number | null) {
    if (v == null) { a = ''; b = ''; return; }
    if (u === 'st') { const s = toStLb(v); a = String(s.st); b = String(s.lb); }
    else a = wtNum(v);
  }
  $effect(() => {
    const v = kg;
    if (v !== emitted) { emitted = v; show(v); }
  });

  function typed() {
    let v: number | null;
    if (u === 'st') {
      const st = Number(a.trim() || 0), lbs = Number(b.trim().replace(',', '.') || 0);
      v = (a.trim() || b.trim()) && Number.isFinite(st) && Number.isFinite(lbs) ? Math.round(fromStLb(st, lbs) * 100) / 100 : null;
      if (v != null && (v < 20 || v > 400)) v = null;
    } else v = parseWt(a);
    emitted = v;
    kg = v;
  }
  const key = (e: KeyboardEvent) => { if (e.key === 'Enter') onenter?.(); };
  const hintSt = $derived(hint != null ? toStLb(hint) : null);
</script>

{#if u === 'st'}
  <span class="wi-st {cls}">
    <!-- svelte-ignore a11y_autofocus -->
    <input {id} type="text" inputmode="numeric" autocomplete="off" bind:value={a} oninput={typed} onkeydown={key} {onblur} {autofocus}
      placeholder={hintSt ? String(hintSt.st) : ''} aria-label={`${label}, stone`}>
    <span class="wi-u" aria-hidden="true">st</span>
    <input type="text" inputmode="decimal" autocomplete="off" bind:value={b} oninput={typed} onkeydown={key} {onblur}
      placeholder={hintSt ? String(hintSt.lb) : ''} aria-label={`${label}, pounds`}>
    <span class="wi-u" aria-hidden="true">lb</span>
  </span>
{:else}
  <!-- svelte-ignore a11y_autofocus -->
  <input {id} class={cls} type="text" inputmode="decimal" autocomplete="off" bind:value={a} oninput={typed} onkeydown={key} {onblur} {autofocus}
    placeholder={hint != null ? wtNum(hint) : unitWord()} aria-label={`${label}, ${unitWord()}`}>
{/if}

<style>
  .wi-st{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
  .wi-st input{flex:1;min-width:0;text-align:center}
  .wi-u{font-size:0.8125rem;font-weight:700;color:var(--muted)}
</style>
