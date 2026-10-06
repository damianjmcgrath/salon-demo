-- Sandbox testing only. Apply after 018. Allows future BOOKED appointments
-- to be marked no-show, while retaining permission/revision/comment checks.
-- Turn off before using real appointments:
-- update public.sandbox_testing_settings set allow_future_no_shows=false where id=true;
begin;
create table public.sandbox_testing_settings (
 id boolean primary key default true check(id),
 allow_future_no_shows boolean not null default false
);
alter table public.sandbox_testing_settings enable row level security;
revoke all on public.sandbox_testing_settings from public,anon,authenticated;
insert into public.sandbox_testing_settings(id,allow_future_no_shows) values(true,true);
create function public.sandbox_no_show_testing_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select public.is_salon_staff() and coalesce((select allow_future_no_shows from public.sandbox_testing_settings where id=true),false);
$$;
revoke all on function public.sandbox_no_show_testing_enabled() from public;
grant execute on function public.sandbox_no_show_testing_enabled() to authenticated;
create or replace function public.update_appointment_status(p_id uuid,p_status text,p_payment text default null,p_revision integer default null,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into a from public.appointments where id=p_id for update;
 if not found then raise exception 'Appointment not found.';end if;
 if p_revision is not null and a.revision<>p_revision then raise exception 'This appointment changed. Reload before editing.';end if;
 if not ((a.status='booked' and p_status in ('checked_in','cancelled','no_show')) or (a.status='checked_in' and p_status in ('completed','cancelled'))) then raise exception 'Invalid appointment status transition.';end if;
 if p_status in ('cancelled','no_show') and length(trim(coalesce(p_reason,'')))=0 then raise exception 'Add a reason.';end if;
 if p_status='no_show' and a.appointment_date+make_interval(mins=>a.start_minute)>now() at time zone 'Europe/Dublin' and not public.sandbox_no_show_testing_enabled() then raise exception 'A future appointment cannot be marked no-show.';end if;
 if p_status='completed' and (p_payment is null or p_payment not in ('card','cash','voucher','credit')) then raise exception 'Choose a payment method.';end if;
 perform pg_advisory_xact_lock(a.staff_id,(a.appointment_date-date '2000-01-01')::integer);
 update public.appointments set status=p_status,revision=revision+1,payment_method=case when p_status='completed' then p_payment else null end,checked_in_at=case when p_status='checked_in' then now() else checked_in_at end,completed_at=case when p_status='completed' then now() else completed_at end where id=p_id;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,p_id,'status_changed',jsonb_build_object('before',a.status,'after',p_status,'payment_method',p_payment,'reason',p_reason,'guarantee_charged',false,'sandbox_future_no_show',p_status='no_show' and a.appointment_date+make_interval(mins=>a.start_minute)>now() at time zone 'Europe/Dublin'));
end; $$;
commit;
