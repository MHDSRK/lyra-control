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
