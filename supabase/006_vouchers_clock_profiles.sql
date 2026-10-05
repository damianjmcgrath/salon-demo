-- Apply once AFTER 005_staff_flow.sql. Fictional development environment.
begin;
create table public.portal_profiles(profile_key text primary key,display_name text not null,role text not null unique check(role in ('admin','staff','accountant')),staff_id integer unique references public.staff(id));
insert into public.portal_profiles values('aoife','Aoife','admin',1),('leah','Leah','staff',2),('jacqui','Jacqui','accountant',null);
alter table public.portal_profiles enable row level security;
create policy profile_tiles on public.portal_profiles for select to anon,authenticated using(true);
grant select on public.portal_profiles to anon,authenticated;
alter table public.staff add column active boolean not null default true;
update public.staff set name='Aoife' where id=1;
update public.staff set name='Leah' where id=2;
update public.staff set active=false where id not in (1,2);
-- Retired therapists and accounts keep their history; they lose operational access.
alter table public.staff_users add column active boolean not null default true,add column profile_key text references public.portal_profiles(profile_key);
update public.staff_users set profile_key='aoife' where role='admin' and staff_id=1;
update public.staff_users set profile_key='leah' where role='staff' and staff_id=2;
-- Jacqui is linked explicitly to her Auth UUID after this migration. Never guess identity.
update public.staff_users set active=false where profile_key is null;
create unique index one_account_per_test_profile on public.staff_users(profile_key) where active;
create function public.validate_portal_membership() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.active and not exists(select 1 from public.portal_profiles p where p.profile_key=new.profile_key and p.role=new.role and p.staff_id is not distinct from new.staff_id) then raise exception 'Active account must match its assigned test profile and diary column.';end if;
 return new;
end; $$;
revoke all on function public.validate_portal_membership() from public;
create trigger validate_profile before insert or update on public.staff_users for each row execute function public.validate_portal_membership();
create or replace function public.is_salon_staff() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.staff_users where user_id=auth.uid() and active and role in ('staff','admin')); $$;
-- Only active therapists can be offered for new bookings.
drop policy staff_names_read on public.staff;
create policy staff_names_read on public.staff for select to anon,authenticated using(active);
create or replace function public.get_daily_report(p_date date) returns table(id uuid,staff_id integer,start_minute integer,duration integer,client_name text,treatment_name text,price numeric,status text,payment_method text,appointment_date date) language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.staff_users where user_id=auth.uid() and active and role in ('admin','accountant')) then raise exception 'Reporting access required.';end if;
 return query select a.id,a.staff_id,a.start_minute,a.duration,a.client_name,a.treatment_name,a.price,a.status,a.payment_method,a.appointment_date from public.appointments a where a.appointment_date=p_date and a.status='completed' order by a.start_minute;
end; $$;
create table public.work_sessions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),staff_id integer not null references public.staff(id),staff_name text not null,clocked_in_at timestamptz not null default now(),clocked_out_at timestamptz,check(clocked_out_at is null or clocked_out_at>=clocked_in_at));
create unique index one_open_shift_per_user on public.work_sessions(user_id) where clocked_out_at is null;
create unique index one_open_shift_per_staff on public.work_sessions(staff_id) where clocked_out_at is null;
alter table public.work_sessions enable row level security;
create policy own_clock_read on public.work_sessions for select to authenticated using(public.is_salon_staff() and (user_id=auth.uid() or exists(select 1 from public.staff_users where user_id=auth.uid() and active and role='admin')));
grant select on public.work_sessions to authenticated;
create function public.get_my_shift() returns public.work_sessions language plpgsql stable security definer set search_path='' as $$
declare w public.work_sessions;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into w from public.work_sessions where user_id=auth.uid() and clocked_out_at is null;return w;
end; $$;
create function public.clock_in() returns public.work_sessions language plpgsql security definer set search_path='' as $$
declare w public.work_sessions;sid integer;sname text;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select u.staff_id,s.name into sid,sname from public.staff_users u join public.staff s on s.id=u.staff_id and s.active where u.user_id=auth.uid() and u.active;
 if sid is null then raise exception 'Your account must be mapped to its diary column.';end if;
 perform pg_advisory_xact_lock(hashtextextended('clock:'||auth.uid()::text,0));
 if exists(select 1 from public.work_sessions where user_id=auth.uid() and clocked_out_at is null) then raise exception 'You are already clocked in.';end if;
 insert into public.work_sessions(user_id,staff_id,staff_name) values(auth.uid(),sid,sname) returning * into w;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_clocked_in',jsonb_build_object('session_id',w.id,'staff_id',sid,'clocked_in_at',w.clocked_in_at));return w;
