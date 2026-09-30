-- Single-user access model.
--
-- The app has exactly one human user. Rather than trusting "any authenticated
-- user" (which would silently open the data if sign-ups were ever enabled),
-- every policy checks that the caller's auth.uid() is in private.owners.
-- The private schema is not exposed through the Data API, so the owner list
-- can only be changed from SQL.
--
-- Server-side writers (health-ingest, daily-recommendation) use the service
-- role, which bypasses RLS, so no write policies are needed for them.

create schema if not exists private;
revoke all on schema private from public, anon;
-- authenticated needs USAGE to evaluate private.is_owner() inside policies;
-- it gets no privileges on any table in the schema.
grant usage on schema private to authenticated;

create table if not exists private.owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.owners from public, anon, authenticated;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.owners o where o.user_id = (select auth.uid())
  );
$$;
revoke execute on function private.is_owner() from public, anon;
grant execute on function private.is_owner() to authenticated;

-- Table privileges: anon gets nothing; authenticated gets only what the app
-- uses. RLS still applies on top of these grants.
revoke all on public.program_days, public.sessions, public.health_metrics, public.recommendations
  from anon;
revoke insert, update, delete, truncate on public.program_days, public.health_metrics
  from authenticated;
revoke insert, update, delete, truncate on public.recommendations from authenticated;
-- The only client-side write on recommendations is dismissing one.
grant update (acknowledged) on public.recommendations to authenticated;

-- program_days: read-only reference data.
create policy "owner reads program_days"
  on public.program_days for select to authenticated
  using ((select private.is_owner()));

-- sessions: the owner may log and edit their own training history.
create policy "owner reads sessions"
  on public.sessions for select to authenticated
  using ((select private.is_owner()));
create policy "owner inserts sessions"
  on public.sessions for insert to authenticated
  with check ((select private.is_owner()));
create policy "owner updates sessions"
  on public.sessions for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));
create policy "owner deletes sessions"
  on public.sessions for delete to authenticated
  using ((select private.is_owner()));

-- health_metrics: written only by health-ingest (service role).
create policy "owner reads health_metrics"
  on public.health_metrics for select to authenticated
  using ((select private.is_owner()));

-- recommendations: written by daily-recommendation (service role); the owner
-- reads them and may flip acknowledged (column grant above).
create policy "owner reads recommendations"
  on public.recommendations for select to authenticated
  using ((select private.is_owner()));
create policy "owner acknowledges recommendations"
  on public.recommendations for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

-- Supports the nightly window query (last N days of sessions).
create index if not exists sessions_performed_on_idx on public.sessions (performed_on);
