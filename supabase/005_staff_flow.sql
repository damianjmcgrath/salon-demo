-- Apply once AFTER 004_client_booking_flow.sql. Fictional development data only.
begin;
alter table public.staff_users add column staff_id integer references public.staff(id), add column can_manage_own_breaks boolean not null default true;
-- Map staff accounts explicitly after this migration; never infer their diary identity from names.
create unique index staff_identity_unique on public.staff_users(staff_id) where staff_id is not null;
create table public.clients(
 id uuid primary key default gen_random_uuid(), auth_user_id uuid unique references auth.users(id),
 name text not null check(length(trim(name))>0),email text not null,phone text not null,
 account_creation_actor uuid references auth.users(id),account_creation_reserved_at timestamptz,
 revision integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index clients_email_search on public.clients(lower(email));
create table public.client_notes(id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id),body text not null check(length(trim(body))>0),author_id uuid not null references auth.users(id),author_name text not null,created_at timestamptz not null default now());
create table public.staff_day_breaks(id uuid primary key default gen_random_uuid(),staff_id integer not null references public.staff(id),appointment_date date not null,kind text not null check(kind in ('lunch','break')),start_minute integer not null,duration integer not null check(duration>0),revision integer not null default 0,check(start_minute>=0 and start_minute+duration<=1440));
create unique index one_daily_lunch on public.staff_day_breaks(staff_id,appointment_date) where kind='lunch';
alter table public.appointments alter column user_id drop not null;
alter table public.appointments add column client_id uuid references public.clients(id),add column revision integer not null default 0;
alter table public.audit_events add column client_id uuid references public.clients(id);
alter table public.clients enable row level security;
alter table public.client_notes enable row level security;
alter table public.staff_day_breaks enable row level security;
create policy client_read on public.clients for select to authenticated using(public.is_salon_staff() or auth_user_id=auth.uid());
create policy client_notes_read on public.client_notes for select to authenticated using(public.is_salon_staff());
create policy day_break_read on public.staff_day_breaks for select to authenticated using(public.is_salon_staff());
grant select on public.clients,public.client_notes,public.staff_day_breaks to authenticated;
-- Backfill real demo account profiles; staff identities never become clients.
insert into public.clients(auth_user_id,name,email,phone)
 select u.id,coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),split_part(u.email,'@',1)),coalesce(u.email,''),coalesce(u.raw_user_meta_data->>'mobile','')
 from auth.users u where not exists(select 1 from public.staff_users s where s.user_id=u.id);
update public.appointments a set client_id=c.id from public.clients c where a.user_id=c.auth_user_id and a.booked_for_self;
-- Keep each historical proxy attendee separate rather than merging by name/email.
do $$ declare a record; cid uuid; begin
 for a in select * from public.appointments where client_id is null loop
 insert into public.clients(name,email,phone) values(a.client_name,coalesce(a.attendee_email,''),a.phone) returning id into cid;
 update public.appointments set client_id=cid where id=a.id;
 end loop;
end; $$;
create function public.ensure_own_client() returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; u auth.users; begin
 if auth.uid() is null or exists(select 1 from public.staff_users where user_id=auth.uid()) then raise exception 'Client sign-in required.'; end if;
 select * into u from auth.users where id=auth.uid();
 if coalesce((u.raw_app_meta_data->>'requires_password_change')::boolean,false) then raise exception 'Change your temporary password before booking.';end if;
 insert into public.clients(auth_user_id,name,email,phone) values(u.id,coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),split_part(u.email,'@',1)),coalesce(u.email,''),coalesce(u.raw_user_meta_data->>'mobile','')) on conflict(auth_user_id) do nothing;
 select id into cid from public.clients where auth_user_id=u.id;return cid;
end; $$;
create function public.search_clients(p_name text default '',p_email text default '',p_phone text default '') returns setof public.clients language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.'; end if;
 if trim(coalesce(p_name,''))='' and trim(coalesce(p_email,''))='' and trim(coalesce(p_phone,''))='' then raise exception 'Enter at least one search field.';end if;
 return query select c.* from public.clients c where
 (trim(coalesce(p_name,''))='' or strpos(lower(c.name),lower(trim(p_name)))>0) and
 (trim(coalesce(p_email,''))='' or strpos(lower(c.email),lower(trim(p_email)))>0) and
 (trim(coalesce(p_phone,''))='' or strpos(regexp_replace(c.phone,'[^0-9]','','g'),regexp_replace(p_phone,'[^0-9]','','g'))>0)
 order by c.name,c.created_at limit 100;
