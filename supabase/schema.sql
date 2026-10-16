create extension if not exists pgcrypto;
create table if not exists public.lyra_calls (
  interaction_id text primary key,
  caller_number text,
  agent_number text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds numeric not null default 0,
  summary text,
  outcome text,
  transcript jsonb,
  transcript_text text,
  agent_variables jsonb not null default '{}'::jsonb,
  urgent boolean not null default false,
  failed boolean not null default false,
  end_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lyra_calls_started_at_idx on public.lyra_calls(started_at desc);
create index if not exists lyra_calls_attention_idx on public.lyra_calls(urgent,failed,started_at desc);
alter table public.lyra_calls enable row level security;
-- The browser's anon/authenticated roles have no direct access. API routes authorize the owner
-- and use the server-only service role. Add a narrower owner policy if you later add multi-user access.
revoke all on public.lyra_calls from anon, authenticated;

create table if not exists public.lyra_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lyra_push_subscriptions enable row level security;
revoke all on public.lyra_push_subscriptions from anon, authenticated;
create index if not exists lyra_push_user_idx on public.lyra_push_subscriptions(user_id);
