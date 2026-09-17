-- Phase 2 Task 2. Review against the deployed Phase 1 schema before applying.
-- No moderator is granted access automatically. Manage membership only using
-- a trusted SQL administrator; never expose a service-role key in the browser.
begin;

create table public.community_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.community_moderators enable row level security;
revoke all on public.community_moderators from anon, authenticated;

create function public.can_moderate()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.community_moderators where user_id = (select auth.uid())
  );
$$;
revoke all on function public.can_moderate() from public;
grant execute on function public.can_moderate() to anon, authenticated;

alter table public.gathering_submissions enable row level security;
alter table public.gatherings enable row level security;
alter table public.prayer_requests enable row level security;

-- Existing guest INSERT policies are preserved; submissions are never a public queue.
create policy moderation_submission_read_guard on public.gathering_submissions
  as restrictive for select to anon, authenticated
  using ((select public.can_moderate()));
create policy moderation_submission_read on public.gathering_submissions
  for select to authenticated using ((select public.can_moderate()));
grant select on public.gathering_submissions to authenticated;
-- Status changes / publication happen only in the transactional function below.
revoke update, delete on public.gathering_submissions from anon, authenticated;
revoke insert on public.gatherings from anon, authenticated;

create policy moderation_prayer_read on public.prayer_requests
  for select to authenticated using ((select public.can_moderate()));
create policy moderation_prayer_update on public.prayer_requests
  for update to authenticated using ((select public.can_moderate()))
  with check ((select public.can_moderate()));
create policy moderation_prayer_delete on public.prayer_requests
  for delete to authenticated using ((select public.can_moderate()));
grant select, delete on public.prayer_requests to authenticated;
grant update (is_public) on public.prayer_requests to authenticated;

create index moderation_pending_created_at on public.gathering_submissions (created_at desc)
  where status = 'pending';
create index moderation_prayer_created_at on public.prayer_requests (created_at desc);

create function public.moderate_gathering(p_submission_id uuid, p_action text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  submission public.gathering_submissions%rowtype;
  payload jsonb;
  lat double precision;
  lng double precision;
  point_location public.gatherings.location%type;
begin
  if not public.can_moderate() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve', 'reject') then
    raise exception 'Invalid moderation action' using errcode = '22023';
  end if;

  -- Serializes two moderators reviewing the same submission. No second insert.
  select * into submission from public.gathering_submissions
    where id = p_submission_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if submission.status <> 'pending' then
    return false;
  end if;

  if p_action = 'approve' then
    payload := submission.gathering_data;
    if jsonb_typeof(payload) is distinct from 'object'
      or coalesce(btrim(payload->>'name'), '') = ''
      or coalesce(btrim(payload->>'address'), '') = ''
      or coalesce(btrim(payload->>'meeting_time'), '') = ''
      or coalesce(btrim(payload->>'leader_name'), '') = '' then
      raise exception 'Submission details are incomplete' using errcode = '22023';
    end if;
    lat := (payload->>'latitude')::double precision;
    lng := (payload->>'longitude')::double precision;
    -- Coordinates must be verified before publishing a map entry.
    if lat is null or lng is null or not (lat between -90 and 90)
      or not (lng between -180 and 180) then
      raise exception 'Verified coordinates are required' using errcode = '22023';
    end if;
    -- Assignment uses the existing geography column type, regardless of the
    -- PostGIS extension schema. WKT always uses longitude before latitude.
    point_location := format('SRID=4326;POINT(%s %s)', lng, lat);
    insert into public.gatherings
      (name, description, leader_name, contact_email, meeting_time, address, location)
    values (payload->>'name', payload->>'description', payload->>'leader_name',
      payload->>'contact_email', payload->>'meeting_time', payload->>'address', point_location);
    update public.gathering_submissions set status = 'approved' where id = p_submission_id;
  else
    update public.gathering_submissions set status = 'rejected' where id = p_submission_id;
  end if;
  -- Any failure rolls back both insert and status update in this transaction.
  return true;
end;
$$;
revoke all on function public.moderate_gathering(uuid, text) from public;
grant execute on function public.moderate_gathering(uuid, text) to authenticated;
commit;
