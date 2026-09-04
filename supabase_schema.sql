-- ============================================================================
-- Priority Tracker — Supabase schema + Row Level Security
-- ============================================================================
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)
-- on a fresh project. It's written to run top-to-bottom in one go.
--
-- Design note, read this before running:
-- The current Claude-artifact version stores everything as opaque JSON blobs
-- in a key-value store (window.storage), because that's all it had. It builds
-- its own "week rollover," "archive," and "identity" logic in JavaScript to
-- work around not having a real database. None of those workarounds are
-- needed here:
--   - "Archives" disappear entirely. Priorities are just rows with a
--     week_start column — history is "select where week_start = X," not a
--     separate snapshot system.
--   - The "claim your ticket" soft identity picker becomes real Supabase Auth.
--     A signed-in user IS an identity; no browser-remembered guesswork.
--   - The manual "keep the P1/follow-up text in sync with the source
--     priority" code (syncLinkedText in the current app) becomes unnecessary —
--     a foreign key + join is always live, so there's nothing to keep in sync.
-- This is why the schema below doesn't map 1:1 onto the JSON shapes in the
-- current file — it's what those shapes were standing in for.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. PROFILES — one row per person who's ever signed in
-- ----------------------------------------------------------------------------
-- Supabase Auth already has a built-in `auth.users` table (email, id, etc.)
-- that you don't manage directly. This table extends it with the app-specific
-- bits: their display name and whether they're an admin.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Everyone signed in can see everyone's name (needed for owner dropdowns,
-- the Users tab, etc.) — but only admins can change someone's role, and a
-- person can only edit their own display name.
create policy "profiles are viewable by any signed-in user"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "a user can update their own name (not their own role)"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from public.profiles where id = auth.uid()));

create policy "admins can update anyone's profile, including role"
  on public.profiles for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Auto-create a profile row the moment someone signs up (via magic link).
-- Without this, a brand new user would have no profiles row at all.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used throughout the policies below, so we don't repeat this subquery
-- in every single policy.
create function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;


-- ----------------------------------------------------------------------------
-- 2. MEMBERS — one row per ticket ("Bill Adams," "Teresa Collins," etc.)
-- ----------------------------------------------------------------------------
-- owner_user_id is null until someone claims the ticket (equivalent to today's
-- "This is me" picker). Admins can edit every ticket; everyone else can edit
-- only the one they own.

create table public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  title text not null default '',              -- was called "role" in the old app; renamed to avoid clashing with profiles.role
  owner_user_id uuid references auth.users(id) on delete set null,
  day_schedule jsonb not null default '{"Mon":"office","Tue":"office","Wed":"office","Thu":"office","Fri":"office"}',
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;

create policy "members are viewable by any signed-in user"
  on public.members for select
  using (auth.role() = 'authenticated');

create policy "admins can do anything to any ticket"
  on public.members for all
  using (public.is_admin());

create policy "a user can edit their own ticket"
  on public.members for update
  using (owner_user_id = auth.uid());

create policy "a user can delete their own ticket"
  on public.members for delete
  using (owner_user_id = auth.uid());

-- Claiming an unclaimed ticket ("This is me") — allowed for anyone, but only
-- while it's still unclaimed, and only to claim it as their own (can't hand
-- it to someone else).
create policy "anyone can claim an unclaimed ticket"
  on public.members for update
  using (owner_user_id is null)
  with check (owner_user_id = auth.uid());

create policy "any signed-in user can create a new ticket for themselves"
  on public.members for insert
  with check (auth.role() = 'authenticated');


-- ----------------------------------------------------------------------------
-- 3. PRIORITIES — the day-by-day entries. Doubles as history automatically.
-- ----------------------------------------------------------------------------
-- One row per priority, per person, per week. "This week" is just
-- week_start = the current Monday; "History" is every other week_start.
-- Nothing needs to be archived or snapshotted — it's already all here.

create table public.priorities (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  week_start date not null,                     -- the Monday this entry belongs to
  day text not null check (day in ('Mon','Tue','Wed','Thu','Fri')),
  text text not null default '',
  flagged boolean not null default false,       -- true once sent to Team P1s
  status text not null default 'not-started' check (status in ('not-started','in-progress','completed')),
  due date,
  carried_weeks int not null default 0,         -- how many Mondays this has rolled forward unfinished
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index priorities_member_week_idx on public.priorities (member_id, week_start);

alter table public.priorities enable row level security;

create policy "priorities are viewable by any signed-in user"
  on public.priorities for select
  using (auth.role() = 'authenticated');

create policy "admins can edit any priority"
  on public.priorities for all
  using (public.is_admin());

create policy "a user can edit priorities on their own ticket"
  on public.priorities for all
  using (member_id in (select id from public.members where owner_user_id = auth.uid()));


-- ----------------------------------------------------------------------------
-- 4. P1S — Team P1s panel. Open to anyone to add/edit, same as today.
-- ----------------------------------------------------------------------------

create table public.p1s (
  id uuid primary key default gen_random_uuid(),
  text text not null default '',
  owner_name text not null default '',
  due date,
  status text not null default 'not-started' check (status in ('not-started','in-progress','completed')),
  source_priority_id uuid references public.priorities(id) on delete set null,
  auto_text boolean not null default false,     -- true = keep in sync with source_priority_id's text
  created_at timestamptz not null default now()
);

alter table public.p1s enable row level security;

create policy "p1s are fully open to any signed-in user"
  on public.p1s for all
  using (auth.role() = 'authenticated');

-- Replaces the current app's syncLinkedText(): instead of JS re-writing the
-- text on every save, a view always shows the live source text if auto_text
-- is on. The client reads FROM this view for display, and writes to the
-- p1s table directly for the fields it owns.
create view public.p1s_with_live_text as
  select
    p.id, p.owner_name, p.due, p.status, p.source_priority_id, p.auto_text, p.created_at,
    case when p.auto_text and pr.text is not null
      then (select m.name from public.members m where m.id = pr.member_id) || ': ' || pr.text
      else p.text
    end as text
  from public.p1s p
  left join public.priorities pr on pr.id = p.source_priority_id;


-- ----------------------------------------------------------------------------
-- 5. FOLLOW-UPS — a card (owner + due) holding one or more entries.
-- ----------------------------------------------------------------------------

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null default '',
  due date,
  created_at timestamptz not null default now()
);

