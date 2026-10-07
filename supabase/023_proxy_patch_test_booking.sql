-- Apply once after 022. Email-matched patch routing for client proxy bookings.
begin;
create function public.get_proxy_booking_plan(p_requested_treatment integer,p_attendee_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;t public.treatments;booking public.treatments;recorded timestamptz;needed boolean;display_name text;begin
 perform public.ensure_own_client();
 if p_attendee_email is null or length(trim(p_attendee_email))>254 or trim(p_attendee_email)!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address for the person being booked for.';end if;
 select id into cid from public.clients where merged_into is null and lower(trim(email))=lower(trim(p_attendee_email)) order by (auth_user_id is not null) desc,created_at,id limit 1;
 select * into t from public.treatments where id=p_requested_treatment and active;if t.id is null then raise exception 'Treatment unavailable.';end if;
 recorded:=case when t.patch_required then public.patch_test_recorded_at(cid,t.id) else null end;
 needed:=t.patch_required and recorded is null;
 booking:=t;
 if needed then
 select * into booking from public.treatments where id=(select treatment_id from public.patch_booking_settings where id=true) and active;
 if booking.id is null or booking.patch_required then raise exception 'Patch Test bookings are not available. Please contact the salon.';end if;
 display_name:='Patch Test for '||t.name;
 else display_name:=t.name;end if;
 return jsonb_build_object('requested_treatment_id',t.id,'requested_treatment_name',t.name,'patch_needed',needed,'patch_for_treatment_id',case when needed then t.id else null end,
 'earliest_treatment_at',case when recorded is not null then recorded+interval '24 hours' else null end,
 'guarantee_required',public.booking_requires_guarantee(p_attendee_email,null,booking.id),
 'treatment',to_jsonb(booking)||jsonb_build_object('name',display_name));
end; $$;
revoke all on function public.get_proxy_booking_plan(integer,text) from public;
grant execute on function public.get_proxy_booking_plan(integer,text) to authenticated;
create function public.get_proxy_booking_slots(p_requested_treatment integer,p_attendee_email text,p_date date,p_staff_id integer default null) returns table(start_minute integer,staff_id integer) language plpgsql security definer set search_path='' as $$ declare plan jsonb;begin
 plan:=public.get_proxy_booking_plan(p_requested_treatment,p_attendee_email);
 return query select s.start_minute,s.staff_id from public.get_available_slots((plan->'treatment'->>'id')::integer,p_date,p_staff_id) s
 where (plan->>'earliest_treatment_at' is null or ((p_date+make_interval(mins=>s.start_minute)) at time zone 'Europe/Dublin')>=(plan->>'earliest_treatment_at')::timestamptz)
 and (not (plan->>'patch_needed')::boolean or exists(select 1 from public.staff_treatments st where st.staff_id=s.staff_id and st.treatment_id=p_requested_treatment));
end; $$;
revoke all on function public.get_proxy_booking_slots(integer,text,date,integer) from public;
grant execute on function public.get_proxy_booking_slots(integer,text,date,integer) to authenticated;


do $patch$ declare def text;old_guard text;new_guard text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='book_appointment';
 old_guard:='if t.patch_required then if not p_booked_for_self then raise exception ''Patch-test booking for someone else is not yet available. Please contact the salon.'';end if;perform public.assert_patch_clearance(public.ensure_own_client(),t.id,p_date,p_start);end if;';
 new_guard:='if t.patch_required then perform public.assert_patch_clearance(case when p_booked_for_self then public.ensure_own_client() else (select id from public.clients where merged_into is null and lower(trim(email))=lower(trim(p_attendee_email)) order by (auth_user_id is not null) desc,created_at,id limit 1) end,t.id,p_date,p_start);end if;';
 if position(old_guard in def)=0 then raise exception 'Expected migration 022 booking guard was not found.';end if;
 execute replace(def,old_guard,new_guard);
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='book_guaranteed_appointment';
 old_guard:='if public.is_salon_staff() or not p_booked_for_self then raise exception ''Automatic patch booking is only available for client self-bookings.'';end if;';
 if position(old_guard in def)=0 then raise exception 'Expected migration 022 guarantee wrapper was not found.';end if;
 def:=replace(def,old_guard,'if public.is_salon_staff() then raise exception ''Automatic patch booking is only available for client bookings.'';end if;');
 def:=replace(def,'begin','begin p_attendee_email:=lower(trim(p_attendee_email));');
 def:=replace(def,'plan:=public.get_self_booking_plan(p_patch_for_treatment_id);','plan:=case when p_booked_for_self then public.get_self_booking_plan(p_patch_for_treatment_id) else public.get_proxy_booking_plan(p_patch_for_treatment_id,p_attendee_email) end;');
 def:=replace(def,'values(auth.uid(),cid,a.id,''patch_test_booking_created''','values(auth.uid(),a.client_id,a.id,''patch_test_booking_created''');
 execute def;
end; $patch$;
commit;
