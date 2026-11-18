<script lang="ts">
  // The front door: what someone sees before they have an account.
  //
  // It used to be a login box, so a stranger met a demand for an email before
  // seeing anything the app does. Now it says what Slim Chance is in three lines
  // and starts a trial in one tap (an anonymous account: everything works,
  // nothing to type), with consent still explicit. "I have an account" opens
  // the login.
  import { signIn, signUp, startTrial } from '$lib/stores/user';

  let mode = $state<'start' | 'login' | 'signup'>('start');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let err = $state('');
  let consent = $state(false);

  async function start() {
    err = '';
    busy = true;
    try { await startTrial(consent); }
    catch (e: any) { err = e?.message || 'Could not start. Check your connection and try again.'; }
    finally { busy = false; }
  }

  async function submit() {
    err = '';
    if (!email.trim() || !password) { err = 'Enter an email and password.'; return; }
    busy = true;
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else await signUp(email.trim(), password, consent);
    } catch (e: any) {
      err = e?.message || 'Something went wrong.';
    } finally {
      busy = false;
    }
  }
</script>

<!-- One consent box for both ways in. The privacy link sits outside the
     label: inside it, a tap on the sentence could open the page instead of
     ticking the box. -->
{#snippet consentBox()}
  <div class="ag-consent-row">
    <label class="ag-consent">
      <input type="checkbox" bind:checked={consent}>
      <span>I agree that Slim Chance keeps my weight, food and health data to run the app for me.</span>
    </label>
    <a class="ag-how" href="/privacy.html">How it's kept</a>
  </div>
{/snippet}

<div id="auth-gate">
  <div class="ag">
    <header class="ag-head">
      <!-- The mark: a coin standing on its edge, the textbook slim chance. -->
      <svg class="ag-mark" viewBox="0 0 108 108" aria-hidden="true">
        <g opacity=".6"><ellipse cx="58" cy="51" rx="26" ry="29" fill="currentColor"/><rect x="49" y="22" width="9" height="58" fill="currentColor"/></g><path d="M61.82 25.4h8.4M66.22 28.7h8.4M69.24 32h8.4M71.46 35.3h8.4M73.1 38.6h8.4M74.29 41.9h8.4M75.07 45.2h8.4M75.5 48.5h8.4M75.59 51.8h8.4M75.34 55.1h8.4M74.74 58.4h8.4M73.77 61.7h8.4M72.37 65h8.4M70.47 68.3h8.4M67.9 71.6h8.4M64.33 74.9h8.4" stroke="#000" stroke-opacity=".32" stroke-width="1.35"/><ellipse cx="49" cy="51" rx="26" ry="29" fill="currentColor"/><ellipse cx="49" cy="51" rx="21.8" ry="24.8" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="2.1"/><path d="M36 83.4H71" stroke="currentColor" stroke-opacity=".45" stroke-width="3.2" stroke-linecap="round"/>
      </svg>
      <h1 class="ag-name wordmark"><b>Slim</b> Chance</h1>
      <p class="ag-tag">Better odds than the name suggests.</p>
      <p class="ag-sub">A calm weight-loss app for people doing it on their own. Free to use, private, no ads.</p>
    </header>

    {#if mode === 'start'}
      <ul class="ag-points">
        <li><b>The odds, every morning.</b> The scale swings every day. Slim Chance draws the line through your mornings and tells you how likely it is that you're really losing.</li>
        <li><b>A rough food log is enough.</b> Your budget is learned from your own scale and your own log, so what you don't log cancels out.</li>
        <li><b>A plan for the hard moments.</b> Write what you'll do on a Friday night. Slim Chance hands it back on Friday night.</li>
      </ul>

      {#if err}<div class="ag-err" role="alert">{err}</div>{/if}
      {@render consentBox()}
      <button class="btn bp bfl ag-go" onclick={start} disabled={busy || !consent}>{busy ? 'Starting…' : 'Start now'}</button>
      <p class="ag-note">No email needed to start. Save your account whenever you like.</p>
      <button class="ag-switch" onclick={() => { mode = 'login'; err = ''; }}>I have an account</button>
    {:else}
      <div class="ag-box">
        {#if err}<div class="ag-err" role="alert">{err}</div>{/if}
        <label class="flbl" for="auth-email">Email</label>
        <input id="auth-email" type="email" autocomplete="email" bind:value={email} placeholder="you@example.com">
        <label class="flbl" for="auth-pass">Password</label>
        <input id="auth-pass" type="password" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} bind:value={password} placeholder="••••••••"
          onkeydown={(e) => e.key === 'Enter' && submit()}>
        {#if mode === 'signup'}
          {@render consentBox()}
        {/if}
        <button class="btn bp bfl ag-go" onclick={submit} disabled={busy || (mode === 'signup' && !consent)}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <button class="ag-switch" onclick={() => { mode = mode === 'login' ? 'signup' : 'login'; err = ''; }}>
          {mode === 'login' ? 'Create an account with email instead' : 'I already have an account'}
        </button>
        <button class="ag-switch" onclick={() => { mode = 'start'; err = ''; }}>Back</button>
      </div>
    {/if}

    <footer class="ag-links">
      <a href="/about/">How it works</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="https://github.com/slimchanceapp/slimchance" target="_blank" rel="noopener noreferrer">Open source</a>
    </footer>
  </div>
</div>

<style>
  /* Its own scroll area: html and body never scroll (app.css), and the signed-in
     app scrolls inside #pages, which this screen sits outside. Without it, on a
     small phone or with large text, the consent box and Start now were cut off
     with no way to reach them (found by the phone proof, 2026-10-29). */
  #auth-gate{flex:1;min-height:0;overflow-y:auto;overscroll-behavior-y:contain;display:flex;justify-content:center;align-items:flex-start;padding:calc(var(--st) + 32px) 20px calc(var(--sb) + 28px)}
  .ag{width:100%;max-width:400px;min-height:100%;display:flex;flex-direction:column}
  .ag-head{text-align:center;margin-bottom:22px}
  .ag-mark{width:76px;height:76px;color:var(--amber);display:block;margin:0 auto 4px}
  .ag-name{font-size:3.25rem;line-height:.95;margin:0;color:var(--text)}
  .ag-tag{font-family:var(--font-display);font-size:1.375rem;font-weight:650;line-height:1.2;margin:10px 0 6px;color:var(--amber);text-wrap:balance}
  .ag-sub{font-size:0.9375rem;color:var(--muted);line-height:1.5;margin:0;text-wrap:balance}
  .ag-points{list-style:none;margin:0 0 20px;padding:0;display:grid;gap:12px}
  .ag-points li{font-size:0.875rem;line-height:1.5;color:var(--muted);padding-left:14px;border-left:2px solid var(--amber)}
  .ag-points b{display:block;color:var(--text);font-size:0.9375rem;margin-bottom:1px}
  .ag-box{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 18px}
  .ag-box input{margin-bottom:12px}
  .ag-err{background:var(--rb);color:var(--led-bad);font-size:0.8125rem;font-weight:600;padding:8px 10px;border-radius:var(--r-sm);margin-bottom:12px}
  .ag-consent-row{margin:0 0 14px}
  .ag-consent{display:flex;gap:10px;align-items:flex-start;font-size:0.8125rem;line-height:1.45;color:var(--text);cursor:pointer}
  .ag-how{display:inline-block;margin:2px 0 0 30px;font-size:0.8125rem;color:var(--amber)}
  .ag-consent input{width:20px;height:20px;flex-shrink:0;margin:1px 0 0;accent-color:var(--amber)}
  .ag-links a{color:var(--amber)}
  .ag-go{font-size:1rem;padding-block:14px}
  .ag-note{font-size:0.8125rem;color:var(--muted);text-align:center;margin:10px 0 0}
  .ag-switch{display:block;width:100%;text-align:center;background:none;border:none;color:var(--text);text-decoration:underline;text-underline-offset:3px;font-family:inherit;font-size:0.875rem;font-weight:600;margin-top:14px;cursor:pointer;padding:4px}
  .ag-links{text-align:center;font-size:0.8125rem;color:var(--muted);margin-top:auto;padding-top:28px}
</style>