create table public.followup_entries (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid not null references public.followups(id) on delete cascade,
  text text not null default '',
  status text not null default 'not-started' check (status in ('not-started','in-progress','completed')),
  linked_priority_id uuid references public.priorities(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.followups enable row level security;
alter table public.followup_entries enable row level security;

create policy "followups are fully open to any signed-in user"
  on public.followups for all
  using (auth.role() = 'authenticated');

create policy "followup entries are fully open to any signed-in user"
  on public.followup_entries for all
  using (auth.role() = 'authenticated');

-- Like p1s_with_live_text: joining straight to priorities means a linked
-- entry always shows the CURRENT wording of the priority it's tied to,
-- with no sync code required.
create view public.followup_entries_with_live_link as
  select
    fe.id, fe.followup_id, fe.text, fe.status, fe.linked_priority_id, fe.created_at,
    m.name as linked_member_name,
    pr.day as linked_day,
    pr.text as linked_priority_text
  from public.followup_entries fe
  left join public.priorities pr on pr.id = fe.linked_priority_id
  left join public.members m on m.id = pr.member_id;


-- ----------------------------------------------------------------------------
-- 6. KPIs — the private-by-default tab. This is the one with real stakes.
-- ----------------------------------------------------------------------------
-- linked_user_id replaces the old "match by lowercase name string" trick —
-- once someone has an account, their KPI row points straight at their user
-- id, so there's no ambiguity if two people share a name.

create table public.kpi_people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position text not null default '',
  department text not null,
  linked_user_id uuid references auth.users(id) on delete set null,
  shared_with_owner boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.kpi_items (
  id uuid primary key default gen_random_uuid(),
  kpi_person_id uuid not null references public.kpi_people(id) on delete cascade,
  title text not null,
  sort_order int not null default 0,            -- keeps KPI #1–#4 in the order they were entered
  created_at timestamptz not null default now()
);

create table public.kpi_notes (
  id uuid primary key default gen_random_uuid(),
  kpi_item_id uuid not null references public.kpi_items(id) on delete cascade,
  week_start date not null,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  unique (kpi_item_id, week_start)
);

alter table public.kpi_people enable row level security;
alter table public.kpi_items enable row level security;
alter table public.kpi_notes enable row level security;

-- Admin: sees and edits everything.
create policy "admins see and edit all kpi_people"
  on public.kpi_people for all
  using (public.is_admin());

create policy "admins see and edit all kpi_items"
  on public.kpi_items for all
  using (public.is_admin());

create policy "admins see and edit all kpi_notes"
  on public.kpi_notes for all
  using (public.is_admin());

-- A regular user: can see their OWN row, but only once an admin has shared
-- it, and it's read-only — no insert/update/delete policy for non-admins
-- on any of these three tables, matching canEditKpis() being admin-only
-- in the current app.
create policy "a user can view their own kpi_people row once shared"
  on public.kpi_people for select
  using (linked_user_id = auth.uid() and shared_with_owner = true);

create policy "a user can view kpi_items for their own shared row"
  on public.kpi_items for select
  using (kpi_person_id in (
    select id from public.kpi_people
    where linked_user_id = auth.uid() and shared_with_owner = true
  ));

create policy "a user can view kpi_notes for their own shared row"
  on public.kpi_notes for select
  using (kpi_item_id in (
    select ki.id from public.kpi_items ki
    join public.kpi_people kp on kp.id = ki.kpi_person_id
    where kp.linked_user_id = auth.uid() and kp.shared_with_owner = true
  ));


-- ----------------------------------------------------------------------------
-- 7. One-time setup after running this file
-- ----------------------------------------------------------------------------
-- 1. Have Dennis (and Ann) sign in once via the app's magic-link login —
--    this creates their auth.users + profiles rows automatically.
-- 2. Promote them to admin (run in the SQL Editor, once each):
--
--      update public.profiles set role = 'admin'
--      where id = (select id from auth.users where email = 'dennis@onlybrewtopia.com');
--
-- 3. Everyone else signs in once, then either claims an existing ticket
--    (self-service, matches today's "This is me" flow) or an admin links
--    their kpi_people row via:
--
--      update public.kpi_people set linked_user_id =
--        (select id from auth.users where email = 'someone@onlybrewtopia.com')
--      where name = 'Someone Name';
--
-- Nothing else needs seeding by hand — members, priorities, p1s, followups,
-- and the KPI roster all get created through the app itself, the same way
-- they do today.
