-- Apply once after 021. Automatic patch routing is client self-booking only.
begin;
alter table public.treatments add column guarantee_required boolean not null default true;
alter table public.appointments add column patch_for_treatment_id integer references public.treatments(id),add column patch_for_treatment_name text;
create table public.patch_booking_settings(id boolean primary key default true check(id),treatment_id integer not null references public.treatments(id));
alter table public.patch_booking_settings enable row level security;
revoke all on public.patch_booking_settings from public,anon,authenticated;
insert into public.patch_booking_settings(id,treatment_id) select true,id from public.treatments where lower(trim(name))='patch test' order by id limit 1;
do $$ begin if not exists(select 1 from public.patch_booking_settings) then raise exception 'A PATCH TEST treatment is required before applying this migration.';end if;end; $$;
update public.treatments set guarantee_required=false,patch_required=false,revision=revision+1 where id in(select treatment_id from public.patch_booking_settings);

create function public.patch_test_recorded_at(p_client uuid,p_treatment integer) returns timestamptz language sql stable security definer set search_path='' as $$
 select max(p.recorded_at) from public.client_patch_tests p where p.client_id=p_client and exists(select 1 from jsonb_array_elements(p.treatments_covered) t where t->>'id'=p_treatment::text);
$$;
revoke all on function public.patch_test_recorded_at(uuid,integer) from public;
create function public.assert_patch_clearance(p_client uuid,p_treatment integer,p_date date,p_start integer) returns void language plpgsql stable security definer set search_path='' as $$ declare recorded timestamptz;begin
 recorded:=public.patch_test_recorded_at(p_client,p_treatment);
 if recorded is null then raise exception 'This client needs a recorded patch test for this treatment first.';end if;
 if ((p_date+make_interval(mins=>p_start)) at time zone 'Europe/Dublin')<recorded+interval '24 hours' then raise exception 'The treatment must be at least 24 hours after the recorded patch test.';end if;
end; $$;
revoke all on function public.assert_patch_clearance(uuid,integer,date,integer) from public;

-- Treatment Management can configure the card guarantee independently of patch-test requirements.
drop function public.save_treatment(integer,text,text,integer,numeric,boolean,integer);
create function public.save_treatment(p_id integer,p_name text,p_description text,p_duration integer,p_price numeric,p_patch_required boolean,p_revision integer,p_guarantee_required boolean default null) returns public.treatments language plpgsql security definer set search_path='' as $$ declare old public.treatments;t public.treatments;begin
 perform public.require_any_permission(array['view.treatments']);
 if length(trim(coalesce(p_name,''))) not between 1 and 200 or length(coalesce(p_description,''))>5000 then raise exception 'Enter a treatment name and a description of up to 5000 characters.';end if;
 if p_duration is null or p_duration not between 1 and 720 or p_price is null or p_price<0 or p_price>=1000000 or p_price<>round(p_price,2) or p_patch_required is null then raise exception 'Enter a valid length, price and patch test setting.';end if;
 select * into old from public.treatments where id=p_id for update;
 if old.id is null or old.revision is distinct from p_revision then raise exception 'Treatment changed or was not found. Reload before saving.';end if;
 if p_patch_required and p_id=(select treatment_id from public.patch_booking_settings where id=true) then raise exception 'The Patch Test service cannot itself require a patch test.';end if;
 update public.treatments set guarantee_required=coalesce(p_guarantee_required,old.guarantee_required),name=trim(p_name),description=coalesce(p_description,''),duration=p_duration,price=p_price,patch_required=p_patch_required,revision=revision+1 where id=p_id returning * into t;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'treatment_updated',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(t)));return t;
end; $$;
revoke all on function public.save_treatment(integer,text,text,integer,numeric,boolean,integer,boolean) from public;
grant execute on function public.save_treatment(integer,text,text,integer,numeric,boolean,integer,boolean) to authenticated;

