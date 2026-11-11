<script lang="ts">
  // "Bring your weigh-ins": a history from another app, a smart scale's app or
  // a spreadsheet, so the trend starts on day one. The file is read on this
  // device (src/lib/importWeights.ts); one reading a day is saved; a day
  // already logged here is never changed; and the whole import can be undone.
  // An Apple Health export can be hundreds of megabytes, so it's read in
  // pieces rather than all at once.
  import Modal from './Modal.svelte';
  import { appleParsed, appleRecords, guessUnit, parseWeightFile, readingsFrom, type ParsedFile, type RawReading } from '$lib/body';
  import { upsertRecords } from '$lib/stores/sync';
  import { supabase } from '$lib/db/client';
  import db from '$lib/db/dexie';
  import { userId } from '$lib/stores/user';
  import { weightUnit, wt } from '$lib/units';

  let { open = false, onclose }: { open?: boolean; onclose: () => void } = $props();

  const own: 'kg' | 'lb' = weightUnit() === 'kg' ? 'kg' : 'lb';
  let parsed = $state<ParsedFile | null>(null);
  let fileName = $state('');
  let unit = $state<'kg' | 'lb'>(own);
  let dayFirst = $state(true);
  let existing = $state<Set<string>>(new Set());
  let reading = $state(false);
  let saving = $state(false);
  let err = $state('');
  let done = $state<{ n: number; batch: string; from: string } | null>(null);

  const day = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const readings = $derived(parsed ? readingsFrom(parsed, unit, dayFirst) : []);
  const fresh = $derived(readings.filter((r) => !existing.has(r.date)));
  const sample = $derived(parsed?.raw.find((r) => !r.unit) ?? null);

  async function readApple(f: File): Promise<ParsedFile> {
    const reader = f.stream().pipeThrough(new TextDecoderStream()).getReader();
    let rest = '';
    const raw: RawReading[] = [];
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      const o = appleRecords(rest + value);
      for (const r of o.raw) raw.push(r);
      rest = o.rest;
    }
    return appleParsed(raw);
  }

  async function pick(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    err = ''; parsed = null; done = null; fileName = f.name; reading = true;
    try {
      const p = /\.xml$/i.test(f.name) || f.size > 20e6 ? await readApple(f) : parseWeightFile(await f.text());
      if (!p.raw.length) {
        err = /\.(zip|xlsx?)$/i.test(f.name)
          ? 'That file is packed (a .zip or a spreadsheet). Unzip it, or save the weight sheet as CSV, then choose that.'
          : 'No weigh-ins found in that file. It needs a date and a weight on each line.';
        return;
      }
      unit = guessUnit(p, own);
      dayFirst = p.dayFirst ?? !/^en-US/i.test(navigator.language);
      existing = new Set((await db.table('weights').where('user_id').equals($userId).toArray()).map((w: any) => w.date));
      parsed = p;
    } catch (e: any) {
      err = 'Could not read that file: ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      reading = false;
    }
  }

  async function save() {
    const uid = $userId;
    if (!uid || !fresh.length || saving) return;
    saving = true; err = '';
    const batch = `import:${Date.now()}`;
    try {
      // Five hundred days a request: each one is saved whole or not at all,
      // and the batch name lets Undo find every one that was.
      for (let i = 0; i < fresh.length; i += 500) {
        await upsertRecords('weights', fresh.slice(i, i + 500).map((r) => ({
          user_id: uid, date: r.date, weight: r.kg, created_at: new Date(`${r.date}T07:00:00`).toISOString(), source: batch,
        })));
      }
      done = { n: fresh.length, batch, from: fresh[0].date };
    } catch (e: any) {
      done = { n: 0, batch, from: fresh[0].date };
      err = 'Part of it may not have saved: ' + (e?.message || String(e)).slice(0, 100) + '. Undo removes whatever did.';
    } finally {
      saving = false;
    }
  }

  async function undo() {
    const uid = $userId;
    if (!uid || !done) return;
    saving = true; err = '';
    try {
      const { error } = await supabase.from('weights').delete().eq('user_id', uid).eq('source', done.batch);
      if (error) throw error;
      const batch = done.batch;
      await db.table('weights').where('user_id').equals(uid).filter((w: any) => w.source === batch).delete();
      done = null; parsed = null;
    } catch (e: any) {
      err = 'Could not undo: ' + (e?.message || String(e)).slice(0, 120);
    } finally {
      saving = false;
    }
  }

  function close() { parsed = null; done = null; err = ''; onclose(); }
</script>

