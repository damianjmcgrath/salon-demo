begin;
create table public.booking_visits(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,created_at timestamptz not null default now(),unique(user_id,request_id));
alter table public.booking_visits enable row level security;
revoke all on public.booking_visits from public,anon,authenticated;
alter table public.appointments add column visit_id uuid references public.booking_visits(id),add column visit_order integer;

create function public.get_visit_slots(p_treatments integer[],p_date date,p_staff_id integer default null)
returns table(start_minute integer,staff_id integer) language plpgsql security definer set search_path='' as $$
declare total integer;begin
 if auth.uid() is null or public.is_salon_staff() then raise exception 'Client access required.';end if;
 if cardinality(p_treatments) not between 1 and 12 or array_position(p_treatments,null) is not null then raise exception 'Select 1–12 treatments.';end if;
 select sum(t.duration) into total from unnest(p_treatments) i join public.treatments t on t.id=i and t.active;
 if (select count(*) from unnest(p_treatments) i join public.treatments t on t.id=i and t.active)<>cardinality(p_treatments) or total>720 then raise exception 'Selected treatments are unavailable or exceed 12 hours.';end if;
 return query select s.start_minute,s.staff_id from public.get_available_slots(p_treatments[1],p_date,p_staff_id) s
 where not exists(select 1 from unnest(p_treatments) i where not exists(select 1 from public.staff_treatments sk where sk.staff_id=s.staff_id and sk.treatment_id=i))
 and exists(select 1 from (
 select w.start_minute,w.end_minute from public.weekly_rotas w where w.staff_id=s.staff_id and w.weekday=extract(dow from p_date)::integer and not exists(select 1 from public.staff_day_shifts d where d.staff_id=w.staff_id and d.shift_date=p_date)
 union all select d.start_minute,d.end_minute from public.staff_day_shifts d where d.staff_id=s.staff_id and d.shift_date=p_date and d.start_minute is not null
 ) shifts where s.start_minute>=shifts.start_minute and s.start_minute+total<=shifts.end_minute)
 and not exists(select 1 from public.weekly_breaks b where b.staff_id=s.staff_id and b.weekday=extract(dow from p_date)::integer and not exists(select 1 from public.staff_day_breaks d where d.staff_id=b.staff_id and d.appointment_date=p_date and d.kind='lunch') and int4range(b.start_minute,b.start_minute+b.duration,'[)')&&int4range(s.start_minute,s.start_minute+total,'[)'))
 and not exists(select 1 from public.staff_day_breaks b where b.staff_id=s.staff_id and b.appointment_date=p_date and int4range(b.start_minute,b.start_minute+b.duration,'[)')&&int4range(s.start_minute,s.start_minute+total,'[)'))
 and not exists(select 1 from public.appointments a where a.staff_id=s.staff_id and a.appointment_date=p_date and a.status<>'cancelled' and int4range(a.start_minute,a.start_minute+a.duration,'[)')&&int4range(s.start_minute,s.start_minute+total,'[)'))
 and not exists(select 1 from public.staff_calendar_entries e where e.staff_id=s.staff_id and e.appointment_date=p_date and e.show_as='busy' and int4range(e.start_minute,e.start_minute+e.duration,'[)')&&int4range(s.start_minute,s.start_minute+total,'[)')) order by s.start_minute,s.staff_id;
end;$$;

-- Private copies retain identity, patch clearance, card, value, audit and preference checks.
-- Only the per-treatment alignment check is replaced by the enclosing visit's full availability check.
do $copy$ declare def text;guard text;begin
 def:=pg_get_functiondef('public.book_appointment(integer,integer,date,integer,text,text,boolean,boolean,text,text)'::regprocedure);
 guard:='if not exists(select 1 from public.get_available_slots(p_treatment_id,p_date,p_staff_id) s where s.start_minute=p_start) then raise exception ''That time is no longer available. Please choose another.''; end if;';
 if position(guard in def)=0 then raise exception 'Unexpected booking availability implementation.';end if;
 def:=replace(replace(def,'FUNCTION public.book_appointment(','FUNCTION public.visit_book_one('),guard,'');execute def;
 def:=pg_get_functiondef('public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,boolean)'::regprocedure);
 def:=replace(replace(def,'FUNCTION public.book_guaranteed_appointment(','FUNCTION public.visit_book_guaranteed('),'public.book_appointment(','public.visit_book_one(');
 def:=replace(def,E')\n RETURNS',E', p_visit_guarantee boolean DEFAULT false)\n RETURNS');
 def:=replace(def,'required:=public.booking_requires_guarantee(', 'required:=p_visit_guarantee or public.booking_requires_guarantee(');execute def;
 def:=pg_get_functiondef('public.book_with_value(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,text,uuid,boolean)'::regprocedure);
 def:=replace(replace(def,'FUNCTION public.book_with_value(','FUNCTION public.visit_book_with_value('),'public.book_appointment(','public.visit_book_one(');execute def;
 def:=pg_get_functiondef('public.get_booking_value_options(integer)'::regprocedure);
 def:=replace(def,'FUNCTION public.get_booking_value_options(p_treatment_id integer)','FUNCTION public.get_visit_value_options(p_treatments integer[])');
 def:=replace(def,'select t.price into price from public.treatments t where t.id=p_treatment_id and t.active;','select sum(t.price) into price from unnest(p_treatments) i join public.treatments t on t.id=i and t.active;');execute def;
