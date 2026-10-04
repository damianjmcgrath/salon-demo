-- Run once in a NEW DEVELOPMENT project, before 002_seed.sql.
begin;
create extension if not exists btree_gist;
create table public.treatments(id integer primary key,name text not null,category text not null,price numeric(10,2) not null check(price>=0),price_type text not null check(price_type in ('Fixed','From')),duration integer not null check(duration>0),patch_required boolean not null default false,active boolean not null default true);
create table public.staff(id integer primary key,name text not null);
create table public.staff_users(user_id uuid primary key references auth.users(id),role text not null check(role in ('staff','admin','it_support')));
create table public.staff_treatments(staff_id integer references public.staff(id),treatment_id integer references public.treatments(id),primary key(staff_id,treatment_id));
create table public.weekly_rotas(staff_id integer references public.staff(id),weekday integer check(weekday between 0 and 6),start_minute integer not null,end_minute integer not null,primary key(staff_id,weekday),check(start_minute>=0 and end_minute<=1440 and start_minute<end_minute));
create table public.weekly_breaks(staff_id integer references public.staff(id),weekday integer check(weekday between 0 and 6),start_minute integer not null,duration integer not null check(duration>0),primary key(staff_id,weekday,start_minute));
create table public.appointments(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),staff_id integer not null references public.staff(id),treatment_id integer not null references public.treatments(id),appointment_date date not null,start_minute integer not null check(start_minute>=0),duration integer not null check(duration>0 and start_minute+duration<=1440),client_name text not null,phone text not null,treatment_name text not null,price numeric(10,2) not null,status text not null default 'booked' check(status in ('booked','checked_in','completed','cancelled','no_show')),payment_method text check(payment_method in ('card','cash','voucher','credit')),demo_consent boolean not null default false,created_at timestamptz not null default now(),checked_in_at timestamptz,completed_at timestamptz,exclude using gist(staff_id with =,appointment_date with =,int4range(start_minute,start_minute+duration,'[)') with &&) where (status<>'cancelled'));
create table public.audit_events(id bigint generated always as identity primary key,user_id uuid references auth.users(id),appointment_id uuid references public.appointments(id),action text not null,created_at timestamptz not null default now(),details jsonb);
alter table public.treatments enable row level security;
alter table public.staff enable row level security;
alter table public.staff_users enable row level security;
alter table public.staff_treatments enable row level security;
alter table public.weekly_rotas enable row level security;
alter table public.weekly_breaks enable row level security;
alter table public.appointments enable row level security;
alter table public.audit_events enable row level security;
create function public.is_salon_staff() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.staff_users where user_id=auth.uid()); $$;
revoke all on function public.is_salon_staff() from public;
grant execute on function public.is_salon_staff() to authenticated;
create policy catalogue_read on public.treatments for select to anon,authenticated using(active);
create policy staff_names_read on public.staff for select to anon,authenticated using(true);
create policy own_staff_membership on public.staff_users for select to authenticated using(user_id=auth.uid());
create policy diary_read on public.appointments for select to authenticated using(user_id=auth.uid() or public.is_salon_staff());
create policy rota_read on public.weekly_rotas for select to authenticated using(public.is_salon_staff());
create policy breaks_read on public.weekly_breaks for select to authenticated using(public.is_salon_staff());
create policy skills_read on public.staff_treatments for select to anon,authenticated using(true);
create policy admin_audit_read on public.audit_events for select to authenticated using(exists(select 1 from public.staff_users where user_id=auth.uid() and role in ('admin','it_support')));
grant usage on schema public to anon,authenticated;
grant select on public.treatments,public.staff,public.staff_treatments to anon,authenticated;
grant select on public.staff_users,public.appointments,public.weekly_rotas,public.weekly_breaks,public.audit_events to authenticated;
-- Availability reveals slots, never other clients or appointment details.
create function public.get_available_slots(p_treatment_id integer,p_date date,p_staff_id integer default null) returns table(start_minute integer,staff_id integer) language sql stable security definer set search_path='' as $$
 select slot::integer,r.staff_id from public.weekly_rotas r
 join public.staff_treatments sk on sk.staff_id=r.staff_id and sk.treatment_id=p_treatment_id
 join public.treatments t on t.id=sk.treatment_id and t.active
 cross join lateral generate_series(r.start_minute,r.end_minute-t.duration,10) slot
 where r.weekday=extract(dow from p_date)::integer and (p_staff_id is null or r.staff_id=p_staff_id)
 and p_date >= (now() at time zone 'Europe/Dublin')::date
 and (p_date + make_interval(mins=>slot) > now() at time zone 'Europe/Dublin')
 and not exists(select 1 from public.weekly_breaks b where b.staff_id=r.staff_id and b.weekday=r.weekday and int4range(b.start_minute,b.start_minute+b.duration,'[)') && int4range(slot,slot+t.duration,'[)'))
 and not exists(select 1 from public.appointments a where a.staff_id=r.staff_id and a.appointment_date=p_date and a.status<>'cancelled' and int4range(a.start_minute,a.start_minute+a.duration,'[)') && int4range(slot,slot+t.duration,'[)')) order by slot,r.staff_id;
$$;
revoke all on function public.get_available_slots(integer,date,integer) from public;
grant execute on function public.get_available_slots(integer,date,integer) to anon,authenticated;
create function public.book_appointment(p_treatment_id integer,p_staff_id integer,p_date date,p_start integer,p_client_name text,p_phone text,p_demo_consent boolean) returns public.appointments language plpgsql security definer set search_path='' as $$
declare t public.treatments; a public.appointments;
begin
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
revoke all on function public.book_appointment(integer,integer,date,integer,text,text,boolean) from public;
grant execute on function public.book_appointment(integer,integer,date,integer,text,text,boolean) to authenticated;
create function public.update_appointment_status(p_id uuid,p_status text,p_payment text default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments;
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into a from public.appointments where id=p_id for update;
 if not found then raise exception 'Appointment not found.';end if;
 if not ((a.status='booked' and p_status in ('checked_in','cancelled')) or (a.status='checked_in' and p_status='completed')) then raise exception 'Invalid appointment status transition.';end if;
 if p_status='completed' and (p_payment is null or p_payment not in ('card','cash','voucher','credit')) then raise exception 'Choose a payment method.';end if;
 update public.appointments set status=p_status,payment_method=case when p_status='completed' then p_payment else null end,checked_in_at=case when p_status='checked_in' then now() else checked_in_at end,completed_at=case when p_status='completed' then now() else null end where id=p_id;
 insert into public.audit_events(user_id,appointment_id,action,details) values(auth.uid(),p_id,'status_changed',jsonb_build_object('before',a.status,'after',p_status,'payment_method',p_payment));
end; $$;
revoke all on function public.update_appointment_status(uuid,text,text) from public;
grant execute on function public.update_appointment_status(uuid,text,text) to authenticated;
commit;
