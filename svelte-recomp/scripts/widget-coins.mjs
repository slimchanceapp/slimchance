// The home-screen widget's coins: android/app/src/main/res/drawable/coins_0..10.xml,
// ten coins in a row with the first n lit. One coin, drawn the way Today's hero
// draws it (.coin in src/app.css): a milled edge, the face, a raised rim, and on
// a lit coin a gold face with a glint. An unlit coin is the same coin in the
// widget's quiet colours, so ten unlit coins still read as coins: build 24's
// were empty rings, and the owner asked whether they looked like coins at all
// (2026-11-12). Run `node scripts/widget-coins.mjs` after changing anything here;
// selfcheck fails while the drawables differ from what this writes.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The lit coin's colours, the same in the app and on the widget. */
export const GOLD = { edge: '#C27C0E', mill: '#E8A317', light: '#FFF3BF', face: '#FCC419', deep: '#F08C00', ring: '#D08A0A' };

const R = { edge: 11.5, face: 9.6, ring: 7.4, millIn: 9.9, millOut: 11.3 };
const n2 = (x) => +x.toFixed(2);
const circle = (cx, r) => `M${n2(cx - r)},12a${r},${r} 0 1,0 ${n2(2 * r)},0a${r},${r} 0 1,0 ${n2(-2 * r)},0Z`;
const mill = (cx) => Array.from({ length: 28 }, (_, i) => {
  const a = (i * Math.PI * 2) / 28, c = Math.cos(a), s = Math.sin(a);
  return `M${n2(cx + c * R.millIn)},${n2(12 + s * R.millIn)}L${n2(cx + c * R.millOut)},${n2(12 + s * R.millOut)}`;
}).join('');

function coin(i, lit) {
  const ox = i * 30, cx = ox + 12;
  if (!lit) return [
    `    <path android:fillColor="@color/widget_coin_off_edge" android:pathData="${circle(cx, R.edge)}" />`,
    `    <path android:strokeColor="@color/widget_coin_off_mill" android:strokeWidth="0.8" android:pathData="${mill(cx)}" />`,
    `    <path android:fillColor="@color/widget_coin_off_face" android:pathData="${circle(cx, R.face)}" />`,
    `    <path android:strokeColor="@color/widget_coin_off_ring" android:strokeWidth="1.1" android:pathData="${circle(cx, R.ring)}" />`,
  ];
  return [
    `    <path android:fillColor="${GOLD.edge}" android:pathData="${circle(cx, R.edge)}" />`,
    `    <path android:strokeColor="${GOLD.mill}" android:strokeWidth="0.8" android:pathData="${mill(cx)}" />`,
    `    <path android:pathData="${circle(cx, R.face)}">`,
    `        <aapt:attr name="android:fillColor">`,
    `            <gradient android:type="radial" android:centerX="${n2(ox + 9.12)}" android:centerY="8.16" android:gradientRadius="14.4">`,
    `                <item android:offset="0" android:color="${GOLD.light}" />`,
    `                <item android:offset="0.45" android:color="${GOLD.face}" />`,
    `                <item android:offset="1" android:color="${GOLD.deep}" />`,
    `            </gradient>`,
    `        </aapt:attr>`,
    `    </path>`,
    `    <path android:strokeColor="${GOLD.ring}" android:strokeAlpha="0.75" android:strokeWidth="1.1" android:pathData="${circle(cx, R.ring)}" />`,
    `    <path android:strokeColor="#FFFBE6" android:strokeAlpha="0.9" android:strokeWidth="1.2" android:strokeLineCap="round" android:pathData="M${n2(ox + 6.6)},9.2A6.2,6.2 0 0,1 ${n2(ox + 9.6)},6.1" />`,
  ];
}

/** coins_n.xml: ten coins, the first n lit. */
export function coinsXml(n) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- ${n} of 10 coins lit. Written by scripts/widget-coins.mjs: change that, not this. -->`,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    xmlns:aapt="http://schemas.android.com/aapt"',
    '    android:width="294dp"',
    '    android:height="24dp"',
    '    android:viewportWidth="294"',
    '    android:viewportHeight="24">',
    ...Array.from({ length: 10 }, (_, i) => coin(i, i < n)).flat(),
    '</vector>',
    '',
  ].join('\n');
}

export const coinsPath = (n) => new URL(`../android/app/src/main/res/drawable/coins_${n}.xml`, import.meta.url);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (let n = 0; n <= 10; n++) writeFileSync(coinsPath(n), coinsXml(n));
  console.log('wrote coins_0..10.xml');
}
