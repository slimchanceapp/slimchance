<script lang="ts">
  // The GLP-1 companion (free, like everything: decision 0001): the medication
  // as the person's prescriber set it, each dose with where it went in, and how
  // they feel. A tracker only: it keeps what the person types and never advises
  // a dose (src/lib/meds.ts).
  import PageHero from '$lib/components/PageHero.svelte';
  import { liveMedications, liveMedEvents } from '$lib/stores/live';
  import { upsertRecord } from '$lib/stores/sync';
  import { userId } from '$lib/stores/user';
  import { todayDate } from '$lib/stores/refresh';
  import { supabase } from '$lib/db/client';
  import db from '$lib/db/dexie';
  import { localTz } from '$lib/reminder';
  import { FEELINGS, SEVERITY, PRESCRIBER_LINE, LAB_TESTS, nextDose, sitesByRest, needsPrescriber, medAlarm, dayWord, labResults, labLine, proteinAverage, reportText, type Med, type MedEvent } from '$lib/meds';
  import { body, fitness, trendSeries } from '$lib/stores/body';
  import { deliverText } from '$lib/shareFile';
  import { weightUnit } from '$lib/units';

  const _meds = liveMedications();
  const _events = liveMedEvents();
  const today = $derived($todayDate as string);
  const med = $derived(((($_meds as Med[]) ?? []).find((m) => !m.stopped)) ?? null);
  const events = $derived((($_events as MedEvent[]) ?? []));
  const next = $derived(med ? nextDose(med, events, today) : null);
  const sites = $derived(sitesByRest(events));
  const record = $derived([...events].reverse().slice(0, 30));
  const labs = $derived(labResults(events));
  const proteinAvg = $derived(proteinAverage(Array.from($body.intake, ([date, d]) => ({ date, protein: d.protein })), today));
  const report = $derived(med ? reportText({
    med, events, today, trend: $trendSeries, proteinAvgG: proteinAvg, proteinTargetG: $body.proteinTargetG,
    training: $fitness.signs.find((x) => x.key === 'training')?.text ?? null, unit: weightUnit(),
  }) : '');
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let busy = $state(false);
  let err = $state('');

  // ── The medication ──
  let editing = $state(false);
  let name = $state('');
  let dose = $state<number | null>(null);
  let unit = $state('mg');
  let weekly = $state(true);
  let weekday = $state(new Date().getDay());
  let time = $state('09:00');

  function edit() {
    if (med) {
      name = med.name; dose = med.dose; unit = med.unit; weekly = med.every_days === 7;
      weekday = med.weekday ?? new Date().getDay(); time = med.time ?? '';
    }
    editing = true;
  }

  async function saveMed(changes: Partial<Med> = {}) {
    if (!$userId) return;
    busy = true; err = '';
    const row = {
      id: med?.id ?? crypto.randomUUID(), user_id: $userId,
      name: name.trim() || med?.name || '', dose, unit,
      every_days: weekly ? 7 : 1, weekday: weekly ? weekday : null, time: time || null,
      started: med?.started ?? today, stopped: null as string | null,
      updated_at: new Date().toISOString(), ...changes,
    };
    try {
      await upsertRecord('medications', row);
      editing = false;
    } catch (e: any) {
      err = `Couldn't save: ${e?.message ?? e}`;
      busy = false;
      return;
    }
    // Its reminder rides the alarms the app already delivers on both phones.
    try { await upsertRecord('alarms', medAlarm(row, $userId, localTz() ?? 'UTC')); }
    catch (e: any) { err = `Saved. The reminder couldn't be set: ${e?.message ?? e}`; }
    busy = false;
  }

  function stop() {
    if (!med) return;
    name = med.name; dose = med.dose; unit = med.unit; weekly = med.every_days === 7;
    weekday = med.weekday ?? 0; time = med.time ?? '';
    saveMed({ stopped: today });
  }

  // ── A dose ──
  let doseOpen = $state(false);
  let doseDate = $state('');
  let doseAmt = $state<number | null>(null);
  let site = $state<string | null>(null);

  function openDose() {
    doseDate = today; doseAmt = med?.dose ?? null; site = sites[0]?.site ?? null; doseOpen = true;
  }

  async function saveDose() {
    if (!$userId || !med || !doseDate) return;
    busy = true; err = '';
    try {
      await upsertRecord('med_events', { id: crypto.randomUUID(), user_id: $userId, med_id: med.id, kind: 'dose', date: doseDate, dose: doseAmt, site, note: '' });
      doseOpen = false;
    } catch (e: any) { err = `Couldn't save the dose: ${e?.message ?? e}`; }
    busy = false;
  }

  // ── How they feel ──
  let symptom = $state<string | null>(null);
  let severity = $state<number | null>(null);
  const flagged = $derived(needsPrescriber({ symptom, severity }) || events.some((e) => e.kind === 'effect' && e.date === today && needsPrescriber(e)));

  async function saveFeeling() {
    if (!$userId || !symptom || !severity) return;
    busy = true; err = '';
    try {
      await upsertRecord('med_events', { id: crypto.randomUUID(), user_id: $userId, med_id: med?.id ?? null, kind: 'effect', date: today, symptom, severity, note: '' });
      symptom = null; severity = null;
    } catch (e: any) { err = `Couldn't save: ${e?.message ?? e}`; }
    busy = false;
  }

  // ── A blood test, as typed from the lab report ──
  let labOpen = $state(false);
  let labTest = $state('');
  let labValue = $state<number | null>(null);
  let labUnit = $state('');
  let labLow = $state<number | null>(null);
  let labHigh = $state<number | null>(null);
  let labDate = $state('');

  function openLab() {
    labTest = ''; labValue = null; labUnit = ''; labLow = null; labHigh = null; labDate = today; labOpen = true;
  }

  async function saveLab() {
    if (!$userId || !labTest.trim() || labValue == null || !labDate) return;
    busy = true; err = '';
    try {
      await upsertRecord('med_events', {
        id: crypto.randomUUID(), user_id: $userId, med_id: null, kind: 'lab', date: labDate,
        test: labTest.trim(), value: labValue, unit: labUnit.trim() || null, ref_low: labLow, ref_high: labHigh, note: '',
      });
      labOpen = false;
    } catch (e: any) { err = `Couldn't save the result: ${e?.message ?? e}`; }
    busy = false;
  }

  // ── The report ──
  let reportOpen = $state(false);
  let shared = $state('');
  async function share() {
    const r = await deliverText('Medication record', report);
    shared = r.method === 'clipboard' ? 'Copied. Paste it into an email or a message.' : r.method === 'failed' ? `Couldn't share it: ${r.error}` : '';
  }

  async function remove(e: MedEvent) {
    await db.table('med_events').delete(e.id);
    const { error } = await supabase.from('med_events').delete().eq('id', e.id);
    if (error) err = `Couldn't delete: ${error.message}`;
  }