end; $$;
create function public.create_client(p_name text,p_email text,p_phone text) returns public.clients language plpgsql security definer set search_path='' as $$
declare c public.clients;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if length(trim(coalesce(p_name,'')))=0 or coalesce(p_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'))<5 then raise exception 'Valid name, email and phone are required.';end if;
 insert into public.clients(name,email,phone) values(trim(p_name),lower(trim(p_email)),trim(p_phone)) returning * into c;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),c.id,'client_created',jsonb_build_object('after',to_jsonb(c)));
 return c;
end; $$;
create function public.update_client(p_id uuid,p_name text,p_email text,p_phone text,p_revision integer) returns public.clients language plpgsql security definer set search_path='' as $$
declare old public.clients;c public.clients;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into old from public.clients where id=p_id for update;
 if not found then raise exception 'Client not found.';end if;
 if old.revision is distinct from p_revision then raise exception 'This record changed. Reload before editing.';end if;
 if length(trim(coalesce(p_name,'')))=0 or coalesce(p_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'))<5 then raise exception 'Valid name, email and phone are required.';end if;
 -- Contact email is independent of verified sign-in email. Never change an Auth identity here.
 update public.clients set name=trim(p_name),email=lower(trim(p_email)),phone=trim(p_phone),revision=revision+1,updated_at=now() where id=p_id returning * into c;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),c.id,'client_updated',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(c)));
 return c;
end; $$;
create function public.add_client_note(p_client_id uuid,p_body text) returns public.client_notes language plpgsql security definer set search_path='' as $$
declare n public.client_notes;actor text;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select coalesce(s.name,u.role) into actor from public.staff_users u left join public.staff s on s.id=u.staff_id where u.user_id=auth.uid();
 insert into public.client_notes(client_id,body,author_id,author_name) values(p_client_id,trim(p_body),auth.uid(),actor) returning * into n;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),p_client_id,'client_note_added',jsonb_build_object('note_id',n.id));
 return n;
end; $$;
create function public.get_client_activity(p_client_id uuid) returns table(id bigint,action text,created_at timestamptz,actor_name text,details jsonb) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 return query select e.id,e.action,e.created_at,coalesce(s.name,e.actor_role,'Historical account'),e.details from public.audit_events e left join public.staff_users u on u.user_id=e.user_id left join public.staff s on s.id=u.staff_id where e.client_id=p_client_id or e.appointment_id in(select a.id from public.appointments a where a.client_id=p_client_id) order by e.created_at desc,e.id desc limit 100;
end; $$;
create function public.get_diary_breaks(p_date date) returns table(id uuid,staff_id integer,start_minute integer,duration integer,kind text,revision integer) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 return query select b.id,b.staff_id,b.start_minute,b.duration,b.kind,b.revision from public.staff_day_breaks b where b.appointment_date=p_date
 union all select null::uuid,w.staff_id,w.start_minute,w.duration,'lunch'::text,0 from public.weekly_breaks w where w.weekday=extract(dow from p_date)::integer and not exists(select 1 from public.staff_day_breaks d where d.staff_id=w.staff_id and d.appointment_date=p_date and d.kind='lunch');
end; $$;
-- Availability ignores the appointment being amended, but only for authorised staff.
create function public.get_booking_slots(p_treatment_id integer,p_date date,p_staff_id integer default null,p_exclude_id uuid default null) returns table(start_minute integer,staff_id integer) language plpgsql stable security definer set search_path='' as $$
begin
 if p_exclude_id is not null and (not public.is_salon_staff() or not exists(select 1 from public.appointments where id=p_exclude_id and status in ('booked','checked_in'))) then raise exception 'Staff amendment access required.';end if;
 return query select slot::integer,r.staff_id from public.weekly_rotas r
 join public.staff_treatments sk on sk.staff_id=r.staff_id and sk.treatment_id=p_treatment_id
 join public.treatments t on t.id=sk.treatment_id and t.active
 cross join lateral generate_series(r.start_minute,r.end_minute-t.duration,1) slot
 where slot % (case when t.duration=60 then 60 when t.duration=30 then 30 when t.duration<15 then 5 else 15 end)=0
 and r.weekday=extract(dow from p_date)::integer and (p_staff_id is null or r.staff_id=p_staff_id)
 and p_date>=(now() at time zone 'Europe/Dublin')::date and p_date+make_interval(mins=>slot)>now() at time zone 'Europe/Dublin'
 and not exists(select 1 from public.weekly_breaks b where b.staff_id=r.staff_id and b.weekday=r.weekday and not exists(select 1 from public.staff_day_breaks d where d.staff_id=r.staff_id and d.appointment_date=p_date and d.kind='lunch') and int4range(b.start_minute,b.start_minute+b.duration,'[)') && int4range(slot,slot+t.duration,'[)'))
 and not exists(select 1 from public.staff_day_breaks b where b.staff_id=r.staff_id and b.appointment_date=p_date and int4range(b.start_minute,b.start_minute+b.duration,'[)') && int4range(slot,slot+t.duration,'[)'))
 and not exists(select 1 from public.appointments a where a.staff_id=r.staff_id and a.appointment_date=p_date and a.status<>'cancelled' and (p_exclude_id is null or a.id<>p_exclude_id) and int4range(a.start_minute,a.start_minute+a.duration,'[)') && int4range(slot,slot+t.duration,'[)')) order by slot,r.staff_id;
