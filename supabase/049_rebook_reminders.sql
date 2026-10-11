begin;
create table public.rebook_email_queue (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 treatment_id integer not null references public.treatments(id), appointment_id uuid not null references public.appointments(id) on delete cascade,
 snapshot jsonb not null, payload jsonb,
 status text not null default 'pending' check(status in('pending','processing','accepted','failed','review','cancelled')),
 attempts integer not null default 0, created_at timestamptz not null default now(), first_attempt_at timestamptz,
 next_attempt_at timestamptz not null default now(), locked_until timestamptz, claim_token uuid, resend_id text, last_error text,
 unique(client_id,treatment_id,appointment_id)
);
alter table public.rebook_email_queue enable row level security;
revoke all on public.rebook_email_queue from anon,authenticated;
grant select,update on public.rebook_email_queue to service_role;
create index rebook_attendance_lookup on public.appointments(client_id,treatment_id,appointment_date desc,start_minute desc) where status='completed';
create table public.rebook_scan_state(id boolean primary key default true check(id),last_scan date);
insert into public.rebook_scan_state(id) values(true);
alter table public.rebook_scan_state enable row level security;
revoke all on public.rebook_scan_state from anon,authenticated;
-- Attendance belongs to the recipient, never the person who booked on their behalf.
create view public.rebook_due_clients with (security_barrier=true) as
select a.client_id,a.treatment_id,a.id appointment_id,a.user_id actor_id,c.name client_name,c.email,
 t.name treatment_name,t.rebook_window,a.appointment_date,a.start_minute,
 (a.appointment_date+make_interval(mins=>a.start_minute)) at time zone 'Europe/Dublin' attended_at
from (select distinct on(client_id,treatment_id) * from public.appointments where status='completed'
 order by client_id,treatment_id,appointment_date desc,start_minute desc,created_at desc,id desc) a
join public.clients c on c.id=a.client_id and c.merged_into is null
join public.treatments t on t.id=a.treatment_id and t.active and t.rebook_window is not null
where trim(c.email)<>'' and
 (a.appointment_date+make_interval(mins=>a.start_minute)+case t.rebook_window
 when '1 week' then interval '1 week' when '2 weeks' then interval '2 weeks' when '4 weeks' then interval '4 weeks'
 when '2 months' then interval '2 months' when '3 months' then interval '3 months'
 when '6 months' then interval '6 months' when '12 months' then interval '12 months' end)<now() at time zone 'Europe/Dublin'
 and not exists(select 1 from public.appointments f where f.client_id=a.client_id and f.treatment_id=a.treatment_id
 and f.status in('booked','checked_in') and (f.appointment_date+make_interval(mins=>f.start_minute)) at time zone 'Europe/Dublin'>now());
revoke all on public.rebook_due_clients from public,anon,authenticated;
create function public.scan_rebook_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 -- Concurrent workers may only scan once per salon day. Retries still drain the queue.
 perform 1 from public.rebook_scan_state where id for update;
 if exists(select 1 from public.rebook_scan_state where id and last_scan=(now() at time zone 'Europe/Dublin')::date) then return 0;end if;
 insert into public.rebook_email_queue(client_id,treatment_id,appointment_id,snapshot)
 select d.client_id,d.treatment_id,d.appointment_id,jsonb_build_object('client_name',d.client_name,'email',d.email,
 'treatment_name',d.treatment_name,'treatment_id',d.treatment_id,'rebook_window',d.rebook_window,
 'attended_at',d.attended_at,'actor_id',d.actor_id) from public.rebook_due_clients d
 on conflict(client_id,treatment_id,appointment_id) do nothing;
 get diagnostics n=row_count;
 update public.rebook_scan_state set last_scan=(now() at time zone 'Europe/Dublin')::date where id;
 return n;
end;$$;
create function public.claim_rebook_emails() returns setof public.rebook_email_queue language plpgsql security definer set search_path='' as $$
begin
 -- Cancel only unsent messages; ambiguous retries keep the frozen payload and provider key.
 -- Cancelled unsent jobs can become eligible again if the future booking is cancelled.
 update public.rebook_email_queue q set status='pending',last_error=null,next_attempt_at=now()
 where q.status='cancelled' and q.first_attempt_at is null and exists(select 1 from public.rebook_due_clients d where d.appointment_id=q.appointment_id);
 update public.rebook_email_queue q set status='cancelled',last_error='Client is no longer due a reminder.'
 where q.status='pending' and q.first_attempt_at is null and not exists(select 1 from public.rebook_due_clients d where d.appointment_id=q.appointment_id);
 update public.rebook_email_queue set status='review',last_error='Retry window expired; check Resend before retrying manually.'
 where status in('pending','processing') and first_attempt_at<now()-interval '23 hours' and coalesce(locked_until,now())<=now();
 return query with selected as (select id from public.rebook_email_queue where
 (status='pending' and next_attempt_at<=now()) or (status='processing' and locked_until<=now())
 order by created_at,id for update skip locked limit 10)
 update public.rebook_email_queue q set status='processing',attempts=q.attempts+1,first_attempt_at=coalesce(q.first_attempt_at,now()),
 locked_until=now()+interval '5 minutes',claim_token=gen_random_uuid() from selected where q.id=selected.id returning q.*;
end;$$;
create function public.log_rebook_email_communication() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 if new.status='accepted' and new.resend_id is not null then
 select coalesce(c.auth_user_id,a.user_id,(select s.user_id from public.staff_users s where s.role='admin' limit 1)) into actor
 from public.clients c join public.appointments a on a.id=new.appointment_id where c.id=new.client_id;
 perform public.record_system_email_communication(new.client_id,actor,'rebook-email:'||new.id::text,
 'Rebook reminder email accepted for sending: '||(new.snapshot->>'treatment_name')||'. Last appointment: '||
 to_char((new.snapshot->>'attended_at')::timestamptz at time zone 'Europe/Dublin','DD/MM/YYYY HH24:MI')||
 '. Intended recipient: '||(new.snapshot->>'email')||'. Email reference: '||new.resend_id||'. Test delivery: damianjmcgrath@gmail.com.',now());
 end if;return new;
end;$$;
create trigger rebook_email_communication after update on public.rebook_email_queue for each row execute function public.log_rebook_email_communication();
revoke all on function public.scan_rebook_reminders(),public.claim_rebook_emails(),public.log_rebook_email_communication() from public,anon,authenticated;
grant execute on function public.scan_rebook_reminders(),public.claim_rebook_emails() to service_role;
commit;
