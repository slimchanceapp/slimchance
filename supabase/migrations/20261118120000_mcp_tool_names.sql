-- The MCP tools get plain verb names (2026-11-18): ChatGPT's directory wants
-- plain-language, verb-based tool names. slim_chance is now get_weight_trend
-- and body_signals is get_body_signals; the server still answers the first
-- names and counts every call under the new one. Past counts move with the
-- name, so the owner's numbers carry on. Same function otherwise
-- (20261113090000_mcp_calls_by_client).
begin;

update public.mcp_calls set tool = 'get_weight_trend' where tool = 'slim_chance';
update public.mcp_calls set tool = 'get_body_signals' where tool = 'body_signals';

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
  if p_tool not in ('initialize', 'tools/list', 'get_weight_trend', 'get_body_signals') then
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
