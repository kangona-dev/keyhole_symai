-- Keyhole scalability, correctness and abuse fixes.
-- Run after 001_keyhole.sql: Supabase > SQL Editor > New query > Run.
-- Incremental and safe to re-run. It keeps existing data.

-- =====================================================================
-- Documents: rows are saved as "pending" before the file is uploaded,
-- then marked uploaded. A failed upload never leaves an orphaned file,
-- and stale pending rows are swept by the cleanup job.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents' and column_name = 'uploaded_at'
  ) then
    alter table public.documents add column uploaded_at timestamptz;
    -- Everything uploaded before this migration is complete.
    update public.documents set uploaded_at = created_at;
  end if;
end $$;

create index if not exists documents_pending_idx on public.documents (created_at) where uploaded_at is null;

-- =====================================================================
-- Applications: one preferred applicant per listing, declined timestamp
-- for the cleanup job, and indexes for paginating applicants.
-- =====================================================================

alter table public.applications add column if not exists declined_at timestamptz;
update public.applications set declined_at = now() where status = 'declined' and declined_at is null;

-- Make sure (listing_id, renter_id) is unique so "insert or return existing" works.
do $$
begin
  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.applications'::regclass
      and i.indisunique
      and (
        select array_agg(a.attname::text order by a.attname)
        from pg_attribute a
        where a.attrelid = i.indrelid and a.attnum = any (i.indkey)
      ) = array['listing_id', 'renter_id']
  ) then
    create unique index applications_listing_renter_key on public.applications (listing_id, renter_id);
  end if;
end $$;

-- Existing data may already have several preferred applicants on one listing.
-- Keep the earliest applicant as preferred and re-lock everyone else's ID.
with ranked as (
  select id, row_number() over (partition by listing_id order by created_at, id) as rn
  from public.applications
  where status = 'preferred'
),
demoted as (
  update public.applications a
  set status = 'submitted'
  from ranked r
  where a.id = r.id and r.rn > 1
  returning a.id
)
update public.share_grants g
set doc_types = array_remove(g.doc_types, 'id')
from demoted d
where g.application_id = d.id;

-- The database itself now refuses a second preferred applicant.
create unique index if not exists applications_one_preferred_per_listing
  on public.applications (listing_id) where status = 'preferred';

create index if not exists applications_listing_created_idx on public.applications (listing_id, created_at);
create index if not exists applications_declined_idx on public.applications (declined_at) where status = 'declined';
create index if not exists listings_agency_created_idx on public.listings (agency_id, created_at desc);

-- =====================================================================
-- Storage cleanup queue. Deleting a row that owns a file (directly or via
-- a cascade) queues the file; the cleanup job removes it through the
-- Storage API, because Supabase doesn't allow deleting storage.objects in SQL.
-- =====================================================================

create table if not exists public.storage_cleanup (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  queued_at timestamptz not null default now()
);
alter table public.storage_cleanup enable row level security;

create or replace function public.queue_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_cleanup (bucket, path) values (tg_argv[0], old.storage_path);
  return old;
end;
$$;

drop trigger if exists documents_queue_file_cleanup on public.documents;
create trigger documents_queue_file_cleanup
  after delete on public.documents
  for each row execute function public.queue_storage_cleanup('documents');

-- =====================================================================
-- Watermark cache: one stamped copy per grant, document and agent, kept in
-- the private 'stamped' bucket and served through short-lived signed URLs.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('stamped', 'stamped', false)
on conflict (id) do update set public = false;

create table if not exists public.stamped_copies (
  grant_id uuid not null references public.share_grants on delete cascade,
  document_id uuid not null references public.documents on delete cascade,
  viewer_id uuid not null references public.profiles on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now(),
  primary key (grant_id, document_id, viewer_id)
);
create index if not exists stamped_copies_document_idx on public.stamped_copies (document_id);
create index if not exists stamped_copies_viewer_idx on public.stamped_copies (viewer_id);
alter table public.stamped_copies enable row level security;

drop trigger if exists stamped_copies_queue_file_cleanup on public.stamped_copies;
create trigger stamped_copies_queue_file_cleanup
  after delete on public.stamped_copies
  for each row execute function public.queue_storage_cleanup('stamped');

