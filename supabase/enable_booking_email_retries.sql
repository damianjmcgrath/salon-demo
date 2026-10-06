-- Optional automatic retry worker: apply AFTER migration 010 and deploying the function.
-- First save the SAME SALON_EMAIL_WORKER_SECRET in Supabase Vault as salon_email_worker_secret.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='salon_email_worker_secret') then
  raise exception 'Add salon_email_worker_secret to Vault first.';
 end if;
end $$;
select cron.schedule('salon-booking-confirmation-retries','*/5 * * * *', $job$
 select net.http_post(
 url:='https://xmvujvwyfxawtazjiymd.supabase.co/functions/v1/send-booking-confirmations',
 headers:=jsonb_build_object('Content-Type','application/json','x-salon-email-secret',(select decrypted_secret from vault.decrypted_secrets where name='salon_email_worker_secret' limit 1)),
 body:='{}'::jsonb,
 timeout_milliseconds:=60000
 );
$job$);