<Modal {open} onclose={close}>
  <div class="iw-h">Bring your weigh-ins</div>
  {#if done && done.n > 0}
    <p class="iw-p"><b>Added {done.n.toLocaleString()} mornings.</b> Your trend now goes back to {day(done.from)}.</p>
    <button class="btn bp bfl" onclick={close}>Done</button>
    <button class="btn bg_ bfl iw-gap" onclick={undo} disabled={saving}>{saving ? 'Undoing…' : 'Undo this import'}</button>
  {:else}
    <p class="iw-p">
      From another app, a smart scale's app or a spreadsheet. The file is read on this phone; only one reading a
      day is saved, and nothing you've already logged here changes.
    </p>
    <label class="btn bp bfl iw-file">
      {reading ? 'Reading…' : parsed ? 'Choose another file' : 'Choose a file'}
      <input type="file" accept=".csv,.tsv,.txt,.json,.xml,text/csv,application/json,text/xml" onchange={pick} disabled={reading} hidden>
    </label>
    <details class="iw-help">
      <summary>Where do I find my file?</summary>
      <ul>
        <li><b>Apple Health:</b> in the Health app, tap your picture, then Export All Health Data. Save it to Files, tap the zip to unzip it, and choose <i>export.xml</i>.</li>
        <li><b>Most apps</b> (Libra, Happy Scale, MyFitnessPal, Withings, Renpho, Garmin): look for Export or Download my data in Settings and choose the CSV with your weight.</li>
        <li><b>Fitbit or Google Fit:</b> Google Takeout gives weight files (<i>weight-….json</i> or a daily CSV).</li>
        <li><b>MacroFactor or a spreadsheet:</b> save the sheet with dates and weights as CSV.</li>
      </ul>
    </details>

    {#if parsed}
      <div class="iw-card">
        <div><b>{readings.length.toLocaleString()} mornings</b>{#if readings.length}, {day(readings[0].date)} to {day(readings[readings.length - 1].date)}{/if} <span class="iw-src">· {parsed.format} · {fileName}</span></div>
        {#if readings.length}<div class="iw-sub">First {wt(readings[0].kg)}, latest {wt(readings[readings.length - 1].kg)}.</div>{/if}
        {#if readings.length > fresh.length}<div class="iw-sub">{(readings.length - fresh.length).toLocaleString()} of those days are already in Slim Chance; yours are kept.</div>{/if}
      </div>

      {#if !parsed.unit && sample}
        <div class="iw-q">
          <div class="iw-ql">The file doesn't say. {sample.value} is…</div>
          <div class="iw-opts">
            <button class="iw-opt" class:on={unit === 'kg'} onclick={() => (unit = 'kg')}>{sample.value} kg</button><!-- units-ok: the question is which unit -->
            <button class="iw-opt" class:on={unit === 'lb'} onclick={() => (unit = 'lb')}>{sample.value} lb</button>
          </div>
        </div>
      {/if}
      {#if parsed.dateOrderUnclear}
        <div class="iw-q">
          <div class="iw-ql">A date like 03/04/2024 means…</div>
          <div class="iw-opts">
            <button class="iw-opt" class:on={dayFirst} onclick={() => (dayFirst = true)}>3 April</button>
            <button class="iw-opt" class:on={!dayFirst} onclick={() => (dayFirst = false)}>March 4</button>
          </div>
        </div>
      {/if}

      <button class="btn bp bfl iw-gap" onclick={save} disabled={saving || !fresh.length}>
        {saving ? 'Adding…' : fresh.length ? `Add ${fresh.length.toLocaleString()} mornings` : 'Nothing new to add'}
      </button>
    {/if}
  {/if}
  {#if err}<div class="iw-err" role="alert">{err}</div>{/if}
</Modal>

<style>
  .iw-h{font-family:var(--font-display);font-size:1.5rem;font-weight:700;color:var(--text);margin-bottom:8px}
  .iw-p{font-size:0.875rem;line-height:1.5;color:var(--text);margin:0 0 14px}
  .iw-file{cursor:pointer}
  .iw-gap{margin-top:10px}
  .iw-help{margin:12px 0 4px;font-size:0.8125rem;color:var(--muted)}
  .iw-help summary{cursor:pointer;font-weight:700;color:var(--text)}
  .iw-help ul{margin:8px 0 0;padding-left:1.1rem;line-height:1.5}
  .iw-help li{margin:6px 0}
  .iw-card{margin-top:14px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r-md);padding:12px;font-size:0.875rem;color:var(--text);line-height:1.5}
  .iw-src{color:var(--muted);font-size:0.75rem;word-break:break-all}
  .iw-sub{color:var(--muted);font-size:0.8125rem;margin-top:4px}
  .iw-q{margin-top:12px}
  .iw-ql{font-size:0.8125rem;font-weight:700;color:var(--text);margin-bottom:6px}
  .iw-opts{display:flex;gap:8px}
  .iw-opt{flex:1;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r-sm);padding:10px;font:inherit;font-weight:700;color:var(--text);cursor:pointer}
  .iw-opt.on{border-color:var(--amber);background:var(--ab)}
  .iw-err{font-size:0.8125rem;color:var(--led-bad);margin-top:10px;line-height:1.45}
</style>