-- Extend the existing client + attendee policy with the selected service's guarantee flag.
drop function public.booking_requires_guarantee(text,uuid);
create function public.booking_requires_guarantee(p_attendee_email text default null,p_client_id uuid default null,p_treatment_id integer default null) returns boolean language plpgsql security definer set search_path='' as $$ declare cid uuid;required boolean;t_required boolean;begin
 if public.is_salon_staff() then perform public.require_any_permission(array['view.appointments']);cid:=p_client_id;
 else cid:=public.ensure_own_client();if p_client_id is not null then raise exception 'Clients cannot select another client ID.';end if;
 if nullif(trim(p_attendee_email),'') is not null then select id into cid from public.clients where merged_into is null and lower(trim(email))=lower(trim(p_attendee_email)) order by (auth_user_id is not null) desc,created_at,id limit 1;end if;
 end if;
 select requires_deposit into required from public.clients where id=cid and merged_into is null;
 if p_treatment_id is not null then select guarantee_required into t_required from public.treatments where id=p_treatment_id and active;
 if t_required is null then raise exception 'Treatment unavailable.';end if;end if;
 return coalesce(required,true) and coalesce(t_required,true);
end; $$;
revoke all on function public.booking_requires_guarantee(text,uuid,integer) from public;
grant execute on function public.booking_requires_guarantee(text,uuid,integer) to authenticated;

create function public.get_self_booking_plan(p_requested_treatment integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;t public.treatments;booking public.treatments;recorded timestamptz;needed boolean;display_name text;begin
 cid:=public.ensure_own_client();
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
 'guarantee_required',public.booking_requires_guarantee(null,null,booking.id),
 'treatment',to_jsonb(booking)||jsonb_build_object('name',display_name));
end; $$;
revoke all on function public.get_self_booking_plan(integer) from public;
grant execute on function public.get_self_booking_plan(integer) to authenticated;
create function public.get_self_booking_slots(p_requested_treatment integer,p_date date,p_staff_id integer default null) returns table(start_minute integer,staff_id integer) language plpgsql security definer set search_path='' as $$ declare plan jsonb;begin
 plan:=public.get_self_booking_plan(p_requested_treatment);
 return query select s.start_minute,s.staff_id from public.get_available_slots((plan->'treatment'->>'id')::integer,p_date,p_staff_id) s
 where (plan->>'earliest_treatment_at' is null or ((p_date+make_interval(mins=>s.start_minute)) at time zone 'Europe/Dublin')>=(plan->>'earliest_treatment_at')::timestamptz)
 and (not (plan->>'patch_needed')::boolean or exists(select 1 from public.staff_treatments st where st.staff_id=s.staff_id and st.treatment_id=p_requested_treatment));
end; $$;
revoke all on function public.get_self_booking_slots(integer,date,integer) from public;
grant execute on function public.get_self_booking_slots(integer,date,integer) to authenticated;

-- Installed legacy functions stay private and retain all existing availability/audit checks.
-- Self treatment bookings and staff treatment bookings now enforce recorded clearance and 24 hours.
do $patch$ declare def text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='book_appointment';
 def:=replace(def,'if t.patch_required then raise exception ''Patch-test booking rules are not yet implemented in this first slice.''; end if;',
 'if t.patch_required then if not p_booked_for_self then raise exception ''Patch-test booking for someone else is not yet available. Please contact the salon.'';end if;perform public.assert_patch_clearance(public.ensure_own_client(),t.id,p_date,p_start);end if;');execute def;
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='staff_book_appointment';
 def:=replace(def,'if t.patch_required then raise exception ''Patch-test workflow is not yet implemented.'';end if;', 'if t.patch_required then perform public.assert_patch_clearance(p_client_id,t.id,p_date,p_start);end if;');execute def;
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='amend_appointment';
 def:=replace(def,'if t.patch_required then raise exception ''Patch-test workflow is not yet implemented.'';end if;', 'if t.patch_required then perform public.assert_patch_clearance(old.client_id,t.id,p_date,p_start);end if;');
 def:=replace(def,'treatment_name=t.name','treatment_name=case when old.patch_for_treatment_id is not null and old.treatment_id=t.id then old.treatment_name else t.name end,patch_for_treatment_id=case when old.treatment_id=t.id then old.patch_for_treatment_id else null end,patch_for_treatment_name=case when old.treatment_id=t.id then old.patch_for_treatment_name else null end');execute def;