end; $$;
create or replace function public.get_available_slots(p_treatment_id integer,p_date date,p_staff_id integer default null) returns table(start_minute integer,staff_id integer) language sql stable security definer set search_path='' as $$ select * from public.get_booking_slots(p_treatment_id,p_date,p_staff_id,null); $$;
create function public.save_staff_break(p_date date,p_start integer,p_end integer,p_kind text,p_id uuid default null,p_revision integer default 0) returns public.staff_day_breaks language plpgsql security definer set search_path='' as $$
declare sid integer;allowed boolean;old public.staff_day_breaks;b public.staff_day_breaks;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select staff_id,can_manage_own_breaks into sid,allowed from public.staff_users where user_id=auth.uid();
 if sid is null then raise exception 'Your account must be mapped to a staff diary column by the owner.';end if;
 if not allowed then raise exception 'The owner has disabled your permission to change breaks.';end if;
 if p_kind not in ('lunch','break') or p_kind is null or p_start is null or p_end is null or p_end<=p_start then raise exception 'Choose a valid start and end time.';end if;
 perform pg_advisory_xact_lock(sid,(p_date-date '2000-01-01')::integer);
 if p_id is not null then
 select * into old from public.staff_day_breaks where id=p_id for update;
 if not found or old.staff_id<>sid or old.appointment_date<>p_date or old.kind<>p_kind then raise exception 'You can only edit your own breaks for this date.';end if;
 elsif p_kind='lunch' then
 select * into old from public.staff_day_breaks where staff_id=sid and appointment_date=p_date and kind='lunch' for update;
 end if;
 if coalesce(old.revision,0) is distinct from p_revision then raise exception 'This break changed. Reload the diary.';end if;
 if not exists(select 1 from public.weekly_rotas where staff_id=sid and weekday=extract(dow from p_date)::integer and p_start>=start_minute and p_end<=end_minute) then raise exception 'Break must fit inside your working day.';end if;
 if p_date<(now() at time zone 'Europe/Dublin')::date then raise exception 'Past breaks cannot be changed here.';end if;
 if exists(select 1 from public.appointments where staff_id=sid and appointment_date=p_date and status<>'cancelled' and int4range(start_minute,start_minute+duration,'[)') && int4range(p_start,p_end,'[)')) then raise exception 'Break overlaps an appointment.';end if;
 if exists(select 1 from public.staff_day_breaks d where d.staff_id=sid and d.appointment_date=p_date and (old.id is null or d.id<>old.id) and int4range(d.start_minute,d.start_minute+d.duration,'[)') && int4range(p_start,p_end,'[)')) then raise exception 'Break overlaps another break.';end if;
 if p_kind='break' and not exists(select 1 from public.staff_day_breaks where staff_id=sid and appointment_date=p_date and kind='lunch') and exists(select 1 from public.weekly_breaks where staff_id=sid and weekday=extract(dow from p_date)::integer and int4range(start_minute,start_minute+duration,'[)') && int4range(p_start,p_end,'[)')) then raise exception 'Break overlaps lunch.';end if;
 if old.id is null then insert into public.staff_day_breaks(staff_id,appointment_date,kind,start_minute,duration) values(sid,p_date,p_kind,p_start,p_end-p_start) returning * into b;
 else update public.staff_day_breaks set start_minute=p_start,duration=p_end-p_start,revision=revision+1 where id=old.id returning * into b;end if;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_break_saved',jsonb_build_object('before',case when old.id is null and p_kind='lunch' then (select to_jsonb(w) from public.weekly_breaks w where w.staff_id=sid and w.weekday=extract(dow from p_date)::integer limit 1) else to_jsonb(old) end,'after',to_jsonb(b)));
 return b;
