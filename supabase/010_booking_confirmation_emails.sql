-- Apply after 009. New bookings only; no retrospective email sends.
begin;
create table public.booking_email_queue(
 id uuid primary key default gen_random_uuid(),
 appointment_id uuid not null unique references public.appointments(id) on delete cascade,
 snapshot jsonb not null,
 payload jsonb,
 status text not null default 'pending' check(status in('pending','processing','accepted','failed','review','cancelled')),
 attempts integer not null default 0,
 created_at timestamptz not null default now(),
 first_attempt_at timestamptz,
 next_attempt_at timestamptz not null default now(),
 locked_until timestamptz,
 claim_token uuid,
 resend_id text,
 last_error text
);
alter table public.booking_email_queue enable row level security;
revoke all on public.booking_email_queue from anon,authenticated;
grant select,update on public.booking_email_queue to service_role;
create function public.queue_booking_confirmation() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.status not in('booked','checked_in') then return new;end if;
 insert into public.booking_email_queue(appointment_id,snapshot) values(new.id,jsonb_build_object(
 'id',new.id,'client_name',new.client_name,'treatment_name',new.treatment_name,'appointment_date',new.appointment_date,
 'start_minute',new.start_minute,'price',new.price,'staff_name',(select name from public.staff where id=new.staff_id))) on conflict(appointment_id) do nothing;
 return new;
end $$;
create trigger booking_confirmation_insert after insert on public.appointments for each row execute function public.queue_booking_confirmation();
create function public.claim_booking_emails() returns setof public.booking_email_queue language plpgsql security definer set search_path='' as $$ begin
 update public.booking_email_queue q set status='cancelled',last_error='Appointment cancelled before email submission.'
 where q.status='pending' and exists(select 1 from public.appointments a where a.id=q.appointment_id and a.status in('cancelled','no_show'));
 -- Resend retains deduplication keys for 24h: never automatically retry an ambiguous send beyond that window.
 update public.booking_email_queue set status='review',last_error='Retry window expired; check Resend before retrying manually.'
 where status in('pending','processing') and first_attempt_at < now()-interval '23 hours' and coalesce(locked_until,now())<=now();
 return query with selected as (
 select id from public.booking_email_queue where
 (status='pending' and next_attempt_at<=now()) or (status='processing' and locked_until<=now())
 order by created_at for update skip locked limit 10
 ) update public.booking_email_queue q set status='processing',attempts=q.attempts+1,
 first_attempt_at=coalesce(q.first_attempt_at,now()),locked_until=now()+interval '5 minutes',claim_token=gen_random_uuid()
 from selected where q.id=selected.id returning q.*;
end $$;
revoke all on function public.queue_booking_confirmation(),public.claim_booking_emails() from public,anon,authenticated;
grant execute on function public.claim_booking_emails() to service_role;
commit;