</script>

<PageHero title="Medication" sub="GLP-1 companion" />

<p class="md-note">A record for you and your doctor: it keeps what you type, and never advises a dose.</p>

{#if !med || editing}
  <div class="card">
    <div class="card-lbl">{med ? 'Your medication' : 'Add your medication'}</div>
    <label class="md-f"><span>Name</span><input bind:value={name} placeholder="As you call it" autocomplete="off" /></label>
    <div class="md-two">
      <label class="md-f"><span>Dose, as prescribed</span><input type="number" inputmode="decimal" step="any" min="0" bind:value={dose} /></label>
      <label class="md-f"><span>Unit</span>
        <select bind:value={unit}><option>mg</option><option>mcg</option><option>ml</option><option>units</option></select>
      </label>
    </div>
    <div class="md-f"><span>How often</span>
      <div class="md-chips">
        <button class="chip" class:on={weekly} onclick={() => (weekly = true)}>Once a week</button>
        <button class="chip" class:on={!weekly} onclick={() => (weekly = false)}>Every day</button>
      </div>
    </div>
    <div class="md-two">
      {#if weekly}
        <label class="md-f"><span>On</span>
          <select bind:value={weekday}>{#each DAYS as d, i}<option value={i}>{d}</option>{/each}</select>
        </label>
      {/if}
      <label class="md-f"><span>Reminder at</span><input type="time" bind:value={time} /></label>
    </div>
    <button class="btn bp bfl" disabled={busy || !name.trim()} onclick={() => saveMed()}>{med ? 'Save' : 'Start the record'}</button>
    {#if med}<button class="btn bg_ bfl" onclick={() => (editing = false)}>Cancel</button>{/if}
  </div>
{:else}
  <div class="card">
    <div class="card-lbl">{med.name}{med.dose != null ? ` · ${med.dose} ${med.unit}` : ''}</div>
    {#if next}
      <p class="md-next">
        {#if next.doneToday}<b>Logged today.</b> Next {dayWord(next.date, today)}.
        {:else if next.inDays < 0}By your schedule it was due {dayWord(next.date, today)}.
        {:else if next.inDays === 0}<b>Due today.</b>
        {:else}Next: <b>{dayWord(next.date, today)}</b>.{/if}
      </p>
    {/if}
    {#if !doseOpen}<button class="btn bp bfl" onclick={openDose}>Log a dose</button>{/if}
    <div class="md-row">
      <button class="btn bg_ bsm" onclick={edit}>The dose changed</button>
      <button class="btn bg_ bsm" disabled={busy} onclick={stop}>I stopped taking it</button>
    </div>
  </div>

  {#if doseOpen}
    <div class="card">
      <div class="card-lbl">The dose</div>
      <div class="md-two">
        <label class="md-f"><span>Day</span><input type="date" bind:value={doseDate} max={today} /></label>
        <label class="md-f"><span>Amount ({med.unit})</span><input type="number" inputmode="decimal" step="any" min="0" bind:value={doseAmt} /></label>
      </div>
      <div class="md-f"><span>Where it went in</span>
        <div class="md-sites">
          {#each sites as s, i (s.site)}
            <button class="chip md-site" class:on={site === s.site} onclick={() => (site = s.site)}>
              {s.site}<small>{s.last ? `last ${dayWord(s.last, today)}` : 'not used yet'}{i === 0 && sites.some((x) => x.last) ? ' · rested longest' : ''}</small>
            </button>
          {/each}
        </div>
      </div>
      <button class="btn bp bfl" disabled={busy || !doseDate} onclick={saveDose}>Save the dose</button>
      <button class="btn bg_ bfl" onclick={() => (doseOpen = false)}>Cancel</button>
    </div>
  {/if}
{/if}

<h3>How you feel</h3>
<div class="card">
  <div class="md-chips">
    {#each FEELINGS as f}<button class="chip" class:on={symptom === f} onclick={() => (symptom = symptom === f ? null : f)}>{f}</button>{/each}
  </div>
  {#if symptom}
    <div class="md-chips md-sev">
      {#each SEVERITY as s, i}<button class="chip" class:on={severity === i + 1} onclick={() => (severity = i + 1)}>{s}</button>{/each}
    </div>
    <button class="btn bp bfl" disabled={busy || !severity} onclick={saveFeeling}>Save how you feel</button>
  {/if}
  <div class="alert aw md-call" class:md-loud={flagged}><b>{flagged ? 'Call your prescriber' : 'When to call your prescriber'}</b>{PRESCRIBER_LINE}</div>
</div>

{#if err}<p class="md-err">{err}</p>{/if}

<h3>Blood tests</h3>
<div class="card">
  {#each labs as t (t.test)}
    <div class="md-lab">
      <div class="md-lab-t">{t.test} <span class="md-d">{dayWord(t.results[0].date, today)}</span></div>
      <div class="md-lab-v">{labLine(t.results[0])}</div>
      {#if t.results.length > 1}<div class="md-lab-h">Before: {t.results.slice(1, 4).map((r) => `${r.value} on ${dayWord(r.date, today)}`).join(' · ')}</div>{/if}
    </div>
  {:else}
    <p class="md-none">None yet. Type results in from the lab report, with the range the lab printed beside them.</p>
  {/each}
  {#if labOpen}
    <div class="md-chips md-sev">
      {#each LAB_TESTS as t}<button class="chip" class:on={labTest === t.test} onclick={() => { labTest = t.test; labUnit = t.unit; }}>{t.test}</button>{/each}
    </div>
    <label class="md-f"><span>Test</span><input bind:value={labTest} placeholder="As on the lab report" autocomplete="off" /></label>
    <div class="md-two">
      <label class="md-f"><span>Result</span><input type="number" inputmode="decimal" step="any" bind:value={labValue} /></label>
      <label class="md-f"><span>Unit</span><input bind:value={labUnit} autocomplete="off" /></label>
    </div>
    <div class="md-two">
      <label class="md-f"><span>Lab range from</span><input type="number" inputmode="decimal" step="any" bind:value={labLow} /></label>
      <label class="md-f"><span>to</span><input type="number" inputmode="decimal" step="any" bind:value={labHigh} /></label>
    </div>
    <label class="md-f"><span>Day of the test</span><input type="date" bind:value={labDate} max={today} /></label>
    <button class="btn bp bfl" disabled={busy || !labTest.trim() || labValue == null || !labDate} onclick={saveLab}>Save the result</button>
    <button class="btn bg_ bfl" onclick={() => (labOpen = false)}>Cancel</button>
  {:else}
    <button class="btn bg_ bfl md-add" onclick={openLab}>Add a result</button>
  {/if}
</div>

{#if med}
  <h3>Keeping muscle</h3>
  <div class="card">
    <p class="md-none">Losing weight fast, the body loses some muscle along with the fat. Protein and strength training are what keep it.</p>
    <ul class="md-facts">
      <li>{proteinAvg != null ? `Protein: ${proteinAvg} g a day over the last two weeks, against your ${$body.proteinTargetG} g.` : 'Protein: nothing logged in the last two weeks.'}</li>
      {#each $fitness.signs.filter((x) => x.key === 'training' || x.key === 'strength') as sign}<li>{sign.text}</li>{/each}
    </ul>
  </div>

  <h3>For your doctor</h3>
  <div class="card">
    {#if reportOpen}
      <pre class="md-rep">{report}</pre>
      <button class="btn bp bfl" onclick={share}>Share it</button>
      <button class="btn bg_ bfl" onclick={() => (reportOpen = false)}>Close</button>
      {#if shared}<p class="md-none">{shared}</p>{/if}
    {:else}
      <p class="md-none">Your doses, how you felt, your tests and your weight trend since you started, as plain text to show or send.</p>
      <button class="btn bg_ bfl md-add" onclick={() => (reportOpen = true)}>Show the report</button>
    {/if}
  </div>
{/if}

{#if record.length}
  <h3>Your record</h3>
  <div class="card">
    {#each record as e (e.id)}
      <div class="md-ev">
        <span class="md-d">{dayWord(e.date, today)}</span>
        <span class="md-t">
          {#if e.kind === 'dose'}{e.dose ?? ''} {med?.unit ?? ''}{e.site ? ` · ${e.site}` : ''}
          {:else if e.kind === 'lab'}{e.test} {e.value}{e.unit ? ` ${e.unit}` : ''}
          {:else}{e.symptom} · {SEVERITY[(e.severity ?? 1) - 1].toLowerCase()}{/if}
        </span>
        <button class="md-x" aria-label="Delete this entry" onclick={() => remove(e)}>✕</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .md-note{font-size:0.8125rem;line-height:1.5;color:var(--muted);margin:-6px 0 14px}
  .md-f{display:block;margin-bottom:12px}
  .md-f > span{display:block;font-size:0.75rem;font-weight:700;color:var(--muted);margin-bottom:5px}
  .md-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .md-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .md-sev{margin-top:4px}
  .md-sites{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .chip{background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:999px;padding:7px 12px;font-size:0.8125rem;font-weight:650;cursor:pointer;font-family:inherit}
  .chip.on{background:var(--amber);color:var(--bg);border-color:var(--amber)}
  .md-site{border-radius:var(--r-md);text-align:left;display:flex;flex-direction:column;gap:2px}
  .md-site small{font-size:0.6875rem;font-weight:600;opacity:.75}
  .md-next{font-size:1rem;margin:0 0 12px;color:var(--text)}
  .md-row{display:flex;gap:8px;flex-wrap:wrap}
  .md-call{margin:6px 0 0}
  .md-loud{border-width:2px}
  .md-err{font-size:0.8125rem;color:var(--led-warn);margin:0 0 12px}
  .md-ev{display:flex;align-items:baseline;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)}
  .md-ev:last-child{border-bottom:none}
  .md-d{font-size:0.75rem;color:var(--muted);min-width:76px}
  .md-t{flex:1;font-size:0.875rem;color:var(--text)}
  .md-x{background:none;border:none;color:var(--muted);font-size:0.875rem;cursor:pointer;padding:4px}
  .md-none{font-size:0.875rem;line-height:1.5;color:var(--muted);margin:0 0 12px}
  .md-add{margin-bottom:0}
  .md-lab{padding:0 0 10px;margin-bottom:10px;border-bottom:1px solid var(--border)}
  .md-lab-t{font-size:0.8125rem;font-weight:700;color:var(--muted)}
  .md-lab-v{font-size:1rem;color:var(--text);margin-top:2px}
  .md-lab-h{font-size:0.75rem;color:var(--muted);margin-top:3px}
  .md-facts{margin:0;padding-left:1.1rem;font-size:0.875rem;line-height:1.55;color:var(--text)}
  .md-facts li{margin:3px 0}
  .md-rep{white-space:pre-wrap;font-family:inherit;font-size:0.8125rem;line-height:1.55;color:var(--text);background:var(--bg3);border-radius:var(--r-md);padding:12px;margin:0 0 12px}
</style>
