-- Keyhole database schema.
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to re-run: it drops and recreates the Keyhole tables (demo data only).

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop table if exists public.access_log cascade;
drop table if exists public.share_grants cascade;
drop table if exists public.applications cascade;
drop table if exists public.listing_questions cascade;
drop table if exists public.listings cascade;
drop table if exists public.documents cascade;
drop table if exists public.profiles cascade;
drop table if exists public.agencies cascade;

-- Agencies (real estate offices)
create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- One profile per signed-up user: a renter, or an agent at an agency
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null check (role in ('renter', 'agent')),
  agency_id uuid references public.agencies on delete set null,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- A renter's documents. Files live in the private 'documents' storage bucket.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete cascade,
  type text not null check (type in ('id', 'payslip', 'reference')),
  storage_path text not null,
  content_type text not null default 'image/png',
  file_name text,
  sensitivity text not null default 'normal',
  created_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies on delete cascade,
  created_by uuid references public.profiles on delete set null,
  address text not null,
  weekly_rent integer,
  created_at timestamptz not null default now()
);

create table public.listing_questions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings on delete cascade,
  position integer not null default 0,
  question text not null,
  flagged_reason text
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings on delete cascade,
  renter_id uuid not null references public.profiles on delete cascade,
  status text not null default 'submitted' check (status in ('submitted', 'preferred', 'declined')),
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (listing_id, renter_id)
);

-- What an agent may see for one application. The token is a random UUID,
-- never a sequential number, and every view is checked on the server.
create table public.share_grants (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  doc_types text[] not null default array['payslip', 'reference'],
  expires_at timestamptz not null default (now() + interval '14 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Append-only record of every document view
create table public.access_log (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.share_grants on delete cascade,
  viewer_id uuid references public.profiles on delete set null,
  document_id uuid references public.documents on delete cascade,
  viewed_at timestamptz not null default now()
);

create index on public.documents (owner_id);
create index on public.listings (agency_id);
create index on public.listing_questions (listing_id, position);
create index on public.applications (listing_id);
create index on public.applications (renter_id);
create index on public.access_log (grant_id, viewed_at desc);

-- Row Level Security on every table, with no public policies:
-- browsers can't read or write any table directly. All access goes through
-- Keyhole's server code, which checks who you are and what you may see.
alter table public.agencies enable row level security;
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.listings enable row level security;
alter table public.listing_questions enable row level security;
alter table public.applications enable row level security;
alter table public.share_grants enable row level security;
alter table public.access_log enable row level security;

-- Create a profile automatically when someone signs up
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, agency_id, display_name)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'agent' then 'agent' else 'renter' end,
    nullif(new.raw_user_meta_data ->> 'agency_id', '')::uuid,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Demo agencies (synthetic)
insert into public.agencies (name) values
  ('Harbour Realty'),
  ('Kensington Property Co');

-- Private storage bucket for renter documents
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;
