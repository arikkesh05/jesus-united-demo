-- Milestone B — Gathering Inquiries pipeline
-- Insert-only schema: anonymous clients can submit but NEVER read
-- Architectural invariant: zero SELECT exposure for anon clients

-- Extension for uuid generation
create extension if not exists "pgcrypto";

-- Target table
create table if not exists public.gathering_inquiries (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  text not null,
  visitor_name  text not null,
  contact       text not null,
  message       text,
  status        text not null default 'pending' check (status in ('pending', 'read', 'archived')),
  created_at    timestamptz not null default timezone('utc'::text, now())
);

-- Performance indexes
create index if not exists idx_gathering_inquiries_gathering_id
  on public.gathering_inquiries(gathering_id);

create index if not exists idx_gathering_inquiries_created_at
  on public.gathering_inquiries(created_at desc);

-- Enforce insert-only posture for anonymous clients
alter table public.gathering_inquiries enable row level security;

-- INSERT policy — strict client-side + server-side validation bounds
create policy "anon can insert gathering inquiries"
  on public.gathering_inquiries
  for insert
  to anon authenticated
  with check (
    char_length(trim(visitor_name)) between 1 and 80
    and char_length(trim(contact)) between 3 and 120
    and (message is null or char_length(trim(message)) <= 1000)
  );

-- NO anon SELECT policy — zero read surface (by design)

-- Service role full access (for host dashboard ingestion only)
create policy "service_role full access to gathering_inquiries"
  on public.gathering_inquiries
  for all
  to service_role
  using (true)
  with check (true);

-- Comment documentation
comment on table public.gathering_inquiries is 'Insert-only inquiries from globe Connect modal. Never expose host PII.';