end; $$;
create function public.clock_out() returns public.work_sessions language plpgsql security definer set search_path='' as $$
declare w public.work_sessions;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('clock:'||auth.uid()::text,0));
 select * into w from public.work_sessions where user_id=auth.uid() and clocked_out_at is null for update;
 if not found then raise exception 'Clock in before clocking out.';end if;
 update public.work_sessions set clocked_out_at=clock_timestamp() where id=w.id returning * into w;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_clocked_out',jsonb_build_object('session_id',w.id,'staff_id',w.staff_id,'clocked_in_at',w.clocked_in_at,'clocked_out_at',w.clocked_out_at));return w;
end; $$;
create table public.vouchers(id uuid primary key default gen_random_uuid(),code text not null unique,original_amount numeric(10,2) not null check(original_amount>0 and original_amount<1000000),expires_on date not null,client_id uuid references public.clients(id),assigned_client_name text,revision integer not null default 0,created_at timestamptz not null default now(),created_by uuid not null references auth.users(id));
create table public.voucher_transactions(id uuid primary key default gen_random_uuid(),voucher_id uuid not null references public.vouchers(id),kind text not null check(kind in ('issued','assigned','reassigned')),amount numeric(10,2) not null,from_client_id uuid references public.clients(id),to_client_id uuid references public.clients(id),user_id uuid not null references auth.users(id),created_at timestamptz not null default now(),check((kind='issued' and amount>0 and amount<1000000) or (kind in ('assigned','reassigned') and amount=0)));
create unique index one_voucher_issue on public.voucher_transactions(voucher_id) where kind='issued';
alter table public.vouchers enable row level security;
alter table public.voucher_transactions enable row level security;
create policy voucher_staff_read on public.vouchers for select to authenticated using(public.is_salon_staff());
create policy voucher_ledger_staff_read on public.voucher_transactions for select to authenticated using(public.is_salon_staff());
grant select on public.vouchers,public.voucher_transactions to authenticated;
create function public.create_voucher(p_amount numeric,p_expires_on date,p_client_id uuid default null) returns public.vouchers language plpgsql security definer set search_path='' as $$
declare v public.vouchers;cname text;raw text;attempt integer;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if p_amount is null or not (p_amount>0 and p_amount<1000000) or p_amount<>round(p_amount,2) then raise exception 'Enter a positive euro amount with up to two decimal places.';end if;
 if p_expires_on is null or p_expires_on<(now() at time zone 'Europe/Dublin')::date then raise exception 'Choose an expiry date that is not in the past.';end if;
 if p_client_id is not null then select name into cname from public.clients where id=p_client_id;if not found then raise exception 'Client not found.';end if;end if;
 for attempt in 1..5 loop
 raw:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 begin
 insert into public.vouchers(code,original_amount,expires_on,client_id,assigned_client_name,created_by) values('SC-'||substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4),p_amount,p_expires_on,p_client_id,cname,auth.uid()) returning * into v;exit;
 exception when unique_violation then if attempt=5 then raise;end if;end;
 end loop;
 insert into public.voucher_transactions(voucher_id,kind,amount,to_client_id,user_id) values(v.id,'issued',v.original_amount,v.client_id,auth.uid());
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),v.client_id,'voucher_created',jsonb_build_object('after',to_jsonb(v)));return v;
end; $$;
create function public.search_vouchers(p_code text default '',p_client_id uuid default null) returns table(id uuid,code text,original_amount numeric,expires_on date,client_id uuid,assigned_client_name text,revision integer,created_at timestamptz,balance numeric) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if trim(coalesce(p_code,''))='' and p_client_id is null then raise exception 'Enter a voucher ID or select a client.';end if;
 return query select v.id,v.code,v.original_amount,v.expires_on,v.client_id,v.assigned_client_name,v.revision,v.created_at,coalesce(sum(l.amount),0) from public.vouchers v left join public.voucher_transactions l on l.voucher_id=v.id
 where (trim(coalesce(p_code,''))='' or regexp_replace(upper(v.code),'[^A-Z0-9]','','g')=regexp_replace(upper(p_code),'[^A-Z0-9]','','g')) and (p_client_id is null or v.client_id=p_client_id)
 group by v.id order by v.created_at desc limit 100;
