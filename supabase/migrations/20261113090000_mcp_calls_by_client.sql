-- Who calls the MCP server, and from where? (2026-11-13). Since the 11-10
-- listing: about 1,000 connections and 6 real tool calls, and the count could
-- not say whether those were directory robots or people's assistants, nor
-- from which countries. Each daily row now also carries a short label for the
-- caller (its own name, or its User-Agent's first word) and a two-letter
-- country from Vercel. Still no weights, no addresses, nothing from the
-- arguments; still written only through note_mcp_call, read only by the owner.
begin;

alter table public.mcp_calls add column if not exists client text not null default '';
alter table public.mcp_calls add column if not exists country text not null default '';
alter table public.mcp_calls drop constraint if exists mcp_calls_pkey;
alter table public.mcp_calls add primary key (day, tool, client, country);

-- Replaced, not overloaded: two signatures would make the call ambiguous. The
-- defaults keep the route deployed before this change working.
drop function if exists public.note_mcp_call(text);
create or replace function public.note_mcp_call(p_tool text, p_client text default '', p_country text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  -- Anyone can call this, so the database cleans what it is given too.
  v_client text := left(regexp_replace(lower(coalesce(p_client, '')), '[^a-z0-9 ._-]', '', 'g'), 40);
  v_country text := case when p_country ~ '^[A-Z]{2}$' then p_country else '' end;
begin
  if p_tool not in ('initialize', 'tools/list', 'slim_chance', 'body_signals') then
    return;
  end if;
  -- ponytail: a flood of made-up labels could only add rows; past 500 rows in
  -- a day, new ones fold into 'other'. Per-label caps if that ever matters.
  if not exists (select 1 from public.mcp_calls c where c.day = today and c.tool = p_tool and c.client = v_client and c.country = v_country)
     and (select count(*) from public.mcp_calls c where c.day = today) >= 500 then
    v_client := 'other';
    v_country := '';
  end if;
  insert into public.mcp_calls (day, tool, client, country, n) values (today, p_tool, v_client, v_country, 1)
  on conflict (day, tool, client, country) do update set n = public.mcp_calls.n + 1;
end;
$$;
revoke all on function public.note_mcp_call(text, text, text) from public;
grant execute on function public.note_mcp_call(text, text, text) to anon, authenticated;

commit;
