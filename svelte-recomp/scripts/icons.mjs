// The app's icons, every size, from one drawing (the owner's pick, 2026-10-31):
// a coin seen face-on, with a milled rim, an inner ring and an S. The coin
// turned on its edge read as an egg once it was small; the edge-on coin lives
// on in the loading animation. Run after changing the drawing:
//   node scripts/icons.mjs
// It redraws in place the Android launcher layers, round and legacy icons,
// splashes and notification drawable, the iPhone icon and splashes, and the
// web icons, at the sizes the files already have, and writes the Play
// listing's 512 px icon to store/. The S is Archivo ExtraBold (wdth 100,
// wght 800), outlined once from the font, so no size depends on a font.
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { crc32, deflateSync } from 'node:zlib';

// Deep's navy-violet behind the coin the app itself draws (decision 0005),
// since build 21 (2026-11-11); black from 2026-11-03.
const NAVY = '#100E26', RIM = '#C99A12', MILL = '#9C7A10', FACE = '#FCC419';
/** The S at font-size 38, centred on x 54, baseline 67.5 (108 units). */
const S = 'M54.43 67.96Q51.97 67.96 49.8 67.52Q47.63 67.09 45.97 66.1Q44.32 65.12 43.37 63.49Q42.43 61.87 42.43 59.5Q42.43 59.36 42.43 59.18Q42.44 59.01 42.46 58.87H49.05Q49.03 58.99 49.02 59.16Q49.01 59.32 49.01 59.46Q49.01 60.65 49.63 61.39Q50.25 62.12 51.4 62.45Q52.55 62.78 54.07 62.78Q54.89 62.78 55.61 62.71Q56.33 62.63 56.91 62.44Q57.49 62.26 57.91 61.98Q58.34 61.69 58.56 61.29Q58.77 60.89 58.77 60.36Q58.77 59.46 58.11 58.91Q57.45 58.35 56.32 57.96Q55.19 57.57 53.78 57.24Q52.37 56.92 50.86 56.53Q49.35 56.14 47.94 55.56Q46.53 54.98 45.4 54.12Q44.27 53.25 43.61 51.94Q42.95 50.62 42.95 48.77Q42.95 46.7 43.82 45.21Q44.69 43.72 46.24 42.77Q47.79 41.83 49.8 41.38Q51.82 40.93 54.1 40.93Q56.33 40.93 58.3 41.39Q60.27 41.85 61.78 42.81Q63.29 43.77 64.15 45.25Q65.01 46.73 65.03 48.77V49.22H58.51V48.97Q58.51 48.09 58.03 47.41Q57.54 46.74 56.59 46.34Q55.64 45.94 54.25 45.94Q52.85 45.94 51.87 46.21Q50.89 46.48 50.39 46.99Q49.89 47.49 49.89 48.15Q49.89 48.98 50.55 49.52Q51.21 50.07 52.34 50.44Q53.47 50.81 54.88 51.13Q56.29 51.45 57.8 51.82Q59.31 52.2 60.72 52.75Q62.13 53.3 63.26 54.15Q64.39 55.01 65.05 56.26Q65.71 57.52 65.71 59.3Q65.71 62.4 64.25 64.31Q62.78 66.22 60.23 67.09Q57.68 67.96 54.43 67.96Z';
/** The same S for the 24-unit mark: font-size 11.5, centred on x 12, baseline 16.3. */
const S24 = 'M12.13 16.44Q11.39 16.44 10.73 16.31Q10.07 16.18 9.57 15.88Q9.07 15.58 8.78 15.09Q8.5 14.6 8.5 13.88Q8.5 13.84 8.5 13.78Q8.5 13.73 8.51 13.69H10.5Q10.5 13.72 10.49 13.78Q10.49 13.83 10.49 13.87Q10.49 14.23 10.68 14.45Q10.87 14.67 11.21 14.77Q11.56 14.87 12.02 14.87Q12.27 14.87 12.49 14.85Q12.7 14.82 12.88 14.77Q13.06 14.71 13.18 14.63Q13.31 14.54 13.38 14.42Q13.45 14.3 13.45 14.14Q13.45 13.87 13.24 13.7Q13.04 13.53 12.7 13.41Q12.36 13.29 11.93 13.2Q11.51 13.1 11.05 12.98Q10.59 12.86 10.17 12.69Q9.74 12.51 9.4 12.25Q9.06 11.99 8.86 11.59Q8.66 11.19 8.66 10.63Q8.66 10.01 8.92 9.55Q9.18 9.1 9.65 8.82Q10.12 8.53 10.73 8.4Q11.34 8.26 12.03 8.26Q12.71 8.26 13.3 8.4Q13.9 8.54 14.35 8.83Q14.81 9.12 15.07 9.57Q15.33 10.01 15.34 10.63V10.77H13.37V10.69Q13.37 10.43 13.22 10.22Q13.07 10.02 12.78 9.9Q12.5 9.78 12.07 9.78Q11.65 9.78 11.36 9.86Q11.06 9.94 10.91 10.09Q10.76 10.24 10.76 10.45Q10.76 10.7 10.96 10.86Q11.16 11.02 11.5 11.14Q11.84 11.25 12.27 11.35Q12.69 11.44 13.15 11.56Q13.61 11.67 14.03 11.84Q14.46 12 14.8 12.26Q15.14 12.52 15.34 12.9Q15.55 13.28 15.55 13.82Q15.55 14.76 15.1 15.33Q14.66 15.91 13.89 16.17Q13.11 16.44 12.13 16.44Z';

