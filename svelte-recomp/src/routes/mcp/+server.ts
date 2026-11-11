// The MCP endpoint (src/lib/mcp.ts): moves bytes, decides nothing.
import { handleMcp } from '$lib/mcp';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$env/static/public';
import type { RequestHandler } from './$types';

export const prerender = false;

// ponytail: any Origin is accepted. The spec's Origin check guards local
// servers from DNS rebinding; this one is public, keeps no state and reads no
// cookies, so a page calling it gains nothing a direct call wouldn't.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Authorization',
};
const MAX_BYTES = 64 * 1024;

export const POST: RequestHandler = async ({ request }) => {
  const raw = await request.text();
  let msg: unknown = null;
  if (raw.length > MAX_BYTES) msg = { tooBig: true };
  else { try { msg = JSON.parse(raw); } catch { /* answered below */ } }
  const r = msg === null
    ? { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } }
    : handleMcp(msg, { protocolVersion: request.headers.get('mcp-protocol-version') });
  // The app's own agent (supabase/functions/ask) isn't someone using the server.
  if (r.status === 200 && request.headers.get('x-slimchance-from') !== 'ask') await count(msg as { method?: string; params?: { name?: string } });
  return r.body == null
    ? new Response(null, { status: r.status, headers: CORS })
    : new Response(JSON.stringify(r.body), { status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
};

/** One more call today for this tool, in our own database: the tool's name and
 *  the date, nothing anyone sent (migration 20261110130000_mcp_calls). Never
 *  slows or breaks an answer: a short timeout, and any failure is ignored. */
async function count(msg: { method?: string; params?: { name?: string } }) {
  const tool = msg.method === 'tools/call' ? msg.params?.name : msg.method;
  if (tool !== 'initialize' && tool !== 'tools/list' && tool !== 'slim_chance' && tool !== 'body_signals') return;
  try {
    await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/rpc/note_mcp_call`, {
      method: 'POST', signal: AbortSignal.timeout(800),
      headers: { apikey: PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_tool: tool }),
    });
  } catch { /* counting is never worth a failed answer */ }
}

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });

// No server-to-client stream and no sessions: the spec's answer is 405.
const notAllowed: RequestHandler = () => new Response(null, { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
export const GET = notAllowed;
export const DELETE = notAllowed;
