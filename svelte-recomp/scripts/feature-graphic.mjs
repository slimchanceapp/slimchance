// The Play listing's feature graphic (1024x500): the icon's own coin (scripts/icons.mjs,
// same colours) beside the name. Run after the icon changes:
//   node scripts/feature-graphic.mjs   (writes store/play/feature-graphic.jpg)
import { chromium } from 'playwright-core';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const gen = readFileSync(`${R}/scripts/icons.mjs`, 'utf8');
const S = gen.match(/const S = '([^']+)'/)[1];
const col = (n) => gen.match(new RegExp(n + " = '(#[0-9A-Fa-f]{6})'"))[1];
const [NAVY, RIM, MILL, FACE] = ['NAVY', 'RIM', 'MILL', 'FACE'].map(col);
const ticks = Array.from({ length: 56 }, (_, i) => { const a = (i * 2 * Math.PI) / 56; const p = (r) => `${(54 + r * Math.cos(a)).toFixed(2)},${(54 + r * Math.sin(a)).toFixed(2)}`; return `M${p(32.4)}L${p(36)}`; }).join('');
const coin = `<svg viewBox="18 18 72 72" width="300" height="300"><circle cx="54" cy="54" r="36" fill="${RIM}"/><path d="${ticks}" stroke="${MILL}" stroke-width="1.7"/><circle cx="54" cy="54" r="31.5" fill="${FACE}"/><circle cx="54" cy="54" r="26.5" fill="none" stroke="${RIM}" stroke-width="2.2"/><path d="${S}" fill="${MILL}"/></svg>`;
const font = (f) => `data:font/woff2;base64,${readFileSync(`${R}/static/fonts/${f}`).toString('base64')}`;
const html = `<!doctype html><html><head><style>
@font-face{font-family:Archivo;src:url(${font('archivo-latin.woff2')}) format('woff2');font-weight:100 900;font-stretch:62% 85%}
@font-face{font-family:Atk;src:url(${font('atkinson-latin.woff2')}) format('woff2');font-weight:200 800}
html,body{margin:0;width:1024px;height:500px;background:${NAVY};overflow:hidden}
.w{display:flex;align-items:center;gap:56px;height:500px;padding:0 70px;box-sizing:border-box}
h1{font:800 92px/1 Archivo,sans-serif;font-stretch:85%;color:#F4F2FF;margin:0 0 18px;letter-spacing:-.5px}
.t{font:700 26px/1.2 Atk,sans-serif;color:${FACE};margin:0 0 30px}
.d{display:flex;gap:10px;margin-bottom:14px}.d i{width:24px;height:24px;border-radius:50%;background:${FACE}}.d i.o{background:none;border:2px solid #2E2B5C;box-sizing:border-box}
.c{font:400 20px/1.2 Atk,sans-serif;color:#A9A5CF;margin:0}
</style></head><body><div class="w">${coin}<div><h1>Slim Chance</h1><p class="t">Better odds than the name suggests.</p><div class="d">${'<i></i>'.repeat(9)}<i class="o"></i></div><p class="c">9 in 10 it’s coming off.</p></div></div></body></html>`;
const b = await chromium.launch({ executablePath: `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome` });
const p = await b.newPage({ viewport: { width: 1024, height: 500 } });
await p.setContent(html); await p.waitForTimeout(800);
await p.screenshot({ path: `${R}/store/play/feature-graphic.jpg`, type: 'jpeg', quality: 92 });
await b.close();
console.log('ok');
