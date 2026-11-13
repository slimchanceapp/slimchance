// The live site as a stranger on an iPhone: WebKit (Safari's engine) at an
// iPhone's size and user agent. Starts a trial, opens every tab, screenshots
// each, fails on any uncaught page error, and deletes the trial at the end the
// way Settings does (delete-account), so no test account stays behind.
//
//   node scripts/iphone-proof.mjs <out dir>     (run by .github/workflows/ios-proof.yml)
import { webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const SITE = 'https://slimchance.app';
const out = (process.argv[2] ?? 'proof').replace(/\/$/, '');
mkdirSync(out, { recursive: true });

const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 15'], locale: 'en-GB', timezoneId: 'Europe/Bratislava' });
const page = await ctx.newPage();
const crashes = [];
page.on('pageerror', (e) => crashes.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('  console error:', m.text().slice(0, 200)); });

let session = null;
try {
  await page.goto(SITE + '/?from=test', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.screenshot({ path: `${out}/web-1-door.png` });
  await page.locator('input[type=checkbox]').first().check();
  await page.locator('button:has-text("Start now")').click();
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.endsWith('-auth-token')), null, { timeout: 30_000 });
  console.log('started a trial');

  // Setup, as a person would: today's weight, height and goal; sex, birth
  // year, activity; then start. Today's weight becomes the first weigh-in.
  await page.getByRole('button', { name: 'kg', exact: true }).click();
  await page.fill('#ob-weight', '92.4');
  await page.fill('#ob-height', '175');
  await page.fill('#ob-goal', '80');
  await page.screenshot({ path: `${out}/web-2-setup.png` });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Female' }).click();
  await page.fill('#ob-year', '1990');
  await page.locator('.ob-act').first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^(Skip and start|Start)$/ }).click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/web-3-today.png` });
  const today = await page.locator('body').innerText();
  if (!/92\.4/.test(today)) crashes.push('the weigh-in from setup is not on Today');
  else console.log('setup done; Today shows the 92.4 kg weigh-in');

  for (const tab of ['track', 'plan', 'workouts', 'progress', 'recipes']) {
    await page.goto(`${SITE}/${tab}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/web-4-${tab}.png` });
    const text = (await page.locator('body').innerText()).trim();
    console.log(`${tab}: ${text.length} characters on screen`);
    if (text.length < 40) crashes.push(`${tab} rendered almost nothing`);
    if (/Where you are, and where/.test(text)) crashes.push(`${tab} still shows setup`);
  }
  session = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.endsWith('-auth-token'));
    return k ? JSON.parse(localStorage.getItem(k)) : null;
  });
} finally {
  if (session?.access_token) {
    const r = await fetch(`${process.env.PUBLIC_SUPABASE_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'delete' }),
    });
    console.log('trial deleted:', r.status, await r.text());
  }
  await browser.close();
}

if (crashes.length) {
  console.error('Page errors:\n  ' + crashes.join('\n  '));
  process.exit(1);
}
console.log('No page errors on an iPhone-sized WebKit.');