end;$copy$;
revoke all on function public.visit_book_one(integer,integer,date,integer,text,text,boolean,boolean,text,text),public.visit_book_guaranteed(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,boolean,boolean),public.visit_book_with_value(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,text,uuid,boolean) from public,anon,authenticated;

create function public.visit_requires_guarantee(p_treatments integer[],p_attendee_email text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare required boolean:=false;i integer;begin
 if auth.uid() is null or public.is_salon_staff() then raise exception 'Client access required.';end if;
 foreach i in array p_treatments loop required:=public.booking_requires_guarantee(p_attendee_email,null,i) or required;end loop;return required;
end;$$;

create function public.book_treatment_visit(p_treatments integer[],p_expected jsonb,p_request uuid,p_staff integer,p_date date,p_start integer,p_name text,p_phone text,p_self boolean,p_email text,p_card uuid,p_consent boolean,p_staff_selected boolean,p_value_method text default null,p_value_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.booking_visits;a public.appointments;t public.treatments;ordinal integer:=0;at_minute integer:=p_start;payload jsonb;required boolean;result jsonb:='[]'::jsonb;begin
 if auth.uid() is null or public.is_salon_staff() then raise exception 'Client access required.';end if;
 if p_request is null or cardinality(p_treatments) not between 2 and 12 or p_self is null then raise exception 'Select 2–12 treatments.';end if;
 payload:=jsonb_build_object('treatments',p_treatments,'staff',p_staff,'date',p_date,'start',p_start,'self',p_self,'email',lower(trim(p_email)),'value',p_value_id,'method',p_value_method,'card',p_card);
 perform pg_advisory_xact_lock(hashtextextended('visit:'||auth.uid()::text||':'||p_request::text,0));
 select * into v from public.booking_visits where user_id=auth.uid() and request_id=p_request;
 if v.id is not null then
 if v.payload<>payload then raise exception 'This booking request has already been used.';end if;
 select jsonb_agg(to_jsonb(x) order by x.visit_order) into result from public.appointments x where x.visit_id=v.id;
 return jsonb_build_object('appointments',result,'visit_id',v.id);end if;
 if p_value_method='voucher' then perform 1 from public.vouchers where id=p_value_id for update;
 elsif p_value_method='credit' then perform 1 from public.client_credit_notes where id=p_value_id for update;
 elsif p_value_method is not null then raise exception 'Invalid payment option.';end if;
 perform 1 from public.treatments where id=any(p_treatments) order by id for share;
 if jsonb_typeof(p_expected) is distinct from 'array' or jsonb_array_length(p_expected)<>cardinality(p_treatments) then raise exception 'Review the selected treatments.';end if;
 foreach ordinal in array p_treatments loop
 select * into t from public.treatments where id=ordinal and active;
 if t.id is null or not exists(select 1 from jsonb_array_elements(p_expected) e where (e->>'id')::integer=t.id and (e->>'revision')::integer=t.revision and (e->>'price')::numeric=t.price and (e->>'duration')::integer=t.duration) then raise exception 'Treatment details changed. Return to treatment selection.';end if;
 end loop;
 perform pg_advisory_xact_lock(p_staff,(p_date-date '2000-01-01')::integer);
 if not exists(select 1 from public.get_visit_slots(p_treatments,p_date,p_staff) s where s.start_minute=p_start) then raise exception 'That visit time is no longer available. Please choose another.';end if;
 insert into public.booking_visits(user_id,request_id,payload) values(auth.uid(),p_request,payload) returning * into v;
 ordinal:=0;required:=p_value_method is null and public.visit_requires_guarantee(p_treatments,case when p_self then null else p_email end);
 foreach at_minute in array p_treatments loop
 ordinal:=ordinal+1;select * into t from public.treatments where id=at_minute;
 -- Reuse complete checks for each treatment; following starts need not align independently.
 if p_value_method is not null and t.price>0 then
 a:=public.visit_book_with_value(t.id,p_staff,p_date,p_start,p_name,p_phone,p_self,p_email,null,true,null,null,p_value_method,p_value_id,p_staff_selected);
 else
 a:=public.visit_book_guaranteed(t.id,p_staff,p_date,p_start,p_name,p_phone,p_self,p_email,p_card,p_consent,null,null,p_staff_selected,required);
 end if;
 update public.appointments set visit_id=v.id,visit_order=ordinal where id=a.id returning * into a;
 result:=result||jsonb_build_array(to_jsonb(a));p_start:=p_start+t.duration;
 end loop;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'treatment_visit_booked',jsonb_build_object('visit_id',v.id,'appointments',result));
 return jsonb_build_object('appointments',result,'visit_id',v.id);
end;$$;
revoke all on function public.get_visit_slots(integer[],date,integer),public.get_visit_value_options(integer[]),public.visit_requires_guarantee(integer[],text),public.book_treatment_visit(integer[],jsonb,uuid,integer,date,integer,text,text,boolean,text,uuid,boolean,boolean,text,uuid) from public,anon;
grant execute on function public.get_visit_slots(integer[],date,integer),public.get_visit_value_options(integer[]),public.visit_requires_guarantee(integer[],text),public.book_treatment_visit(integer[],jsonb,uuid,integer,date,integer,text,text,boolean,text,uuid,boolean,boolean,text,uuid) to authenticated;
commit;