end; $$;
create function public.reassign_voucher(p_id uuid,p_client_id uuid,p_revision integer) returns public.vouchers language plpgsql security definer set search_path='' as $$
declare old public.vouchers;v public.vouchers;cname text;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into old from public.vouchers where id=p_id for update;if not found then raise exception 'Voucher not found.';end if;
 if old.revision is distinct from p_revision then raise exception 'Voucher changed. Search again before transferring.';end if;
 if old.expires_on<(now() at time zone 'Europe/Dublin')::date then raise exception 'An expired voucher cannot be transferred.';end if;
 if old.client_id=p_client_id then raise exception 'Voucher is already assigned to this client.';end if;
 if (select coalesce(sum(amount),0) from public.voucher_transactions where voucher_id=p_id)<=0 then raise exception 'This voucher has no remaining value.';end if;
 select name into cname from public.clients where id=p_client_id;if not found then raise exception 'Choose an existing client.';end if;
 update public.vouchers set client_id=p_client_id,assigned_client_name=cname,revision=revision+1 where id=p_id returning * into v;
 insert into public.voucher_transactions(voucher_id,kind,amount,from_client_id,to_client_id,user_id) values(v.id,case when old.client_id is null then 'assigned' else 'reassigned' end,0,old.client_id,v.client_id,auth.uid());
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),v.client_id,'voucher_reassigned',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(v),'previous_client_id',old.client_id));return v;
end; $$;
revoke all on function public.get_my_shift(),public.clock_in(),public.clock_out(),public.create_voucher(numeric,date,uuid),public.search_vouchers(text,uuid),public.reassign_voucher(uuid,uuid,integer) from public;
grant execute on function public.get_my_shift(),public.clock_in(),public.clock_out(),public.create_voucher(numeric,date,uuid),public.search_vouchers(text,uuid),public.reassign_voucher(uuid,uuid,integer) to authenticated;

create or replace function public.get_booking_slots(p_treatment_id integer,p_date date,p_staff_id integer default null,p_exclude_id uuid default null) returns table(start_minute integer,staff_id integer) language plpgsql stable security definer set search_path='' as $$
begin
 if p_exclude_id is not null and (not public.is_salon_staff() or not exists(select 1 from public.appointments where id=p_exclude_id and status in ('booked','checked_in'))) then raise exception 'Staff amendment access required.';end if;
 return query select slot::integer,r.staff_id from public.weekly_rotas r
 join public.staff active_staff on active_staff.id=r.staff_id and active_staff.active
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

create or replace function public.get_client_activity(p_client_id uuid) returns table(id bigint,action text,created_at timestamptz,actor_name text,details jsonb) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 return query select e.id,e.action,e.created_at,coalesce(s.name,e.actor_role,'Historical account'),e.details from public.audit_events e left join public.staff_users u on u.user_id=e.user_id left join public.staff s on s.id=u.staff_id where e.client_id=p_client_id or e.details->>'previous_client_id'=p_client_id::text or e.appointment_id in(select a.id from public.appointments a where a.client_id=p_client_id) order by e.created_at desc,e.id desc limit 100;
end; $$;

create or replace function public.link_client_account(p_client_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.clients;u auth.users;begin
 select * into c from public.clients where id=p_client_id for update;
 select * into u from auth.users where id=p_user_id;
 if c.id is null or u.id is null or lower(u.email)<>lower(c.email) or c.auth_user_id is not null or exists(select 1 from public.staff_users where user_id=p_user_id) then raise exception 'Account cannot be linked to this client.';end if;
 if c.account_creation_actor is null or not exists(select 1 from public.staff_users where user_id=c.account_creation_actor and active and role in ('staff','admin')) then raise exception 'Account creation reservation required.';end if;
 update public.clients set auth_user_id=p_user_id,revision=revision+1,updated_at=now() where id=p_client_id;
 update public.appointments set user_id=p_user_id where client_id=p_client_id and booked_for_self and user_id is null;
 insert into public.audit_events(user_id,client_id,action) values(c.account_creation_actor,p_client_id,'client_account_created');
end; $$;

create or replace function public.reserve_client_account(p_client_id uuid,p_actor_id uuid) returns public.clients language plpgsql security definer set search_path='' as $$
declare c public.clients;begin
 if not exists(select 1 from public.staff_users where user_id=p_actor_id and active and role in ('staff','admin')) then raise exception 'Staff access required.';end if;
 select * into c from public.clients where id=p_client_id for update;
 if not found or c.auth_user_id is not null or (c.account_creation_reserved_at is not null and c.account_creation_reserved_at>now()-interval '5 minutes') then raise exception 'Client account cannot be provisioned.';end if;
 update public.clients set account_creation_actor=p_actor_id,account_creation_reserved_at=now() where id=p_client_id returning * into c;return c;
end; $$;

commit;
