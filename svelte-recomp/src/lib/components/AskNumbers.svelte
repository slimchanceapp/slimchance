<script lang="ts">
  // "Ask about your numbers" (supabase/functions/ask, book chapter 8): one
  // question at a time, answered from your own numbers and Slim Chance's
  // guides, and shown only once the app has checked it (src/lib/ask.ts).
  import { askNumbers } from '$lib/stores/brain';
  import type { AskSource } from '$lib/ask';

  const EXAMPLES = ['Am I actually losing weight?', 'Was I losing faster in my first month?', 'Why did the scale go up this morning?'];
  let question = $state('');
  let busy = $state(false);
  let answer = $state<{ text: string; sources: AskSource[] } | null>(null);
  let note = $state<string | null>(null);

  const local = (url: string) => { try { const u = new URL(url); return u.pathname + u.hash; } catch { return url; } };

  async function ask(q = question) {
    q = q.trim();
    if (!q || busy) return;
    question = q; busy = true; answer = null; note = null;
    try {
      const r = await askNumbers(q);
      if (r.ok) answer = { text: r.answer, sources: r.sources };
      else note = r.why;
    } catch {
      note = 'Couldn’t reach the coach. Try again in a moment.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="card an">
  <form onsubmit={(e) => { e.preventDefault(); ask(); }}>
    <input bind:value={question} maxlength="300" placeholder="Ask about your weight, food or training" aria-label="Your question" enterkeyhint="send" />
    <button class="btn bp bsm" disabled={busy || !question.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
  </form>
  {#if answer}
    <p class="an-a">{answer.text}</p>
    {#if answer.sources.length}
      <p class="an-s">More: {#each answer.sources as s, i}{i ? ' · ' : ''}<a href={local(s.url)}>{s.title}</a>{/each}</p>
    {/if}
  {:else if note}
    <p class="an-n">{note}</p>
  {:else if !busy}
    <div class="an-ex">
      {#each EXAMPLES as q (q)}<button type="button" onclick={() => ask(q)}>{q}</button>{/each}
    </div>
  {/if}
  <p class="an-f">Answered from your own numbers and Slim Chance’s guides, and checked by the app before you see it. Not medical advice.</p>
</div>

<style>
  .an form{display:flex;gap:8px}
  .an input{flex:1;min-width:0;font:inherit;padding:10px 12px;border-radius:var(--r-sm);border:1px solid var(--border);background:var(--bg);color:var(--text)}
  .an .btn{flex:none}
  .an-a{margin:12px 0 0;font-size:0.9375rem;line-height:1.5;color:var(--text)}
  .an-s,.an-n,.an-f{margin:8px 0 0;font-size:0.8125rem;line-height:1.4;color:var(--muted)}
  .an-s a{color:var(--text)}
  .an-ex{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .an-ex button{font:inherit;font-size:0.8125rem;padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer}
</style>
