# Forge 50 Daily

A read-mostly, single-screen personal dashboard for the Forge 50 program,
built to live on an iPhone home screen. The Today screen shows:

1. **Today's recommendation** from `recommendations` (if one exists), with a
   Dismiss button that sets `acknowledged`.
2. **Today's prescribed workout** from `program_days`.
3. **Today's events**, fetched live from Google Calendar (read-only).
4. **A handful of open tasks**, fetched live from Todoist (read-only).

Calendar and tasks are never stored in Supabase.

## Layout

```
app/                     Next.js 16 App Router (Today screen, login, manifest, icons)
components/              Cards and small client components
lib/                     Supabase client, date/program math, Calendar + Todoist
proxy.ts                 Session refresh + redirect to /login (Next 16's "middleware")
scripts/
  seed-program-days.mjs  Builds program_days SQL from Forge50_Training_App.html
  google-refresh-token.mjs  One-time Google OAuth helper
supabase/
  migrations/            Auth/RLS and the nightly schedule (already applied)
  seed/program_days.sql  Generated seed (already applied)
  functions/daily-recommendation/  Nightly edge function (deployed)
```

`health-ingest` (the Apple Health Shortcut endpoint) is untouched.

## Auth and RLS

Single user, email + password via Supabase Auth. All four tables are locked
to one owner: every policy calls `private.is_owner()`, which checks
`auth.uid()` against `private.owners`. The `private` schema isn't exposed
through the API, so the owner list can only be changed from SQL. Enabling
sign-ups by accident therefore exposes nothing.

| Table | Owner can | Written by |
|---|---|---|
| `program_days` | read | seed (SQL) |
| `sessions` | read, insert, update, delete | owner |
| `health_metrics` | read | `health-ingest` (service role) |
| `recommendations` | read, update `acknowledged` only (column grant) | `daily-recommendation` (service role) |

`anon` has no table privileges at all.

## Program mapping

`program_days` mirrors `Forge50_Training_App.html` exactly: `day_of_week` is
JavaScript `getDay()` (0 = Sunday), and weeks run Monday to Sunday. Week 1 is the
week containing `PROGRAM_START_DATE`. Weeks 1–16 are Phase 1 (Build the base),
17–32 Phase 2 (Build the engine), and 33–52 Phase 3 (Peak for 50). Each
`prescription` keeps the original text plus a parsed form:

```json
{ "phase": 1, "phase_name": "Build the base", "session_key": "upper",
  "text": "TGU 3×1/side (12kg) · …", "format": null,
  "items": [{ "text": "TGU 3×1/side (12kg)", "name": "TGU", "sets": 3, "reps": "1/side", "load": "12kg" }, …] }
```

To regenerate the seed after editing the HTML:

```sh
node scripts/seed-program-days.mjs Forge50_Training_App.html > supabase/seed/program_days.sql
# then run the file in the Supabase SQL editor (it upserts on week + day_of_week)
```

## Nightly recommendation

`pg_cron` calls `daily-recommendation` at 11:15 UTC (04:15 PDT / 03:15 PST).
The request carries an `x-cron-key` stored in Vault
(`daily_recommendation_cron_key`), which the function checks through the
service-role-only `public.verify_cron_key()` RPC.

The function reads the last 14 days of `health_metrics` and `sessions` plus the
day's `program_days` row, computes signals in code, asks Claude for a short
advisory note, and upserts one `recommendations` row for the target day. Before
noon local time the target is today; after noon it's tomorrow. It never writes
to `program_days`.

- **Day-to-day signals:** sleep duration, resting HR and HRV. The latest
  reading (at most 2 days old) is compared with the mean of the other days in
  the window, and flagged low/high/normal.
- **Trend signals:** body mass and lean mass. The 7-day average is compared
  with the prior 7 days (at least 3 readings in each), and counts as "moved"
  only at ≥ 0.3 kg *and* ≥ 0.5%. A trend that didn't move is left out of the
  prompt entirely, so the model can't mention it.
- Metric names from the Shortcut are normalized (`sleep_duration`,
  `resting_heart_rate`, `heart_rate_variability`, `body_mass`,
  `lean_body_mass` and common aliases; see `signals.ts`). Minutes, seconds and
  pounds are converted.
- The full computed signals are stored in `recommendations.signals`.

Run it by hand from the SQL editor (`force` regenerates an existing row):

```sql
select net.http_post(
  url := 'https://kjxnogisqqqdcrdgygco.supabase.co/functions/v1/daily-recommendation',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-key',
    (select decrypted_secret from vault.decrypted_secrets where name = 'daily_recommendation_cron_key')),
  body := '{"for_date":"2026-10-05","force":true}'::jsonb,
  timeout_milliseconds := 150000);
-- then: select status_code, content from net._http_response order by id desc limit 1;
```

Tests: `deno test supabase/functions/daily-recommendation/` (run with
`--node-modules-dir=none` from inside this repo).

## Setup checklist

1. **Create your user.** Supabase dashboard → Authentication → Users → Add
   user (email + password, auto-confirm). Turn off *Allow new users to sign up*
   under Authentication → Sign In / Providers. Then make yourself the owner:
   ```sql
   insert into private.owners (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
2. **Edge function secrets** (Dashboard → Edge Functions → Secrets, or
   `supabase secrets set`): `ANTHROPIC_API_KEY`, `PROGRAM_START_DATE`,
   `APP_TIMEZONE=America/Los_Angeles`.
3. **Vercel env vars:** everything in `.env.example`. `PROGRAM_START_DATE` and
   `APP_TIMEZONE` must match the function secrets.
4. **Google Calendar:** in Google Cloud, enable the Calendar API, create an
   OAuth client of type *Desktop app*, and set the consent screen to
   *In production* (in *Testing*, refresh tokens expire after 7 days). Then:
   ```sh
   GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/google-refresh-token.mjs
   ```
5. **Todoist:** Settings → Integrations → Developer → API token →
   `TODOIST_API_TOKEN`.
6. **iPhone:** open the deployed URL in Safari → Share → Add to Home Screen.
   Sign in once inside the home screen app; it keeps its own cookies, separate
   from Safari. It refreshes itself when you return to it after 5+ minutes,
   and the ↻ button refreshes on demand.

## Local development

```sh
cp .env.example .env.local   # fill in values
npm install
npm run dev
```
