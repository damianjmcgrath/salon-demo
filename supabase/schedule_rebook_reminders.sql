-- Run AFTER 049 + deploying send-rebook-reminders + enabling pg_cron/pg_net.
-- Add the private Vault secret salon_email_worker_secret first (see setup guide).
do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='salon_email_worker_secret') then
 raise exception 'Add salon_email_worker_secret in Vault before scheduling.';end if;
end$$;
-- Re-running this setup replaces the same named schedule.
select cron.unschedule(jobid) from cron.job where jobname='salon-rebook-reminders';
select cron.schedule('salon-rebook-reminders','*/15 * * * *',$schedule$
 select net.http_post(
  url:='https://xmvujvwyfxawtazjiymd.supabase.co/functions/v1/send-rebook-reminders',
  headers:=jsonb_build_object('Content-Type','application/json','x-salon-email-secret',
    (select decrypted_secret from vault.decrypted_secrets where name='salon_email_worker_secret' limit 1)),
  body:='{}'::jsonb,timeout_milliseconds:=60000
 );
$schedule$);
