-- Run once. Apply AFTER 001_schema.sql and 002_seed.sql. Do not rerun 001.
begin;
alter table public.staff_users drop constraint staff_users_role_check;
alter table public.staff_users add constraint staff_users_role_check check(role in ('staff','admin','accountant','it_support'));
-- Accountants are deliberately excluded from operational access.
create or replace function public.is_salon_staff() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_users where user_id=auth.uid() and role in ('staff','admin','it_support'));
$$;
create function public.get_daily_report(p_date date)
returns table(id uuid,staff_id integer,start_minute integer,duration integer,client_name text,treatment_name text,price numeric,status text,payment_method text,appointment_date date)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.staff_users u where u.user_id=auth.uid() and u.role in ('admin','accountant','it_support')) then raise exception 'Reporting access required.';end if;
 return query select a.id,a.staff_id,a.start_minute,a.duration,a.client_name,a.treatment_name,a.price,a.status,a.payment_method,a.appointment_date from public.appointments a where a.appointment_date=p_date and a.status='completed' order by a.start_minute;
end; $$;
revoke all on function public.get_daily_report(date) from public;
grant execute on function public.get_daily_report(date) to authenticated;
-- New accounts have no membership and therefore receive client permissions.
-- Roles can only be assigned through trusted database administration.
-- Existing staff/admin/it_support assignments remain unchanged.
drop policy diary_read on public.appointments;
create policy diary_read on public.appointments for select to authenticated using(public.is_salon_staff() or (user_id=auth.uid() and not exists(select 1 from public.staff_users u where u.user_id=auth.uid() and u.role='accountant')));
create or replace function public.book_appointment(p_treatment_id integer,p_staff_id integer,p_date date,p_start integer,p_client_name text,p_phone text,p_demo_consent boolean) returns public.appointments language plpgsql security definer set search_path='' as $$
declare t public.treatments; a public.appointments;
begin
 if exists(select 1 from public.staff_users u where u.user_id=auth.uid() and u.role='accountant') then raise exception 'Accountant access is read-only.'; end if;
 if auth.uid() is null then raise exception 'Please sign in before booking.'; end if;
 if not coalesce(p_demo_consent,false) or length(trim(coalesce(p_client_name,'')))<1 or length(trim(coalesce(p_phone,'')))<1 then raise exception 'Name, mobile number and demo acknowledgement are required.'; end if;
 select * into t from public.treatments where id=p_treatment_id and active;
 if not found then raise exception 'Treatment is unavailable.'; end if;
 if t.patch_required then raise exception 'Patch-test booking rules are not yet implemented in this first slice.'; end if;
 -- Serialize bookings for this staff/day; the exclusion constraint also rejects overlap.
 perform pg_advisory_xact_lock(p_staff_id,(p_date-date '2000-01-01')::integer);
 if not exists(select 1 from public.get_available_slots(p_treatment_id,p_date,p_staff_id) s where s.start_minute=p_start) then raise exception 'That time is no longer available. Please choose another.'; end if;
 insert into public.appointments(user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,demo_consent) values(auth.uid(),p_staff_id,t.id,p_date,p_start,t.duration,trim(p_client_name),trim(p_phone),t.name,t.price,true) returning * into a;
 insert into public.audit_events(user_id,appointment_id,action) values(auth.uid(),a.id,'booking_created');
 return a;
end; $$;
alter table public.audit_events add column actor_role text check(actor_role in ('client','staff','admin','accountant','it_support'));
create function public.snapshot_audit_role() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select u.role into new.actor_role from public.staff_users u where u.user_id=new.user_id;
 new.actor_role:=coalesce(new.actor_role,'client');
 return new;
end; $$;
revoke all on function public.snapshot_audit_role() from public;
create trigger audit_role_snapshot before insert on public.audit_events for each row execute function public.snapshot_audit_role();
-- Historical rows retain NULL: their role at the original event is unknown.
commit;
