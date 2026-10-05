-- Run once AFTER 003_roles.sql. Existing bookings remain self bookings.
begin;
alter table public.appointments
 add column booked_for_self boolean not null default true,
 add column attendee_email text,
 add column demo_card text check(demo_card in ('saved_demo','new_demo')),
 add column guarantee_amount numeric(10,2),
 add column guarantee_policy_version text;
-- No real card data or payment tokens are accepted or stored.
create or replace function public.get_available_slots(p_treatment_id integer,p_date date,p_staff_id integer default null) returns table(start_minute integer,staff_id integer) language sql stable security definer set search_path='' as $$
 select slot::integer,r.staff_id from public.weekly_rotas r
 join public.staff_treatments sk on sk.staff_id=r.staff_id and sk.treatment_id=p_treatment_id
 join public.treatments t on t.id=sk.treatment_id and t.active
 cross join lateral generate_series(r.start_minute,r.end_minute-t.duration,1) slot
 where slot % (case when t.duration=60 then 60 when t.duration=30 then 30 when t.duration<15 then 5 else 15 end)=0 and r.weekday=extract(dow from p_date)::integer and (p_staff_id is null or r.staff_id=p_staff_id)
 and p_date >= (now() at time zone 'Europe/Dublin')::date
 and (p_date + make_interval(mins=>slot) > now() at time zone 'Europe/Dublin')
 and not exists(select 1 from public.weekly_breaks b where b.staff_id=r.staff_id and b.weekday=r.weekday and int4range(b.start_minute,b.start_minute+b.duration,'[)') && int4range(slot,slot+t.duration,'[)'))
 and not exists(select 1 from public.appointments a where a.staff_id=r.staff_id and a.appointment_date=p_date and a.status<>'cancelled' and int4range(a.start_minute,a.start_minute+a.duration,'[)') && int4range(slot,slot+t.duration,'[)')) order by slot,r.staff_id;
$$;
revoke all on function public.get_available_slots(integer,date,integer) from public;
grant execute on function public.get_available_slots(integer,date,integer) to anon,authenticated;
drop function public.book_appointment(integer,integer,date,integer,text,text,boolean);
create function public.book_appointment(p_treatment_id integer,p_staff_id integer,p_date date,p_start integer,p_client_name text,p_phone text,p_demo_consent boolean,p_booked_for_self boolean,p_attendee_email text,p_demo_card text) returns public.appointments language plpgsql security definer set search_path='' as $$
declare t public.treatments; a public.appointments;
begin
 if exists(select 1 from public.staff_users u where u.user_id=auth.uid()) then raise exception 'Client access required.'; end if;
 if auth.uid() is null then raise exception 'Please sign in before booking.'; end if;
 if not coalesce(p_demo_consent,false) or length(trim(coalesce(p_client_name,'')))<1 or length(trim(coalesce(p_phone,'')))<1 then raise exception 'Name, mobile number and demo acknowledgement are required.'; end if;
 if p_booked_for_self is null or coalesce(p_attendee_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_demo_card is null or p_demo_card not in ('saved_demo','new_demo') then raise exception 'Attendee email and a demo card choice are required.'; end if;
 if p_booked_for_self and lower(trim(p_attendee_email)) <> lower((select email from auth.users where id=auth.uid())) then raise exception 'Use your account email for a self booking.'; end if;
 select * into t from public.treatments where id=p_treatment_id and active;
 if not found then raise exception 'Treatment is unavailable.'; end if;
 if t.patch_required then raise exception 'Patch-test booking rules are not yet implemented in this first slice.'; end if;
 -- Serialize bookings for this staff/day; the exclusion constraint also rejects overlap.
 perform pg_advisory_xact_lock(p_staff_id,(p_date-date '2000-01-01')::integer);
 if not exists(select 1 from public.get_available_slots(p_treatment_id,p_date,p_staff_id) s where s.start_minute=p_start) then raise exception 'That time is no longer available. Please choose another.'; end if;
 insert into public.appointments(user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,demo_consent,booked_for_self,attendee_email,demo_card,guarantee_amount,guarantee_policy_version) values(auth.uid(),p_staff_id,t.id,p_date,p_start,t.duration,trim(p_client_name),trim(p_phone),t.name,t.price,true,p_booked_for_self,lower(trim(p_attendee_email)),p_demo_card,10,'demo-v1') returning * into a;
 insert into public.audit_events(user_id,appointment_id,action) values(auth.uid(),a.id,'booking_created');
 return a;
end; $$;
revoke all on function public.book_appointment(integer,integer,date,integer,text,text,boolean,boolean,text,text) from public;
grant execute on function public.book_appointment(integer,integer,date,integer,text,text,boolean,boolean,text,text) to authenticated;
commit;