const ticks = Array.from({ length: 56 }, (_, i) => {
  const a = (i * 2 * Math.PI) / 56;
  const p = (r) => `${(54 + r * Math.cos(a)).toFixed(2)},${(54 + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(32.4)}L${p(36)}`;
}).join('');
/** The coin: 108 units, centred on 54,54, radius 36. */
const COIN = `<circle cx="54" cy="54" r="36" fill="${RIM}"/><path d="${ticks}" stroke="${MILL}" stroke-width="1.7"/>`
  + `<circle cx="54" cy="54" r="31.5" fill="${FACE}"/><circle cx="54" cy="54" r="26.5" fill="none" stroke="${RIM}" stroke-width="2.2"/>`
  + `<path d="${S}" fill="${MILL}"/>`;
/** In one colour, the coin's ring and its S: 24 units, centred on 12,12, radius 10.4. */
const RING = 'M12 1.6a10.4 10.4 0 1 1 0 20.8a10.4 10.4 0 1 1 0-20.8zm0 2.5a7.9 7.9 0 1 0 0 15.8a7.9 7.9 0 1 0 0-15.8z';
const MARK = `<path fill="#fff" fill-rule="evenodd" d="${RING}"/><path fill="#fff" d="${S24}"/>`;

/** `body` (drawn around `c` with radius `r0`) centred on x,y at radius r. */
const at = (x, y, r, body, c = 54, r0 = 36) => `<g transform="translate(${x} ${y}) scale(${r / r0}) translate(-${c} -${c})">${body}</g>`;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
// The coin is a third of the icon's side, as in the drawing he chose.
const rounded = (n) => svg(n, n, `<rect width="${n}" height="${n}" rx="${(n * 24) / 108}" fill="${NAVY}"/>${at(n / 2, n / 2, n / 3, COIN)}`);
const square = (n) => svg(n, n, `<rect width="${n}" height="${n}" fill="${NAVY}"/>${at(n / 2, n / 2, n / 3, COIN)}`);
const round = (n) => svg(n, n, `<circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}" fill="${NAVY}"/>${at(n / 2, n / 2, n / 3, COIN)}`);
// An adaptive layer is 108 dp, of which the launcher shows the middle 72;
// the coin takes about the same share of those as of the icons above.
const foreground = (n) => svg(n, n, at(n / 2, n / 2, (n * 25) / 108, COIN));
const monochrome = (n) => svg(n, n, at(n / 2, n / 2, (n * 25) / 108, MARK, 12, 10.4));
const background = (n) => svg(n, n, `<rect width="${n}" height="${n}" fill="${NAVY}"/>`);
const badge = (n) => svg(n, n, at(n / 2, n / 2, (n * 10.4) / 24, MARK, 12, 10.4));
const splash = (w, h, side) => svg(w, h, `<rect width="${w}" height="${h}" fill="${NAVY}"/>${at(w / 2, h / 2, (Math.min(w, h) * side) / 2, COIN)}`);