-- =====================================================================
-- Share grant changes: push to the agent's open viewer over Supabase
-- Realtime (private broadcast channel "grant:<token>"), and drop stamped
-- copies the agent may no longer see.
-- =====================================================================

create or replace function public.on_share_grant_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    begin
      perform realtime.send(
        jsonb_build_object('revoked', true, 'deleted', true),
        'grant_changed',
        'grant:' || old.token::text,
        true
      );
    exception when others then
      raise warning 'Realtime notify failed for grant %: %', old.id, sqlerrm;
    end;
    return old;
  end if;

  if new.revoked_at is distinct from old.revoked_at
     or new.expires_at is distinct from old.expires_at
     or new.doc_types is distinct from old.doc_types then
    -- A Realtime outage must never block a revoke, so failures are only logged.
    begin
      perform realtime.send(
        jsonb_build_object(
          'revoked', new.revoked_at is not null,
          'expires_at', new.expires_at,
          'doc_types', to_jsonb(new.doc_types)
        ),
        'grant_changed',
        'grant:' || new.token::text,
        true
      );
    exception when others then
      raise warning 'Realtime notify failed for grant %: %', new.id, sqlerrm;
    end;
  end if;

  if new.revoked_at is not null and old.revoked_at is null then
    delete from public.stamped_copies where grant_id = new.id;
  elsif new.doc_types is distinct from old.doc_types then
    delete from public.stamped_copies s
    using public.documents d
    where s.grant_id = new.id and d.id = s.document_id and not (d.type = any (new.doc_types));
  end if;
  return new;
end;
$$;

drop trigger if exists share_grants_changed on public.share_grants;
create trigger share_grants_changed
  after update or delete on public.share_grants
  for each row execute function public.on_share_grant_change();

-- Who may listen on "grant:<token>": agents at the listing's agency.
-- Security definer because the tables have RLS with no public policies.
create or replace function public.can_receive_grant_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_topic ~ '^grant:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then exists (
      select 1
      from public.share_grants g
      join public.applications a on a.id = g.application_id
      join public.listings l on l.id = a.listing_id
      join public.profiles p on p.agency_id = l.agency_id
      where g.token = substr(p_topic, 7)::uuid
        and p.id = auth.uid()
        and p.role = 'agent'
    )
    else false
  end;
$$;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    drop policy if exists "Agents receive grant changes for their agency" on realtime.messages;
    create policy "Agents receive grant changes for their agency"
      on realtime.messages
      for select
      to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and public.can_receive_grant_topic((select realtime.topic()))
      );
  else
    raise warning 'realtime.messages not found: enable Realtime, then re-run this migration.';
  end if;
end $$;

-- =====================================================================
-- One round trip for every grant check (was three queries in a row).
-- Returns the grant, application, listing and, optionally, the document
-- plus its cached stamped copy for this agent.
-- =====================================================================

