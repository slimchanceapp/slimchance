// The knowledge the coach may cite (retrieval-augmented generation, book
// chapter 8): our own guides, cut at their headings, and the landing page's
// questions and answers, one passage each. Every passage is turned into an
// embedding (a list of numbers that places text by meaning) with
// bge-small-en-v1.5 on Cloudflare Workers AI, free, and written beside the edge
// functions. Run after a guide or the FAQ changes:
//   set -a; . ~/.config/recompos/cloudflare-ai.env; set +a; node scripts/build-knowledge.mjs
// Public text only: nothing about any person goes in here.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const MODEL = '@cf/baai/bge-small-en-v1.5';
const KEY = process.env.CLOUDFLARE_AI_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!KEY || !ACCOUNT) { console.error('CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID missing'); process.exit(1); }
const ROOT = new URL('..', import.meta.url).pathname;
const plain = (html) => html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;|&#8217;/g, '’').replace(/&ldquo;|&rdquo;/g, '"').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const passages = [];
for (const slug of readdirSync(`${ROOT}static/guides`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  const html = readFileSync(`${ROOT}static/guides/${slug}/index.html`, 'utf8');
  const title = plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? slug);
  const body = html.slice(html.indexOf('</h1>'));
  const parts = body.split(/<h2[^>]*>/).slice(1);
  const lead = plain(body.split(/<h2[^>]*>/)[0]);
  if (lead.length > 80) passages.push({ id: `${slug}#lead`, title, url: `https://slimchance.app/guides/${slug}/`, text: lead.slice(0, 1200) });
  for (const p of parts) {
    const head = plain(p.slice(0, p.indexOf('</h2>')));
    if (/^sources$/i.test(head)) continue;
    const text = plain(p.slice(p.indexOf('</h2>') + 5));
    if (text.length > 60) passages.push({ id: `${slug}#${head.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, title: `${title}: ${head}`, url: `https://slimchance.app/guides/${slug}/`, text: text.slice(0, 1200) });
  }
}
const about = readFileSync(`${ROOT}static/about/index.html`, 'utf8');
for (const [, q, a] of about.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)) {
  passages.push({ id: `faq#${plain(q).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`, title: plain(q), url: 'https://slimchance.app/about/', text: `${plain(q)} ${plain(a)}` });
}

const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
  method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ text: passages.map((p) => `${p.title}. ${p.text}`) }),
});
const j = await r.json();
const vectors = j.result?.data;
if (!Array.isArray(vectors) || vectors.length !== passages.length) { console.error('embedding failed', JSON.stringify(j).slice(0, 300)); process.exit(1); }
const out = { model: MODEL, built: new Date().toISOString().slice(0, 10), passages: passages.map((p, i) => ({ ...p, v: vectors[i].map((x) => Math.round(x * 1e4) / 1e4) })) };
writeFileSync(`${ROOT}../supabase/functions/_shared/knowledge.json`, JSON.stringify(out) + '\n');
console.log(`${passages.length} passages, ${vectors[0].length} numbers each, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
for (const p of passages) console.log(' ', p.id);