end; $$;
create function public.staff_book_appointment(p_client_id uuid,p_treatment_id integer,p_staff_id integer,p_date date,p_start integer,p_demo_card text,p_demo_consent boolean) returns public.appointments language plpgsql security definer set search_path='' as $$
declare c public.clients;t public.treatments;a public.appointments;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if not coalesce(p_demo_consent,false) or p_demo_card is null or p_demo_card not in ('saved_demo','new_demo') then raise exception 'Demo guarantee acknowledgement required.';end if;
 select * into c from public.clients where id=p_client_id;if not found then raise exception 'Client not found.';end if;
 select * into t from public.treatments where id=p_treatment_id and active;if not found then raise exception 'Treatment unavailable.';end if;
 if t.patch_required then raise exception 'Patch-test workflow is not yet implemented.';end if;
 perform pg_advisory_xact_lock(p_staff_id,(p_date-date '2000-01-01')::integer);
 if not exists(select 1 from public.get_available_slots(p_treatment_id,p_date,p_staff_id) where start_minute=p_start) then raise exception 'That time is no longer available.';end if;
 insert into public.appointments(user_id,client_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,attendee_email,treatment_name,price,booked_for_self,demo_consent,demo_card,guarantee_amount,guarantee_policy_version) values(c.auth_user_id,c.id,p_staff_id,t.id,p_date,p_start,t.duration,c.name,c.phone,c.email,t.name,t.price,true,true,p_demo_card,10,'demo-v1') returning * into a;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),c.id,a.id,'staff_booking_created',jsonb_build_object('after',to_jsonb(a)));
 return a;
end; $$;
create function public.amend_appointment(p_id uuid,p_treatment_id integer,p_staff_id integer,p_date date,p_start integer,p_revision integer,p_reason text) returns public.appointments language plpgsql security definer set search_path='' as $$
declare old public.appointments;a public.appointments;t public.treatments;l record;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into old from public.appointments where id=p_id for update;
 if not found or old.status not in ('booked','checked_in') then raise exception 'Only open appointments can be amended.';end if;
 if old.revision is distinct from p_revision then raise exception 'This appointment changed. Reload before editing.';end if;
 if length(trim(coalesce(p_reason,'')))=0 then raise exception 'Add a reason for the change.';end if;
 select * into t from public.treatments where id=p_treatment_id and active;if not found then raise exception 'Treatment unavailable.';end if;
 if t.patch_required then raise exception 'Patch-test workflow is not yet implemented.';end if;
 -- Always lock both resources in a stable order when moving between staff/days.
 for l in select distinct sid,day from (values(old.staff_id,old.appointment_date),(p_staff_id,p_date)) as locks(sid,day) order by sid,day loop
 perform pg_advisory_xact_lock(l.sid,(l.day-date '2000-01-01')::integer);end loop;
 if not exists(select 1 from public.get_booking_slots(p_treatment_id,p_date,p_staff_id,p_id) where start_minute=p_start) then raise exception 'That time is no longer available.';end if;
 update public.appointments set staff_id=p_staff_id,treatment_id=t.id,appointment_date=p_date,start_minute=p_start,duration=t.duration,treatment_name=t.name,price=case when old.treatment_id=t.id then old.price else t.price end,revision=revision+1 where id=p_id returning * into a;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,'appointment_amended',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(a),'reason',trim(p_reason)));
 return a;
end; $$;
drop function public.update_appointment_status(uuid,text,text);
create function public.update_appointment_status(p_id uuid,p_status text,p_payment text default null,p_revision integer default null,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into a from public.appointments where id=p_id for update;
 if not found then raise exception 'Appointment not found.';end if;
 if p_revision is not null and a.revision<>p_revision then raise exception 'This appointment changed. Reload before editing.';end if;
 if not ((a.status='booked' and p_status in ('checked_in','cancelled','no_show')) or (a.status='checked_in' and p_status in ('completed','cancelled'))) then raise exception 'Invalid appointment status transition.';end if;
 if p_status in ('cancelled','no_show') and length(trim(coalesce(p_reason,'')))=0 then raise exception 'Add a reason.';end if;
 if p_status='no_show' and a.appointment_date+make_interval(mins=>a.start_minute)>now() at time zone 'Europe/Dublin' then raise exception 'A future appointment cannot be marked no-show.';end if;
 if p_status='completed' and (p_payment is null or p_payment not in ('card','cash','voucher','credit')) then raise exception 'Choose a payment method.';end if;
 perform pg_advisory_xact_lock(a.staff_id,(a.appointment_date-date '2000-01-01')::integer);
 update public.appointments set status=p_status,revision=revision+1,payment_method=case when p_status='completed' then p_payment else null end,checked_in_at=case when p_status='checked_in' then now() else checked_in_at end,completed_at=case when p_status='completed' then now() else completed_at end where id=p_id;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,p_id,'status_changed',jsonb_build_object('before',a.status,'after',p_status,'payment_method',p_payment,'reason',p_reason,'guarantee_charged',false));