create or replace function public.check_grant_access(p_token uuid, p_agent uuid, p_document uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  d record;
  result jsonb;
begin
  select g.id as grant_id, g.token, g.doc_types, g.expires_at, g.revoked_at,
         a.id as application_id, a.renter_id, a.status,
         l.id as listing_id, l.address, l.agency_id,
         p.role as agent_role, p.agency_id as agent_agency_id
  into r
  from public.share_grants g
  join public.applications a on a.id = g.application_id
  join public.listings l on l.id = a.listing_id
  left join public.profiles p on p.id = p_agent
  where g.token = p_token;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if r.agent_role is distinct from 'agent' or r.agent_agency_id is null or r.agent_agency_id <> r.agency_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if r.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if r.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  result := jsonb_build_object(
    'ok', true,
    'grant', jsonb_build_object(
      'id', r.grant_id, 'token', r.token, 'doc_types', to_jsonb(r.doc_types),
      'expires_at', r.expires_at, 'revoked_at', r.revoked_at
    ),
    'application', jsonb_build_object('id', r.application_id, 'renter_id', r.renter_id, 'status', r.status),
    'listing', jsonb_build_object('id', r.listing_id, 'address', r.address, 'agency_id', r.agency_id),
    'document', null
  );

  if p_document is not null then
    select doc.id, doc.type, doc.storage_path, doc.content_type, s.storage_path as stamped_path
    into d
    from public.documents doc
    left join public.stamped_copies s
      on s.document_id = doc.id and s.grant_id = r.grant_id and s.viewer_id = p_agent
    where doc.id = p_document and doc.owner_id = r.renter_id and doc.uploaded_at is not null;
    if found then
      result := result || jsonb_build_object('document', jsonb_build_object(
        'id', d.id, 'type', d.type, 'storage_path', d.storage_path,
        'content_type', d.content_type, 'stamped_path', d.stamped_path
      ));
    end if;
  end if;
  return result;
end;
$$;

-- =====================================================================
-- Applying: insert or return the existing application, and create its
-- share grant in the same transaction. A double-click is harmless.
-- =====================================================================

create or replace function public.apply_to_listing(p_listing uuid, p_renter uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_created boolean := true;
begin
  if not exists (select 1 from public.profiles where id = p_renter and role = 'renter') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not exists (select 1 from public.listings where id = p_listing) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into public.applications (listing_id, renter_id, answers)
  values (p_listing, p_renter, coalesce(p_answers, '{}'::jsonb))
  on conflict (listing_id, renter_id) do nothing
  returning id into v_id;

  if v_id is null then
    v_created := false;
    select id into v_id from public.applications where listing_id = p_listing and renter_id = p_renter;
  end if;

  insert into public.share_grants (application_id, doc_types)
  values (v_id, array['payslip', 'reference'])
  on conflict (application_id) do nothing;

  return jsonb_build_object('ok', true, 'application_id', v_id, 'created', v_created);
end;
$$;

-- =====================================================================
-- Preferred applicant: one per listing, switched atomically. The listing
-- row is locked so two agents clicking at once are serialised. The
-- previous preferred applicant's ID is locked again.
-- =====================================================================

create or replace function public.set_preferred_applicant(p_application uuid, p_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing uuid;
  v_agency uuid;
  v_previous uuid;
begin
  select listing_id into v_listing from public.applications where id = p_application;
  if v_listing is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select agency_id into v_agency from public.listings where id = v_listing for update;
  if not exists (
    select 1 from public.profiles where id = p_agent and role = 'agent' and agency_id = v_agency
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if exists (
    select 1 from public.share_grants where application_id = p_application and revoked_at is not null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'revoked', 'listing_id', v_listing);
  end if;

  update public.applications
  set status = 'submitted'
  where listing_id = v_listing and status = 'preferred' and id <> p_application
  returning id into v_previous;

  if v_previous is not null then
    update public.share_grants
    set doc_types = array_remove(doc_types, 'id')
    where application_id = v_previous;
  end if;

  update public.applications set status = 'preferred', declined_at = null where id = p_application;
  update public.share_grants
  set doc_types = array['payslip', 'reference', 'id']
  where application_id = p_application;

  return jsonb_build_object('ok', true, 'listing_id', v_listing, 'previous', v_previous);
end;
$$;

-- Declining stops sharing straight away; the cleanup job deletes the
-- application (and its grant and access log) after the retention period.
create or replace function public.decline_application(p_application uuid, p_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing uuid;
  v_agency uuid;
begin
  select listing_id into v_listing from public.applications where id = p_application;
  if v_listing is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select agency_id into v_agency from public.listings where id = v_listing for update;
  if not exists (
    select 1 from public.profiles where id = p_agent and role = 'agent' and agency_id = v_agency
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update public.applications set status = 'declined', declined_at = now() where id = p_application;
  update public.share_grants set doc_types = '{}' where application_id = p_application;
  return jsonb_build_object('ok', true, 'listing_id', v_listing);
end;
$$;

-- =====================================================================
-- Agent dashboard counts without loading every application row.
-- =====================================================================

create or replace view public.listing_summaries
with (security_invoker = true)
as
select
  l.id,
  l.agency_id,
  l.address,
  l.weekly_rent,
  l.created_at,
  (select count(*) from public.applications a where a.listing_id = l.id)::int as application_count,
  (select count(*) from public.listing_questions q where q.listing_id = l.id and q.flagged_reason is not null)::int as flagged_count
from public.listings l;

revoke all on public.listing_summaries from anon, authenticated;

-- =====================================================================
-- Access log: partitioned by month (UTC), old months moved to an archive.
-- =====================================================================

create table if not exists public.access_log_archive (
  id uuid not null,
  grant_id uuid not null,
  viewer_id uuid,
  document_id uuid,
  viewed_at timestamptz not null,
  archived_at timestamptz not null default now()
);
create index if not exists access_log_archive_grant_idx on public.access_log_archive (grant_id, viewed_at desc);
alter table public.access_log_archive enable row level security;

-- Creates monthly partitions from the oldest stray row (or this month) up to
-- p_months_ahead months ahead. Rows that landed in the default partition are
-- moved into their month's partition.
create or replace function public.ensure_access_log_partitions(p_months_ahead int default 3)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  m date;
  next_m date;
  stop date := (date_trunc('month', now()) + make_interval(months => p_months_ahead))::date;
  part text;
  created int := 0;
begin
  if to_regclass('public.access_log_default') is null then
    create table public.access_log_default partition of public.access_log default;
    alter table public.access_log_default enable row level security;
    revoke all on public.access_log_default from anon, authenticated;
  end if;

  select least(
    coalesce(date_trunc('month', min(viewed_at))::date, date_trunc('month', now())::date),
    date_trunc('month', now())::date
  )
  into m
  from public.access_log_default;

  while m <= stop loop
    next_m := (m + interval '1 month')::date;
    part := 'access_log_' || to_char(m, 'YYYY_MM');
    if to_regclass('public.' || part) is null then
      execute format('create table public.%I (like public.access_log including defaults)', part);
      execute format(
        'insert into public.%I select * from public.access_log_default where viewed_at >= %L and viewed_at < %L',
        part, m, next_m
      );
      execute format('delete from public.access_log_default where viewed_at >= %L and viewed_at < %L', m, next_m);
      execute format('alter table public.access_log attach partition public.%I for values from (%L) to (%L)', part, m, next_m);
      -- RLS isn't inherited by partitions, so lock each one down too.
      execute format('alter table public.%I enable row level security', part);
      execute format('revoke all on public.%I from anon, authenticated', part);
      created := created + 1;
    end if;
    m := next_m;
  end loop;
  return created;
end;
$$;

-- Moves whole months older than p_keep_months into access_log_archive and
-- drops their partitions. Returns the number of rows archived.
create or replace function public.archive_access_log(p_keep_months int default 12)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff date := (date_trunc('month', now()) - make_interval(months => p_keep_months))::date;
  r record;
  n int;
  total int := 0;
begin
  for r in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.access_log'::regclass
      and c.relname ~ '^access_log_[0-9]{4}_[0-9]{2}$'
  loop
    if to_date(substr(r.relname, 12), 'YYYY_MM') < cutoff then
      execute format(
        'insert into public.access_log_archive (id, grant_id, viewer_id, document_id, viewed_at)
         select id, grant_id, viewer_id, document_id, viewed_at from public.%I',
        r.relname
      );
      get diagnostics n = row_count;
      total := total + n;
      execute format('alter table public.access_log detach partition public.%I', r.relname);
      execute format('drop table public.%I', r.relname);
    end if;
  end loop;

  if to_regclass('public.access_log_default') is not null then
    insert into public.access_log_archive (id, grant_id, viewer_id, document_id, viewed_at)
    select id, grant_id, viewer_id, document_id, viewed_at
    from public.access_log_default
    where viewed_at < cutoff;
    get diagnostics n = row_count;
    total := total + n;
    delete from public.access_log_default where viewed_at < cutoff;
  end if;
  return total;
end;
$$;

-- Convert the existing access_log into a partitioned table (once).
do $$
begin
  if (
    select c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'access_log'
  ) = 'r' then
    alter table public.access_log rename to access_log_unpartitioned;
    alter table public.access_log_unpartitioned rename constraint access_log_pkey to access_log_unpartitioned_pkey;

    create table public.access_log (
      id uuid not null default gen_random_uuid(),
      grant_id uuid not null references public.share_grants on delete cascade,
      viewer_id uuid references public.profiles on delete set null,
      document_id uuid references public.documents on delete cascade,
      viewed_at timestamptz not null default now(),
      primary key (id, viewed_at)
    ) partition by range (viewed_at);

    create index access_log_grant_viewed_idx on public.access_log (grant_id, viewed_at desc);
    create index access_log_document_idx on public.access_log (document_id);
    alter table public.access_log enable row level security;

    perform public.ensure_access_log_partitions();
    insert into public.access_log (id, grant_id, viewer_id, document_id, viewed_at)
    select id, grant_id, viewer_id, document_id, viewed_at from public.access_log_unpartitioned;
    -- Older rows went to the default partition; this moves them into their months.
    perform public.ensure_access_log_partitions();

    drop table public.access_log_unpartitioned;
  end if;
end $$;

select public.ensure_access_log_partitions();

-- =====================================================================
-- Rate limiting: fixed-window counters. Unlogged because losing counters
-- on a crash is fine and it keeps writes cheap.
-- =====================================================================

create unlogged table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;

-- Records one hit and returns true if the caller is still within the limit.
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n int;
begin
  insert into public.rate_limits as rl (key, window_start, hits)
  values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = rl.hits + 1
  returning hits into n;
  return n <= p_limit;
end;
$$;

-- =====================================================================
-- Scheduled cleanup, called daily by /api/cron/cleanup. Files are queued
-- in storage_cleanup by the triggers above and removed by that route.
-- =====================================================================

create or replace function public.run_cleanup(
  p_declined_after interval default interval '30 days',
  p_pending_after interval default interval '1 hour',
  p_batch int default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired uuid[];
  v_declined int;
  v_stamped int;
  v_pending int;
  v_rate int;
  v_partitions int;
  v_archived int;
begin
  -- Declined applications past the retention period. Deleting the application
  -- cascades to its share grant, stamped copies and access log. Archived log
  -- rows have no foreign key, so remove them explicitly.
  select array_agg(id) into v_expired
  from (
    select id from public.applications
    where status = 'declined' and declined_at < now() - p_declined_after
    order by declined_at
    limit p_batch
  ) s;

  delete from public.access_log_archive al
  using public.share_grants g
  where al.grant_id = g.id and g.application_id = any (v_expired);

  delete from public.applications where id = any (v_expired);
  get diagnostics v_declined = row_count;

  -- Stamped copies for grants that have expired or been revoked.
  delete from public.stamped_copies s
  using public.share_grants g
  where s.grant_id = g.id and (g.expires_at < now() or g.revoked_at is not null);
  get diagnostics v_stamped = row_count;

  -- Uploads that never finished. Their paths are queued in case the file landed.
  delete from public.documents where uploaded_at is null and created_at < now() - p_pending_after;
  get diagnostics v_pending = row_count;

  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;

  v_partitions := public.ensure_access_log_partitions();
  v_archived := public.archive_access_log();

  return jsonb_build_object(
    'declined_applications_deleted', v_declined,
    'stamped_copies_deleted', v_stamped,
    'pending_uploads_deleted', v_pending,
    'rate_limit_rows_deleted', v_rate,
    'access_log_partitions_created', v_partitions,
    'access_log_rows_archived', v_archived
  );
end;
$$;

-- =====================================================================
-- Only Keyhole's server (service role) may call these functions.
-- Supabase grants EXECUTE to anon and authenticated by default.
-- =====================================================================

revoke execute on function public.check_grant_access(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.apply_to_listing(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.set_preferred_applicant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.decline_application(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ensure_access_log_partitions(int) from public, anon, authenticated;
revoke execute on function public.archive_access_log(int) from public, anon, authenticated;
revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
revoke execute on function public.run_cleanup(interval, interval, int) from public, anon, authenticated;
revoke execute on function public.queue_storage_cleanup() from public, anon, authenticated;
revoke execute on function public.on_share_grant_change() from public, anon, authenticated;

grant execute on function public.check_grant_access(uuid, uuid, uuid) to service_role;
grant execute on function public.apply_to_listing(uuid, uuid, jsonb) to service_role;
grant execute on function public.set_preferred_applicant(uuid, uuid) to service_role;
grant execute on function public.decline_application(uuid, uuid) to service_role;
grant execute on function public.ensure_access_log_partitions(int) to service_role;
grant execute on function public.archive_access_log(int) to service_role;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
grant execute on function public.run_cleanup(interval, interval, int) to service_role;

-- The Realtime policy runs as the signed-in user, so they need this one.
revoke execute on function public.can_receive_grant_topic(text) from public, anon;
grant execute on function public.can_receive_grant_topic(text) to authenticated;
