// Slim Chance as a tool any AI assistant can call (MCP, the Model Context
// Protocol). 2026-11-10: people already ask ChatGPT and Claude "is my diet
// working?", and a language model is bad at exactly the sum this app does
// well: a trend through noisy mornings with an honest error bar. So the
// maths is offered as a tool: send dated morning weights, get the trend and
// the chance back, in the same words the app uses.
//
// Stateless and anonymous by design: nothing is stored, no account, no AI on
// our side (the caller's assistant does the talking), so there is no personal
// data to protect and no AI bill to run up. Pure: the route
// (src/routes/mcp/+server.ts) only moves bytes; everything here is tested in
// selfcheck.js.
//
// Protocol: JSON-RPC 2.0 over Streamable HTTP, answered with plain JSON
// (2025-06-18 and 2025-11-25: initialize, then tools/list and tools/call).
// A client on 2026-07-28 gets the spec's own "unsupported version" answer
// listing these, and falls back to one of them.

import { weightVerdict, chanceOf, type WeighIn } from './insights.ts';
import { oddsOf } from './pulse.ts';

export const SUPPORTED = ['2025-11-25', '2025-06-18'];
const LB = 2.20462;
const MAX_READINGS = 400;

const TOOL = {
  name: 'slim_chance',
  title: 'Slim Chance: is my weight really moving?',
  description:
    'Turns dated morning scale readings into an honest trend: where the weight really is under the daily ' +
    'water noise, the rate per week with its 95% range, and the chance in 10 that it is truly moving the ' +
    'way the person wants. It reads the last 5 weeks up to the latest reading; it describes the recent ' +
    'past, it is not a forecast. Needs at least 7 readings in those 5 weeks for a verdict; with fewer it ' +
    'says how many more mornings it needs. Nothing is stored.',
  inputSchema: {
    type: 'object',
    properties: {
      weigh_ins: {
        type: 'array', minItems: 1, maxItems: MAX_READINGS,
        description: 'Morning scale readings, any order, one per day (a later reading for the same date replaces an earlier one).',
        items: {
          type: 'object',
          properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, weight: { type: 'number' } },
          required: ['date', 'weight'],
        },
      },
      unit: { type: 'string', enum: ['kg', 'lb'], description: 'Unit of the weights, and of the answer. Default kg.' },
      goal: { type: 'string', enum: ['lose', 'gain', 'hold'], description: 'Which way the person wants the weight to go. Default lose.' },
      goal_weight: { type: 'number', description: 'Optional target weight, same unit: adds "at this pace, about N weeks".' },
    },
    required: ['weigh_ins'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: ['not-enough', 'too-noisy', 'answerable'] },
      chance_in_10: { type: ['integer', 'null'] },
      chance: { type: ['string', 'null'] },
      trend: { type: ['number', 'null'] },
      rate_per_week: { type: ['number', 'null'], description: 'Positive = losing.' },
      rate_range: { type: ['array', 'null'], items: { type: 'number' } },
      scale_noise: { type: ['number', 'null'] },
      readings_used: { type: 'integer' },
      more_mornings_needed: { type: ['integer', 'null'] },
      weeks_to_goal: { type: ['integer', 'null'] },
      unit: { type: 'string' },
      as_of: { type: 'string' },
    },
    required: ['state', 'readings_used', 'unit', 'as_of'],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const WHAT = { lose: 'coming off', gain: 'going up', hold: 'holding' } as const;

/** The tool itself: arguments in, a tool result out. Bad input is a tool
 *  error the assistant can read and correct, not a protocol error. */