end; $$;
-- Attach client/proxy bookings to the new independent client records automatically.
create function public.attach_booking_client() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;begin
 if new.client_id is not null then return new;end if;
 if new.booked_for_self then
 cid:=public.ensure_own_client();
 else
 insert into public.clients(name,email,phone) values(new.client_name,coalesce(new.attendee_email,''),new.phone) returning id into cid;
 end if;
 new.client_id:=cid;return new;
end; $$;
create trigger attach_client before insert on public.appointments for each row execute function public.attach_booking_client();
-- Only the server-side provisioning function may link a newly created login.
create function public.link_client_account(p_client_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.clients;u auth.users;begin
 select * into c from public.clients where id=p_client_id for update;
 select * into u from auth.users where id=p_user_id;
 if c.id is null or u.id is null or lower(u.email)<>lower(c.email) or c.auth_user_id is not null or exists(select 1 from public.staff_users where user_id=p_user_id) then raise exception 'Account cannot be linked to this client.';end if;
 if c.account_creation_actor is null or not exists(select 1 from public.staff_users where user_id=c.account_creation_actor and role in ('staff','admin','it_support')) then raise exception 'Account creation reservation required.';end if;
 update public.clients set auth_user_id=p_user_id,revision=revision+1,updated_at=now() where id=p_client_id;
 update public.appointments set user_id=p_user_id where client_id=p_client_id and booked_for_self and user_id is null;
 insert into public.audit_events(user_id,client_id,action) values(c.account_creation_actor,p_client_id,'client_account_created');
end; $$;
create function public.reserve_client_account(p_client_id uuid,p_actor_id uuid) returns public.clients language plpgsql security definer set search_path='' as $$
declare c public.clients;begin
 if not exists(select 1 from public.staff_users where user_id=p_actor_id and role in ('staff','admin','it_support')) then raise exception 'Staff access required.';end if;
 select * into c from public.clients where id=p_client_id for update;
 if not found or c.auth_user_id is not null or (c.account_creation_reserved_at is not null and c.account_creation_reserved_at>now()-interval '5 minutes') then raise exception 'Client account cannot be provisioned.';end if;
 update public.clients set account_creation_actor=p_actor_id,account_creation_reserved_at=now() where id=p_client_id returning * into c;return c;
end; $$;
create function public.release_client_account_reservation(p_client_id uuid,p_actor_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin update public.clients set account_creation_actor=null,account_creation_reserved_at=null where id=p_client_id and account_creation_actor=p_actor_id;end; $$;
revoke all on function public.reserve_client_account(uuid,uuid),public.release_client_account_reservation(uuid,uuid) from public;
grant execute on function public.reserve_client_account(uuid,uuid),public.release_client_account_reservation(uuid,uuid) to service_role;
-- Explicit grants: no direct browser mutations, no accountant/client staff RPC access.
revoke all on function public.ensure_own_client() from public;
grant execute on function public.ensure_own_client() to authenticated;
revoke all on function public.search_clients(text,text,text),public.create_client(text,text,text),public.update_client(uuid,text,text,text,integer),public.add_client_note(uuid,text),public.get_client_activity(uuid),public.get_diary_breaks(date),public.save_staff_break(date,integer,integer,text,uuid,integer),public.staff_book_appointment(uuid,integer,integer,date,integer,text,boolean),public.amend_appointment(uuid,integer,integer,date,integer,integer,text),public.update_appointment_status(uuid,text,text,integer,text) from public;
grant execute on function public.search_clients(text,text,text),public.create_client(text,text,text),public.update_client(uuid,text,text,text,integer),public.add_client_note(uuid,text),public.get_client_activity(uuid),public.get_diary_breaks(date),public.save_staff_break(date,integer,integer,text,uuid,integer),public.staff_book_appointment(uuid,integer,integer,date,integer,text,boolean),public.amend_appointment(uuid,integer,integer,date,integer,integer,text),public.update_appointment_status(uuid,text,text,integer,text) to authenticated;
revoke all on function public.get_booking_slots(integer,date,integer,uuid) from public;
grant execute on function public.get_booking_slots(integer,date,integer,uuid) to anon,authenticated;
revoke all on function public.attach_booking_client(),public.link_client_account(uuid,uuid) from public;
grant execute on function public.link_client_account(uuid,uuid) to service_role;
commit;