end; $patch$;

drop function public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid);
create function public.book_guaranteed_appointment(p_treatment_id integer,p_staff_id integer,p_date date,p_start integer,p_client_name text,p_phone text,p_booked_for_self boolean,p_attendee_email text,p_guarantee_id uuid,p_consent boolean,p_client_id uuid default null,p_patch_for_treatment_id integer default null) returns public.appointments language plpgsql security definer set search_path='' as $$
declare g public.booking_guarantee_cards;a public.appointments;cid uuid;required boolean;plan jsonb;original public.treatments;begin
 if public.is_salon_staff() then cid:=p_client_id;else
 if p_client_id is not null then raise exception 'Client bookings cannot specify another card owner.';end if;cid:=public.ensure_own_client();end if;
 perform 1 from public.treatments where id in(p_treatment_id,p_patch_for_treatment_id) order by id for share;
 if p_patch_for_treatment_id is not null then
 if public.is_salon_staff() or not p_booked_for_self then raise exception 'Automatic patch booking is only available for client self-bookings.';end if;
 plan:=public.get_self_booking_plan(p_patch_for_treatment_id);
 if not (plan->>'patch_needed')::boolean or (plan->'treatment'->>'id')::integer<>p_treatment_id then raise exception 'Patch test requirements changed. Return to Treatment Selection.';end if;
 select * into original from public.treatments where id=p_patch_for_treatment_id;
 if not exists(select 1 from public.staff_treatments where staff_id=p_staff_id and treatment_id=original.id) then raise exception 'Choose a staff member qualified for the intended treatment.';end if;
 end if;
 -- Serialize exemption changes with the booking decision for an existing attendee.
 perform 1 from public.clients where id=case when public.is_salon_staff() or p_booked_for_self then cid else (select id from public.clients where merged_into is null and lower(trim(email))=lower(trim(p_attendee_email)) order by (auth_user_id is not null) desc,created_at,id limit 1) end for share;
 required:=public.booking_requires_guarantee(case when p_booked_for_self then null else p_attendee_email end,p_client_id,p_treatment_id);
 if required then
 if not coalesce(p_consent,false) then raise exception 'Agree to the booking guarantee first.';end if;
 select * into g from public.booking_guarantee_cards where id=p_guarantee_id and client_id=cid and verified_at is not null and environment='sandbox';
 if g.id is null then raise exception 'A verified card belonging to the booking payer is required.';end if;
 end if;
 if public.is_salon_staff() then a:=public.staff_book_appointment(cid,p_treatment_id,p_staff_id,p_date,p_start,'saved_demo',true);
 else a:=public.book_appointment(p_treatment_id,p_staff_id,p_date,p_start,p_client_name,p_phone,true,p_booked_for_self,p_attendee_email,'saved_demo');end if;
 if p_patch_for_treatment_id is not null then
 update public.appointments set patch_for_treatment_id=original.id,patch_for_treatment_name=original.name,treatment_name='Patch Test for '||original.name where id=a.id returning * into a;
 update public.booking_email_queue set snapshot=snapshot||jsonb_build_object('treatment_name',a.treatment_name,'patch_for_treatment_id',original.id) where appointment_id=a.id and status='pending' and payload is null;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),cid,a.id,'patch_test_booking_created',jsonb_build_object('intended_treatment_id',original.id,'intended_treatment_name',original.name,'patch_treatment_id',p_treatment_id));
 end if;
 update public.appointments set guarantee_card_id=case when required then g.id else null end,demo_card=null,guarantee_policy_version=case when required then g.policy_version else null end,guarantee_required=required where id=a.id returning * into a;
 update public.booking_email_queue set snapshot=snapshot||jsonb_build_object('guarantee_required',required) where appointment_id=a.id and status='pending' and payload is null;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,case when required then 'booking_guarantee_agreed' else 'booking_guarantee_exempt' end,jsonb_build_object('card_owner_client_id',cid,'card_id',g.id,'policy_version',g.policy_version,'requires_deposit',required,'environment','sandbox'));
 return a;
end; $$;
revoke all on function public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer) from public;
grant execute on function public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer) to authenticated;
commit;
