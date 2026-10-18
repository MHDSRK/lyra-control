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


-- LYRA inbox/message/retention additions; safe for existing installations.
alter table public.lyra_calls
  add column if not exists inbox_status text not null default 'needs_attention',
  add column if not exists message_for text,
  add column if not exists message_for_canonical text,
  add column if not exists message_content text,
  add column if not exists message_saved boolean not null default false,
  add column if not exists message_urgency text,
  add column if not exists message_deadline text,
  add column if not exists message_reviewed_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists recording_url text,
  add column if not exists recording_available boolean not null default false,
  add column if not exists transcript_available boolean not null default false,
  add column if not exists summary_available boolean not null default false,
  add column if not exists processing_status text not null default 'received',
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz,
  add column if not exists owner_aliases_mentioned text[] not null default '{}';

update public.lyra_calls
set transcript_available = case when jsonb_typeof(transcript) = 'array' then jsonb_array_length(transcript) > 0 else false end,
    summary_available = (nullif(trim(coalesce(summary, '')), '') is not null),
    processing_status = 'processed'
where processing_status = 'received';

create index if not exists lyra_calls_caller_started_idx on public.lyra_calls(caller_number, started_at desc);
create index if not exists lyra_calls_inbox_status_idx on public.lyra_calls(inbox_status, started_at desc);
create index if not exists lyra_calls_message_saved_idx on public.lyra_calls(message_saved, started_at desc);

create table if not exists public.lyra_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.lyra_settings enable row level security;
revoke all on public.lyra_settings from anon, authenticated;

create table if not exists public.lyra_notification_events (
  id uuid primary key default gen_random_uuid(),
  interaction_id text references public.lyra_calls(interaction_id) on delete cascade,
  dedupe_key text not null unique,
  channel text not null check (channel in ('push','email')),
  event_type text not null,
  status text not null check (status in ('pending','accepted_by_provider','failed','not_configured')),
  provider_accepted_count integer,
  attempted_at timestamptz not null default now(),
  error_message text
);
alter table public.lyra_notification_events enable row level security;
revoke all on public.lyra_notification_events from anon, authenticated;
create index if not exists lyra_notification_events_interaction_idx on public.lyra_notification_events(interaction_id, attempted_at desc);

-- Existing rows are intentionally left as Needs attention rather than being falsely marked Reviewed.