export function slimChance(args: any): { content: { type: 'text'; text: string }[]; structuredContent?: any; isError?: boolean } {
  const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
  const unit = args?.unit ?? 'kg';
  const goal = args?.goal ?? 'lose';
  if (unit !== 'kg' && unit !== 'lb') return fail('unit must be "kg" or "lb".');
  if (!(goal in WHAT)) return fail('goal must be "lose", "gain" or "hold".');
  const list = args?.weigh_ins;
  if (!Array.isArray(list) || list.length === 0) return fail('weigh_ins must be a non-empty list of {date: "YYYY-MM-DD", weight: number}.');
  if (list.length > MAX_READINGS) return fail(`At most ${MAX_READINGS} readings; send the last few months.`);
  const toKg = unit === 'lb' ? 1 / LB : 1;
  const byDate = new Map<string, number>();
  for (const r of list) {
    const d = r?.date, w = Number(r?.weight) * toKg;
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(`${d}T12:00:00Z`))) return fail(`"${d}" is not a date like 2026-11-10.`);
    if (!isFinite(w) || w < 20 || w > 400) return fail(`${r?.weight} ${unit} is not a body weight.`);
    byDate.set(d, w);
  }
  const points: WeighIn[] = [...byDate].map(([date, weight]) => ({ date, weight })).sort((a, b) => a.date.localeCompare(b.date));
  const asOf = points[points.length - 1].date;
  const v = weightVerdict(points, Date.parse(`${asOf}T12:00:00`))!;
  const u = (kg: number | null | undefined, dp = 1) => (kg == null ? null : +(kg * (unit === 'lb' ? LB : 1)).toFixed(dp));
  const odds = oddsOf(chanceOf(v, goal === 'lose' ? 'lose' : goal === 'gain' ? 'gain' : 'hold'), WHAT[goal as keyof typeof WHAT]);
  const line = v.state !== 'not-enough';
  // "At this pace": only with a direction the interval is sure of, toward the target.
  const gw = typeof args?.goal_weight === 'number' ? args.goal_weight * toKg : null;
  const toGo = gw != null && v.trendKg != null ? v.trendKg - gw : null;
  const weeks = v.state === 'answerable' && toGo != null && Math.sign(toGo) === Math.sign(v.rateKgPerWeek) && Math.abs(v.rateKgPerWeek) >= 0.15
    ? Math.min(104, Math.ceil(toGo / v.rateKgPerWeek)) : null;
  const out = {
    state: v.state,
    chance_in_10: odds?.lit ?? null,
    chance: odds?.text ?? null,
    trend: u(v.trendKg),
    rate_per_week: line ? u(v.rateKgPerWeek, 2) : null,
    rate_range: line ? [u(v.loKgPerWeek, 2)!, u(v.hiKgPerWeek, 2)!] : null,
    scale_noise: line ? u(v.scatterKg, 2) : null,
    readings_used: v.n,
    more_mornings_needed: v.weighInsNeeded,
    weeks_to_goal: weeks,
    unit, as_of: asOf,
  };
  const r = (x: number | null) => (x == null ? '' : x > 0 ? `down ${x} ${unit} a week` : x < 0 ? `up ${-x} ${unit} a week` : 'flat');
  const text = !line
    ? `Not enough yet: ${v.n} reading${v.n === 1 ? '' : 's'} in the 5 weeks to ${asOf}. ${v.weighInsNeeded} more morning${v.weighInsNeeded === 1 ? '' : 's'} and there is a first verdict.` +
      (v.meanKg != null ? ` Average so far: ${u(v.meanKg)} ${unit}.` : '')
    : [
        `${odds?.text ?? ''}`,
        `Trend ${out.trend} ${unit} on ${asOf}, ${r(out.rate_per_week)} (95% range: ${r(out.rate_range![0])} to ${r(out.rate_range![1])}), from ${v.n} readings over ${v.spanDays} days.`,
        `The scale's own day-to-day noise is about ±${out.scale_noise} ${unit}.`,
        v.state === 'too-noisy' && v.weighInsNeeded ? `Too close to call yet: about ${v.weighInsNeeded} more daily mornings would settle it.` : '',
        weeks != null ? `At this pace, ${u(gw)} ${unit} in about ${weeks} week${weeks === 1 ? '' : 's'}.` : '',
        'This describes those readings, not a promise about the weeks ahead.',
      ].filter(Boolean).join(' ');
  return { content: [{ type: 'text', text }], structuredContent: out };
}

export interface McpReply { status: number; body: unknown | null }

/** One HTTP POST: a JSON-RPC message in, a status and a JSON body (or none) out. */
export function handleMcp(msg: any, headers: { protocolVersion?: string | null } = {}): McpReply {
  const err = (status: number, id: unknown, code: number, message: string, data?: unknown): McpReply =>
    ({ status, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } } });
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return err(400, msg?.id, -32600, 'Invalid Request: send one JSON-RPC 2.0 message.');
  const asked = headers.protocolVersion ?? msg.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? null;
  if (asked && !SUPPORTED.includes(asked))
    return err(400, msg.id, -32022, 'Unsupported protocol version', { supported: SUPPORTED, requested: asked });
  const isNote = !('id' in msg);
  if (isNote) return { status: 202, body: null }; // notifications/initialized and friends: nothing to say
  const ok = (result: unknown): McpReply => ({ status: 200, body: { jsonrpc: '2.0', id: msg.id, result } });
  switch (msg.method) {
    case 'initialize': {
      const want = msg.params?.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'slim-chance', title: 'Slim Chance', version: '1.0.0', websiteUrl: 'https://slimchance.app' },
        instructions: 'Slim Chance turns dated morning scale readings into an honest weight trend and the chance in 10 that it is really moving. Ask the person for their recent morning weights with dates (a week or more), then call slim_chance. Nothing is stored.',
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: [TOOL] });
    case 'tools/call':
      if (msg.params?.name !== TOOL.name) return err(200, msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      return ok(slimChance(msg.params?.arguments ?? {}));
    default: return err(404, msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
