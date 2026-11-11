// "Ask about your numbers": a small agent (book chapter 8). The model answers
// one question from the person's own facts, the passages retrieved from our
// guides (RAG), and one tool: the chance their trend is really going their
// goal's way, over any date range. It never computes a number itself, and it
// never passes the data the app already holds: the tool takes only a date
// range and the server supplies the person's real weigh-ins. The model and the
// tool are passed in, so the edge function (index.ts) and the eval
// (svelte-recomp/scripts/eval-ask.mjs) run this same loop.

export interface Weighed { date: string; weight: number }
export interface Retrieved { id: string; title: string; url: string; text: string }
export interface ToolCall { name: string; args: Record<string, unknown>; result: unknown }
export interface AgentResult { answer: string; sources: string[]; calls: ToolCall[] }
type Message = Record<string, unknown>;
export type Chat = (messages: Message[], tools?: unknown[]) => Promise<{ content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }>;
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export const TOOLS = [{
  type: 'function',
  function: {
    name: 'slim_chance',
    description: "The chance in 10 that this person's weight trend is really going their goal's way, with the trend's pace, from their own morning weigh-ins between two dates. Use it for any question about whether they are losing, holding or gaining, or how fast. You pass only dates; their weigh-ins are supplied for you.",
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First morning to include, YYYY-MM-DD. Leave out for the last five weeks.' },
        to: { type: 'string', description: 'Last morning to include, YYYY-MM-DD. Leave out for today.' },
      },
    },
  },
}];

export function system(today: string): string {
  return `You are the coach inside Slim Chance, answering one question from one person about their own weight, food and training. Today is ${today}.
Use only three things: facts (their last 14 days, from the app), passages (from Slim Chance's own guides, each with an id), and the slim_chance tool (the chance their trend is going their goal's way, over any date range).
Rules, always:
- Every number you write must come from the facts or from a tool result. Never work out a number yourself.
- For whether they are losing, holding or gaining, or how fast, call slim_chance.
- When a passage explains the answer, use it and list its id in sources.
- Calm, plain and kind; two to four sentences. Talk in trends and likelihoods, never promises.
- Never ask them to log more or log more completely. No medical advice: anything about a condition or a medication goes to their doctor.
Reply with JSON only: {"answer": "...", "sources": ["passage id"]}`;
}

/** Up to `maxTurns` model calls; each tool call is answered before the next. */
export async function runAgent(i: {
  question: string; today: string; facts: unknown; passages: Retrieved[];
  chat: Chat; callTool: CallTool; maxTurns?: number;
  /** Why the app refused the last answer (src/lib/ask.ts checkAnswer). */
  problem?: string;
  /** Their first weigh-in on record: without it "my first month" has no dates. */
  firstWeighIn?: string | null;
}): Promise<AgentResult> {
  const calls: ToolCall[] = [];
  const messages: Message[] = [
    { role: 'system', content: system(i.today) },
    { role: 'user', content: `Question: ${i.question}\n\nFacts (JSON): ${JSON.stringify(i.facts)}\n\nPassages:\n${i.passages.map((p) => `[${p.id}] ${p.title}: ${p.text}`).join('\n') || '(none)'}${i.firstWeighIn ? `\n\nTheir weigh-ins run from ${i.firstWeighIn} to ${i.today}.` : ''}${i.problem ? `\n\nYour last answer was refused by the app because: ${i.problem}. Answer again without that.` : ''}` },
  ];
  const turns = i.maxTurns ?? 3;
  for (let turn = 0; turn < turns; turn++) {
    // The last turn has no tools: it must answer with what it has.
    const m = await i.chat(messages, turn < turns - 1 ? TOOLS : undefined);
    if (m.tool_calls?.length) {
      messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
      for (const tc of m.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* bad arguments: the tool says so */ }
        const result = tc.function.name === 'slim_chance' ? await i.callTool('slim_chance', args) : { error: `There is no tool called ${tc.function.name}.` };
        calls.push({ name: tc.function.name, args, result });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }
    const text = m.content ?? '';
    try {
      const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      return { answer: String(o.answer ?? '').trim(), sources: Array.isArray(o.sources) ? o.sources.map(String) : [], calls };
    } catch {
      return { answer: text.trim(), sources: [], calls };
    }
  }
  return { answer: '', sources: [], calls };
}

/** The slim_chance tool's server side: the person's weigh-ins in the range,
 *  ready for the MCP tool. Dates the model invents simply select nothing. */
export function weighInsFor(weights: Weighed[], args: Record<string, unknown>, today: string): Weighed[] {
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const to = iso(args.to) ?? today;
  const from = iso(args.from) ?? new Date(Date.parse(`${to}T12:00:00Z`) - 34 * 864e5).toISOString().slice(0, 10);
  return weights.filter((w) => w.date >= from && w.date <= to);
}
