-- Security advisor 0014: keep pg_net out of the public schema. Its functions
-- stay in net.*, so the daily-recommendation cron job is unaffected.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
