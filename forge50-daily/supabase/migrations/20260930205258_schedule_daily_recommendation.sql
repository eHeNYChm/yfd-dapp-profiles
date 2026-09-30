-- Nightly trigger for the daily-recommendation edge function.
--
-- The shared key the cron job sends lives only in Vault. The function checks
-- it by calling public.verify_cron_key() with the service role, so the key is
-- never copied into function secrets and can be rotated by updating Vault.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'daily_recommendation_cron_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'daily_recommendation_cron_key',
      'x-cron-key for the daily-recommendation edge function'
    );
  end if;
end $$;

create or replace function public.verify_cron_key(key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'daily_recommendation_cron_key' and decrypted_secret = key
  );
$$;
revoke execute on function public.verify_cron_key(text) from public, anon, authenticated;
grant execute on function public.verify_cron_key(text) to service_role;

-- 11:15 UTC is 04:15 PDT / 03:15 PST. Before local noon the function targets
-- the same local day, so this produces the recommendation for the day that is
-- about to start.
select cron.unschedule('daily-recommendation')
where exists (select 1 from cron.job where jobname = 'daily-recommendation');

select cron.schedule(
  'daily-recommendation',
  '15 11 * * *',
  $$
  select net.http_post(
    url := 'https://kjxnogisqqqdcrdgygco.supabase.co/functions/v1/daily-recommendation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets
                     where name = 'daily_recommendation_cron_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
