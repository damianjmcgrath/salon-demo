begin;
alter table public.appointments add column scheduled_patch_id uuid references public.appointments(id),add column patch_target_ids integer[],add column patch_test_pending boolean not null default false,add column patch_test_alert text;
create table public.booking_flow_requests(user_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,appointment_ids uuid[] not null,primary key(user_id,request_id));
alter table public.booking_flow_requests enable row level security;
revoke all on public.booking_flow_requests from public,anon,authenticated;

create function public.get_booking_flow_plan(p_treatments integer[],p_email text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;t public.treatments;patch public.treatments;needed integer[]:='{}';earliest timestamptz;recorded timestamptz;i integer;begin
 if auth.uid() is null or exists(select 1 from public.staff_users where user_id=auth.uid()) then raise exception 'Client sign-in required.';end if;
 cid:=public.ensure_own_client();
 if p_email is not null then
 if trim(p_email)!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid recipient email.';end if;
 select id into cid from public.clients where merged_into is null and lower(trim(email))=lower(trim(p_email)) order by (auth_user_id is not null) desc,created_at,id limit 1;
 end if;
 if coalesce(cardinality(p_treatments),0) not between 1 and 12 or array_position(p_treatments,null) is not null then raise exception 'Select 1–12 treatments.';end if;
 foreach i in array p_treatments loop
 select * into t from public.treatments where id=i and active;if t.id is null then raise exception 'Treatment unavailable.';end if;
 if t.patch_required then
 recorded:=public.patch_test_recorded_at(cid,t.id);
 if recorded is null then if not i=any(needed) then needed:=array_append(needed,i);end if;
 else earliest:=greatest(earliest,recorded+interval '24 hours');end if;end if;
 end loop;
 if cardinality(needed)>0 then
 select * into patch from public.treatments where id=(select treatment_id from public.patch_booking_settings) and active;
 if patch.id is null or patch.patch_required or patch.price<>0 or patch.guarantee_required then raise exception 'A free Patch Test service must be configured. Contact the salon.';end if;
 end if;
 return jsonb_build_object('needed',needed,'patch',case when patch.id is not null then to_jsonb(patch)||jsonb_build_object('name','Patch Test for '||(select string_agg(name,', ' order by array_position(needed,id)) from public.treatments where id=any(needed))) else null end,'earliest',earliest);
end;$$;

create function public.get_booking_flow_slots(p_treatments integer[],p_email text,p_date date,p_staff_id integer default null,p_patch_date date default null,p_patch_start integer default null,p_select_patch boolean default false)
returns table(start_minute integer,staff_id integer) language plpgsql security definer set search_path='' as $$
declare plan jsonb;earliest timestamptz;needed integer[];begin
 plan:=public.get_booking_flow_plan(p_treatments,p_email);select array_agg(x::integer) into needed from jsonb_array_elements_text(plan->'needed') x;
 if p_select_patch then
 if plan->'patch'='null'::jsonb then raise exception 'No patch test is required. Review the treatments.';end if;
 return query select s.start_minute,s.staff_id from public.get_visit_slots(array[(plan->'patch'->>'id')::integer],p_date,p_staff_id) s where not exists(select 1 from unnest(needed) i where not exists(select 1 from public.staff_treatments sk where sk.staff_id=s.staff_id and sk.treatment_id=i));
 else
 earliest:=(plan->>'earliest')::timestamptz;
 if cardinality(needed)>0 then
 if p_patch_date is null or p_patch_start is null then raise exception 'Choose a patch-test time first.';end if;
 earliest:=greatest(earliest,((p_patch_date+make_interval(mins=>p_patch_start)) at time zone 'Europe/Dublin')+interval '24 hours');end if;
 return query select s.start_minute,s.staff_id from public.get_visit_slots(p_treatments,p_date,p_staff_id) s where earliest is null or ((p_date+make_interval(mins=>s.start_minute)) at time zone 'Europe/Dublin')>=earliest;
 end if;
end;$$;

-- Scheduling is permitted against a real pending patch appointment; performance still needs a recorded test.
create function public.assert_scheduled_patch(p_client uuid,p_treatment integer,p_date date,p_start integer) returns void language plpgsql security definer set search_path='' as $$
declare recorded timestamptz;begin
 recorded:=public.patch_test_recorded_at(p_client,p_treatment);
 if recorded is not null and ((p_date+make_interval(mins=>p_start)) at time zone 'Europe/Dublin')>=recorded+interval '24 hours' then return;end if;
 if exists(select 1 from public.appointments p where p.client_id=p_client and p.status in('booked','checked_in') and p_treatment=any(p.patch_target_ids) and p.treatment_id=(select treatment_id from public.patch_booking_settings) and ((p_date+make_interval(mins=>p_start)) at time zone 'Europe/Dublin')>=((p.appointment_date+make_interval(mins=>p.start_minute)) at time zone 'Europe/Dublin')+interval '24 hours') then return;end if;
 raise exception 'Choose a patch test at least 24 hours before this treatment.';
end;$$;
revoke all on function public.assert_scheduled_patch(uuid,integer,date,integer) from public,anon,authenticated;

do $$ declare def text;begin
 def:=pg_get_functiondef('public.visit_book_one(integer,integer,date,integer,text,text,boolean,boolean,text,text)'::regprocedure);
 def:=replace(replace(def,'FUNCTION public.visit_book_one(','FUNCTION public.flow_book_one('),'public.assert_patch_clearance(','public.assert_scheduled_patch(');execute def;
 def:=pg_get_functiondef('public.visit_book_guaranteed(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,boolean,boolean)'::regprocedure);
 def:=replace(replace(def,'FUNCTION public.visit_book_guaranteed(','FUNCTION public.flow_book_guaranteed('),'public.visit_book_one(','public.flow_book_one(');execute def;
 def:=pg_get_functiondef('public.visit_book_with_value(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,text,uuid,boolean)'::regprocedure);
 def:=replace(replace(def,'FUNCTION public.visit_book_with_value(','FUNCTION public.flow_book_with_value('),'public.visit_book_one(','public.flow_book_one(');execute def;
 def:=pg_get_functiondef('public.book_treatment_visit(integer[],jsonb,uuid,integer,date,integer,text,text,boolean,text,uuid,boolean,boolean,text,uuid)'::regprocedure);
 def:=replace(def,'FUNCTION public.book_treatment_visit(','FUNCTION public.flow_book_visit(');
 def:=replace(replace(def,'not between 2 and 12','not between 1 and 12'),'Select 2–12 treatments.','Select 1–12 treatments.');
 def:=replace(replace(def,'public.visit_book_with_value(','public.flow_book_with_value('),'public.visit_book_guaranteed(','public.flow_book_guaranteed(');execute def;
 -- Existing amendment rules remain, with pending tests accepted only for scheduling.
 foreach def in array array['public.amend_appointment(uuid,integer,integer,date,integer,integer,text)','public.client_amend_appointment(uuid,integer,integer,date,integer,integer,text)'] loop
 execute replace(pg_get_functiondef(def::regprocedure),'public.assert_patch_clearance(','public.assert_scheduled_patch(');
 end loop;
end;$$;
revoke all on function public.flow_book_one(integer,integer,date,integer,text,text,boolean,boolean,text,text),public.flow_book_guaranteed(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,boolean,boolean),public.flow_book_with_value(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,text,uuid,boolean),public.flow_book_visit(integer[],jsonb,uuid,integer,date,integer,text,text,boolean,text,uuid,boolean,boolean,text,uuid) from public,anon,authenticated;

create function public.book_booking_flow(p_treatments integer[],p_expected jsonb,p_request uuid,p_staff integer,p_date date,p_start integer,p_name text,p_phone text,p_self boolean,p_email text,p_card uuid,p_consent boolean,p_staff_selected boolean,p_value_method text default null,p_value_id uuid default null,p_patch_date date default null,p_patch_start integer default null,p_patch_staff integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request_payload jsonb;old public.booking_flow_requests;plan jsonb;needed integer[];patch public.appointments;result jsonb;ids uuid[];k record;begin
 plan:=public.get_booking_flow_plan(p_treatments,case when p_self then null else p_email end);
 request_payload:=jsonb_build_object('treatments',p_treatments,'expected',p_expected,'staff',p_staff,'date',p_date,'start',p_start,'self',p_self,'email',lower(trim(p_email)),'card',p_card,'method',p_value_method,'value',p_value_id,'patch_date',p_patch_date,'patch_start',p_patch_start,'patch_staff',p_patch_staff);
 if p_request is null or p_self is null then raise exception 'Invalid booking request.';end if;
 perform pg_advisory_xact_lock(hashtextextended('flow:'||auth.uid()::text||':'||p_request::text,0));
 select * into old from public.booking_flow_requests where user_id=auth.uid() and request_id=p_request;
 if old.request_id is not null then
 if old.payload<>request_payload then raise exception 'This request has already been used.';end if;
 return jsonb_build_object('appointments',(select jsonb_agg(to_jsonb(a) order by array_position(old.appointment_ids,a.id)) from public.appointments a where a.id=any(old.appointment_ids)));end if;
 select array_agg(x::integer) into needed from jsonb_array_elements_text(plan->'needed') x;
 -- Lock days in chronological order before checking or inserting either appointment.
 for k in select distinct staff,day from (values(p_staff,p_date),(p_patch_staff,p_patch_date)) x(staff,day) where staff is not null and day is not null order by day,staff loop perform pg_advisory_xact_lock(k.staff,(k.day-date '2000-01-01')::integer);end loop;
 if cardinality(needed)>0 then
 if not exists(select 1 from public.get_booking_flow_slots(p_treatments,case when p_self then null else p_email end,p_patch_date,p_patch_staff,null,null,true) s where s.start_minute=p_patch_start) then raise exception 'The patch-test time is no longer available. Choose another.';end if;
 patch:=public.flow_book_guaranteed((plan->'patch'->>'id')::integer,p_patch_staff,p_patch_date,p_patch_start,p_name,p_phone,p_self,p_email,null,true,null,null,false,false);
 update public.appointments set treatment_name=plan->'patch'->>'name',patch_target_ids=needed,patch_for_treatment_id=needed[1],patch_for_treatment_name=(select name from public.treatments where id=needed[1]) where id=patch.id returning * into patch;
 update public.booking_email_queue set snapshot=snapshot||jsonb_build_object('treatment_name',patch.treatment_name) where appointment_id=patch.id and status='pending' and payload is null;
 end if;
 if not exists(select 1 from public.get_booking_flow_slots(p_treatments,case when p_self then null else p_email end,p_date,p_staff,p_patch_date,p_patch_start,false) s where s.start_minute=p_start) then raise exception 'Choose a treatment time at least 24 hours after the patch test, with full visit availability.';end if;
 result:=public.flow_book_visit(p_treatments,p_expected,gen_random_uuid(),p_staff,p_date,p_start,p_name,p_phone,p_self,p_email,p_card,p_consent,p_staff_selected,p_value_method,p_value_id);
 if patch.id is not null then
 update public.appointments set scheduled_patch_id=patch.id,patch_test_pending=treatment_id=any(needed) where id in(select (a->>'id')::uuid from jsonb_array_elements(result->'appointments') a);
 result:=jsonb_build_object('appointments',jsonb_build_array(to_jsonb(patch))||(select jsonb_agg(to_jsonb(a) order by a.visit_order) from public.appointments a where a.id in(select (x->>'id')::uuid from jsonb_array_elements(result->'appointments') x)));
 end if;
 select array_agg((a->>'id')::uuid) into ids from jsonb_array_elements(result->'appointments') a;
 insert into public.booking_flow_requests values(auth.uid(),p_request,request_payload,ids);
 return result;
end;$$;

-- Prevent amendments from breaking the gap, flag missed/cancelled tests, and refuse treatment checkout until recorded.
create function public.guard_patch_links() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.appointments;begin
 if new.appointment_date<>old.appointment_date or new.start_minute<>old.start_minute then
 if exists(select 1 from public.appointments a where a.scheduled_patch_id=new.id and a.patch_test_pending and a.status in('booked','checked_in') and ((a.appointment_date+make_interval(mins=>a.start_minute)) at time zone 'Europe/Dublin')<((new.appointment_date+make_interval(mins=>new.start_minute)) at time zone 'Europe/Dublin')+interval '24 hours') then raise exception 'The patch test must remain at least 24 hours before its linked treatments.';end if;
 if new.patch_test_pending and new.scheduled_patch_id is not null then perform public.assert_scheduled_patch(new.client_id,new.treatment_id,new.appointment_date,new.start_minute);end if;
 end if;
 if new.status in('checked_in','completed') and new.status<>old.status and new.patch_test_pending then perform public.assert_patch_clearance(new.client_id,new.treatment_id,new.appointment_date,new.start_minute);new.patch_test_pending:=false;new.patch_test_alert:=null;end if;
 return new;
end;$$;
create trigger guard_patch_links before update on public.appointments for each row execute function public.guard_patch_links();
create function public.flag_patch_followups() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.status in('cancelled','no_show') and new.status<>old.status and new.patch_target_ids is not null then
 update public.appointments set patch_test_alert='Patch test '||replace(new.status,'_',' ')||' — staff review required' where scheduled_patch_id=new.id and patch_test_pending and status in('booked','checked_in');
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),new.client_id,new.id,'patch_test_followup_required',jsonb_build_object('status',new.status));end if;return new;end;$$;
create trigger flag_patch_followups after update on public.appointments for each row execute function public.flag_patch_followups();
create function public.clear_recorded_patch_pending() returns trigger language plpgsql security definer set search_path='' as $$ begin
 update public.appointments a set patch_test_pending=false,patch_test_alert=null where a.client_id=new.client_id and a.patch_test_pending and exists(select 1 from jsonb_array_elements(new.treatments_covered) t where t->>'id'=a.treatment_id::text) and ((a.appointment_date+make_interval(mins=>a.start_minute)) at time zone 'Europe/Dublin')>=new.recorded_at+interval '24 hours';return new;end;$$;
create trigger clear_recorded_patch_pending after insert on public.client_patch_tests for each row execute function public.clear_recorded_patch_pending();
revoke all on function public.guard_patch_links(),public.flag_patch_followups(),public.clear_recorded_patch_pending() from public,anon,authenticated;
revoke all on function public.get_booking_flow_plan(integer[],text),public.get_booking_flow_slots(integer[],text,date,integer,date,integer,boolean),public.book_booking_flow(integer[],jsonb,uuid,integer,date,integer,text,text,boolean,text,uuid,boolean,boolean,text,uuid,date,integer,integer) from public,anon;
grant execute on function public.get_booking_flow_plan(integer[],text),public.get_booking_flow_slots(integer[],text,date,integer,date,integer,boolean),public.book_booking_flow(integer[],jsonb,uuid,integer,date,integer,text,text,boolean,text,uuid,boolean,boolean,text,uuid,date,integer,integer) to authenticated;
commit;