/** A PNG of raw RGBA: with its alpha channel, or opaque RGB (the App Store refuses an icon with one). */
function png(w, h, rgba, alpha) {
  const ch = alpha ? 4 : 3, row = w * ch + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = y * row + 1 + x * ch;
    for (let k = 0; k < ch; k++) raw[d + k] = rgba[s + k];
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const sizeOf = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const RES = 'android/app/src/main/res', IOS = 'ios/App/App/Assets.xcassets';
/** [file, drawing, keep the alpha channel] */
const jobs = [];
for (const d of readdirSync(RES).filter((d) => /^mipmap-[a-z]+dpi$/.test(d))) {
  const [n] = sizeOf(`${RES}/${d}/ic_launcher.png`), [layer] = sizeOf(`${RES}/${d}/ic_launcher_foreground.png`);
  jobs.push([`${RES}/${d}/ic_launcher.png`, rounded(n), true], [`${RES}/${d}/ic_launcher_round.png`, round(n), true],
    [`${RES}/${d}/ic_launcher_foreground.png`, foreground(layer), true], [`${RES}/${d}/ic_launcher_monochrome.png`, monochrome(layer), true],
    [`${RES}/${d}/ic_launcher_background.png`, background(layer), false]);
}
for (const d of readdirSync(RES).filter((d) => d.startsWith('drawable'))) {
  const f = `${RES}/${d}/splash.png`;
  try { const [w, h] = sizeOf(f); jobs.push([f, splash(w, h, 0.31), false]); } catch { /* no splash at this density */ }
}
jobs.push([`${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`, square(1024), false]);
for (const f of readdirSync(`${IOS}/Splash.imageset`).filter((f) => f.endsWith('.png'))) jobs.push([`${IOS}/Splash.imageset/${f}`, splash(2732, 2732, 0.16), false]);
jobs.push(['static/favicon-32.png', rounded(32), true], ['static/icon-192.png', rounded(192), true], ['static/icon-512.png', rounded(512), true],
  ['static/icon-maskable-512.png', square(512), false], ['static/apple-touch-icon.png', square(180), false],
  ['static/badge-96.png', badge(96), true], ['store/play-icon-512.png', square(512), false]);

const browsers = `${homedir()}/.cache/ms-playwright`;
const chrome = process.env.SMOKE_CHROME ?? `${browsers}/${readdirSync(browsers).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1)}/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath: chrome });
const page = await browser.newPage();
mkdirSync('store', { recursive: true });
for (const [file, drawing, alpha] of jobs) {
  const [w, h] = [+drawing.match(/width="([\d.]+)"/)[1], +drawing.match(/height="([\d.]+)"/)[1]];
  const b64 = await page.evaluate(async ([s, w, h]) => {
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(s)}`;
    await img.decode();
    const ctx = new OffscreenCanvas(w, h).getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let bin = '';
    for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return btoa(bin);
  }, [drawing, w, h]);
  writeFileSync(file, png(w, h, Buffer.from(b64, 'base64'), alpha));
}
await browser.close();

writeFileSync('static/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><rect width="108" height="108" rx="24" fill="${NAVY}"/>${COIN}</svg>\n`);
writeFileSync(`${RES}/drawable/ic_stat_moderly.xml`, `<?xml version="1.0" encoding="utf-8"?>
<!-- Slim Chance's mark for the status bar and every notification: the coin's
     ring and its S, white on transparent (Android tints it, brass via
     setColor). Drawn by scripts/icons.mjs from the same drawing as every
     other icon. The file keeps its old name: the code and both copies of the
     Capacitor config point at it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:fillType="evenOdd"
        android:pathData="${RING}" />
    <path android:fillColor="#FFFFFFFF"
        android:pathData="${S24}" />
</vector>
`);
console.log(`icons: ${jobs.length} images, icon.svg and the notification drawable redrawn.`);
