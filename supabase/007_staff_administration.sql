-- Apply once after 006. Private HR data never appears in public login profiles.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create function public.is_salon_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.staff_users where user_id=auth.uid() and active and role='admin'); $$;
revoke all on function public.is_salon_admin() from public;grant execute on function public.is_salon_admin() to authenticated;
drop index public.staff_identity_unique;
create unique index staff_identity_unique on public.staff_users(staff_id) where staff_id is not null and active;
alter table public.portal_profiles drop constraint portal_profiles_role_key;
alter table public.portal_profiles add column active boolean not null default true,add column photo_url text;
alter table public.staff add column photo_url text;
update public.staff set photo_url=case id when 1 then './images/aoife.webp' when 2 then './images/leah.webp' end where id in(1,2);
update public.portal_profiles p set photo_url=s.photo_url from public.staff s where s.id=p.staff_id;
drop policy profile_tiles on public.portal_profiles;create policy profile_tiles on public.portal_profiles for select to anon,authenticated using(active);
create or replace function public.validate_portal_membership() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.active and not exists(select 1 from public.portal_profiles p left join public.staff s on s.id=p.staff_id where p.profile_key=new.profile_key and p.active and p.role=new.role and p.staff_id is not distinct from new.staff_id and (p.role='accountant' or s.active)) then raise exception 'Active account must match its active portal profile and diary column.';end if;return new;end; $$;
drop policy admin_audit_read on public.audit_events;create policy admin_audit_read on public.audit_events for select to authenticated using(public.is_salon_admin());
create table public.staff_details(staff_id integer primary key references public.staff(id),first_name text not null,last_name text not null default '',address text not null default '',date_of_birth date,phone text not null default '',email text not null default '',date_hired date,date_left date,employment_type text not null default 'hourly' check(employment_type in('hourly','salaried','commission')),salary numeric(12,2),hourly_rate numeric(10,2),commission_rate numeric(5,2),revision integer not null default 0,check(length(trim(first_name))>0),check(salary is null or salary>=0),check(hourly_rate is null or hourly_rate>=0),check(commission_rate is null or commission_rate between 0 and 100),check((employment_type='hourly' and salary is null and commission_rate is null) or (employment_type='salaried' and hourly_rate is null and commission_rate is null) or(employment_type='commission' and salary is null and hourly_rate is null)),check(date_left is null or date_hired is null or date_left>=date_hired));
insert into public.staff_details(staff_id,first_name,last_name) select id,name,'' from public.staff;
create table public.staff_notes(id uuid primary key default gen_random_uuid(),staff_id integer not null references public.staff(id),body text not null check(length(trim(body)) between 1 and 5000),created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),removed_at timestamptz,removed_by uuid references auth.users(id));
create table public.staff_day_shifts(staff_id integer not null references public.staff(id),shift_date date not null,start_minute integer,end_minute integer,revision integer not null default 0,primary key(staff_id,shift_date),check((start_minute is null and end_minute is null) or(start_minute>=0 and end_minute<=1440 and start_minute<end_minute)));
create table public.staff_pin_secrets(staff_id integer primary key references public.staff(id),pin_hash text,failed_attempts integer not null default 0,locked_until timestamptz,managed_user_id uuid unique references auth.users(id));
insert into public.staff_pin_secrets(staff_id) select id from public.staff;
alter table public.staff_details enable row level security;alter table public.staff_notes enable row level security;alter table public.staff_day_shifts enable row level security;alter table public.staff_pin_secrets enable row level security;
create policy admin_details on public.staff_details for select to authenticated using(public.is_salon_admin());create policy admin_notes on public.staff_notes for select to authenticated using(public.is_salon_admin());create policy admin_shifts on public.staff_day_shifts for select to authenticated using(public.is_salon_admin());
grant select on public.staff_details,public.staff_notes,public.staff_day_shifts to authenticated;
-- Archive history can be inspected by the admin without exposing archived profiles publicly.
create policy admin_staff_history on public.staff for select to authenticated using(public.is_salon_admin());
create function public.list_admin_staff() returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not public.is_salon_admin() then raise exception 'Admin access required.';end if;
 return coalesce((select jsonb_agg(to_jsonb(s)||to_jsonb(d)||jsonb_build_object('role',p.role,'profile_key',p.profile_key,'pin_set',ps.pin_hash is not null) order by s.active desc,s.name) from public.staff s join public.staff_details d on d.staff_id=s.id left join public.portal_profiles p on p.staff_id=s.id left join public.staff_pin_secrets ps on ps.staff_id=s.id),'[]'::jsonb);end; $$;
create function public.save_admin_staff(p_id integer,p_details jsonb,p_pin text default '',p_revision integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid integer;old public.staff_details;d public.staff_details;s public.staff;kind text;v numeric;pic text;pk text;begin
 if not public.is_salon_admin() then raise exception 'Admin access required.';end if;
 if length(trim(coalesce(p_details->>'first_name','')))=0 then raise exception 'First name is required.';end if;
 if p_pin<>'' and p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be four digits.';end if;
 kind:=p_details->>'employment_type';if kind not in('hourly','salaried','commission') or kind is null then raise exception 'Choose an employment type.';end if;
 v:=nullif(p_details->>case kind when 'hourly' then 'hourly_rate' when 'salaried' then 'salary' else 'commission_rate' end,'')::numeric;
 if v is null or v<0 or v::text in('NaN','Infinity','-Infinity') or(kind='commission' and v>100) then raise exception 'Enter a valid pay rate.';end if;
 if nullif(p_details->>'date_of_birth','')::date>(now() at time zone 'Europe/Dublin')::date then raise exception 'Date of birth cannot be in the future.';end if;
 pic:=nullif(p_details->>'photo_url','');if pic is not null and (length(pic)>300000 or pic !~ '^(https://|\./images/|data:image/(jpeg|png|webp);base64,)') then raise exception 'Choose a supported photo.';end if;
 if p_id is null then
  if p_pin='' then raise exception 'Set a PIN for the new staff member.';end if;
  -- Seeded IDs use explicit integers, so advance safely under a creation lock.
  perform pg_advisory_xact_lock(hashtextextended('staff-create',0));select coalesce(max(id),0)+1 into sid from public.staff;
  insert into public.staff(id,name,active,photo_url) values(sid,trim(p_details->>'first_name')||case when length(trim(coalesce(p_details->>'last_name','')))>0 then ' '||trim(p_details->>'last_name') else '' end,true,pic);
  insert into public.staff_details(staff_id,first_name) values(sid,trim(p_details->>'first_name'));
  pk:='staff-'||gen_random_uuid()::text;insert into public.portal_profiles(profile_key,display_name,role,staff_id,photo_url) values(pk,trim(p_details->>'first_name'),'staff',sid,pic);
  insert into public.staff_pin_secrets(staff_id) values(sid);
  insert into public.weekly_breaks select sid,q.weekday,780,30 from generate_series(0,6) q(weekday);
 else
  sid:=p_id;select * into old from public.staff_details where staff_id=sid for update;select * into s from public.staff where id=sid for update;
  if old.staff_id is null or not s.active then raise exception 'Active staff member not found.';end if;if old.revision<>p_revision then raise exception 'Staff details changed. Reload before saving.';end if;
 end if;
 update public.staff_details set first_name=trim(p_details->>'first_name'),last_name=trim(coalesce(p_details->>'last_name','')),address=coalesce(p_details->>'address',''),date_of_birth=nullif(p_details->>'date_of_birth','')::date,phone=coalesce(p_details->>'phone',''),email=coalesce(p_details->>'email',''),date_hired=nullif(p_details->>'date_hired','')::date,employment_type=kind,salary=case when kind='salaried' then v end,hourly_rate=case when kind='hourly' then v end,commission_rate=case when kind='commission' then v end,revision=revision+1 where staff_id=sid returning * into d;
 update public.staff set name=trim(d.first_name||' '||d.last_name),photo_url=pic where id=sid returning * into s;
 update public.portal_profiles set display_name=s.name,photo_url=pic where staff_id=sid;
 if p_pin<>'' then update public.staff_pin_secrets set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)),failed_attempts=0,locked_until=null where staff_id=sid;end if;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),case when p_id is null then 'staff_created' else 'staff_updated' end,jsonb_build_object('staff_id',sid,'before',to_jsonb(old),'after',to_jsonb(d),'pin_changed',p_pin<>''));
 return to_jsonb(s)||to_jsonb(d)||jsonb_build_object('role',(select role from public.portal_profiles where staff_id=sid),'pin_set',(select pin_hash is not null from public.staff_pin_secrets where staff_id=sid));end; $$;
create function public.archive_admin_staff(p_id integer,p_date_left date,p_reason text,p_revision integer) returns void language plpgsql security definer set search_path='' as $$ declare d public.staff_details;begin
 if not public.is_salon_admin() then raise exception 'Admin access required.';end if;
 select * into d from public.staff_details where staff_id=p_id for update;if d.staff_id is null or d.revision<>p_revision then raise exception 'Staff details changed. Reload before archiving.';end if;
 if exists(select 1 from public.staff_users where user_id=auth.uid() and staff_id=p_id) then raise exception 'You cannot archive your own account.';end if;
 if p_date_left is null or p_date_left>(now() at time zone 'Europe/Dublin')::date or length(trim(coalesce(p_reason,'')))=0 then raise exception 'Date left and archive reason are required; date left cannot be in the future.';end if;
 if exists(select 1 from public.appointments where staff_id=p_id and status in('booked','checked_in') and appointment_date>=(now() at time zone 'Europe/Dublin')::date) then raise exception 'Reassign or cancel open appointments before archiving.';end if;
 if exists(select 1 from public.work_sessions where staff_id=p_id and clocked_out_at is null) then raise exception 'Close the open clock session before archiving.';end if;
 update public.staff_details set date_left=p_date_left,revision=revision+1 where staff_id=p_id;update public.staff set active=false where id=p_id;update public.staff_users set active=false where staff_id=p_id;update public.portal_profiles set active=false where staff_id=p_id;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_archived',jsonb_build_object('staff_id',p_id,'before',to_jsonb(d),'date_left',p_date_left,'reason',trim(p_reason)));end; $$;
create function public.add_staff_note(p_staff_id integer,p_body text) returns public.staff_notes language plpgsql security definer set search_path='' as $$ declare n public.staff_notes;begin
 if not public.is_salon_admin() then raise exception 'Admin access required.';end if;insert into public.staff_notes(staff_id,body,created_by) values(p_staff_id,trim(p_body),auth.uid()) returning * into n;insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_note_added',jsonb_build_object('staff_id',p_staff_id,'note_id',n.id));return n;end; $$;
create function public.remove_staff_note(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ declare n public.staff_notes;begin
 if not public.is_salon_admin() then raise exception 'Admin access required.';end if;update public.staff_notes set removed_at=now(),removed_by=auth.uid() where id=p_id and removed_at is null returning * into n;if n.id is null then raise exception 'Note not found.';end if;insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_note_removed',jsonb_build_object('staff_id',n.staff_id,'note_id',n.id));end; $$;
create function public.save_staff_shifts(p_staff_id integer,p_days jsonb) returns void language plpgsql security definer set search_path='' as $$ declare item jsonb;dt date;st integer;en integer;old public.staff_day_shifts;begin
 if not public.is_salon_admin() then raise exception 'Admin access required.';end if;if not exists(select 1 from public.staff where id=p_staff_id and active) then raise exception 'Active staff member required.';end if;
 if jsonb_array_length(p_days)>14 then raise exception 'Save at most 14 days at a time.';end if;
 for item in select * from jsonb_array_elements(p_days) loop dt:=(item->>'shift_date')::date;st:=(item->>'start_minute')::integer;en:=(item->>'end_minute')::integer;
  if dt is null or dt<(now() at time zone 'Europe/Dublin')::date then raise exception 'Choose today or a future date.';end if;
  perform pg_advisory_xact_lock(p_staff_id,(dt-date '2000-01-01')::integer);select * into old from public.staff_day_shifts where staff_id=p_staff_id and shift_date=dt for update;
  if coalesce(old.revision,0)<>coalesce((item->>'revision')::integer,0) then raise exception 'Shift changed. Reload before saving.';end if;
  if exists(select 1 from public.appointments a where a.staff_id=p_staff_id and a.appointment_date=dt and a.status in('booked','checked_in') and (st is null or en is null or a.start_minute<st or a.start_minute+a.duration>en)) then raise exception 'An open appointment falls outside this shift. Reassign it first.';end if;
  insert into public.staff_day_shifts values(p_staff_id,dt,st,en,1) on conflict(staff_id,shift_date) do update set start_minute=excluded.start_minute,end_minute=excluded.end_minute,revision=public.staff_day_shifts.revision+1;
  insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_shift_changed',jsonb_build_object('staff_id',p_staff_id,'date',dt,'before',to_jsonb(old),'after',item));
 end loop;end; $$;
create function public.save_staff_skills(p_staff_id integer,p_treatment_ids integer[]) returns void language plpgsql security definer set search_path='' as $$ declare old integer[];begin
 if not public.is_salon_admin() then raise exception 'Admin access required.';end if;
 perform 1 from public.staff where id=p_staff_id and active for update;if not found then raise exception 'Active staff member required.';end if;
 if exists(select 1 from unnest(p_treatment_ids) id where not exists(select 1 from public.treatments t where t.id=id and t.active)) then raise exception 'Unknown treatment.';end if;
 select array_agg(treatment_id order by treatment_id) into old from public.staff_treatments where staff_id=p_staff_id;
 delete from public.staff_treatments where staff_id=p_staff_id;insert into public.staff_treatments select p_staff_id,id from(select distinct unnest(p_treatment_ids) id) q;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_treatments_changed',jsonb_build_object('staff_id',p_staff_id,'before',old,'after',p_treatment_ids));end; $$;
alter table public.work_sessions add column revision integer not null default 0,add column corrected_by uuid references auth.users(id),add column correction_reason text;
create function public.correct_staff_clock(p_staff_id integer,p_id uuid,p_in timestamptz,p_out timestamptz,p_reason text,p_revision integer default 0) returns public.work_sessions language plpgsql security definer set search_path='' as $$ declare w public.work_sessions;old public.work_sessions;uid uuid;sname text;begin
 if not public.is_salon_admin() then raise exception 'Admin access required.';end if;
 if p_in is null or p_in>now() or (p_out is not null and(p_out<p_in or p_out>now())) or length(trim(coalesce(p_reason,'')))=0 then raise exception 'Valid past times and a correction reason are required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-clock:'||p_staff_id::text,0));
 if p_id is not null then select * into old from public.work_sessions where id=p_id and staff_id=p_staff_id for update;if old.id is null or old.revision<>p_revision then raise exception 'Clock record changed. Reload before saving.';end if;uid:=old.user_id;
 else select user_id into uid from public.staff_users where staff_id=p_staff_id and active; if uid is null then raise exception 'Staff member needs a linked login account before recording a missed shift.';end if;end if;
 if exists(select 1 from public.work_sessions where staff_id=p_staff_id and (p_id is null or id<>p_id) and tstzrange(clocked_in_at,coalesce(clocked_out_at,'infinity'::timestamptz),'[)') && tstzrange(p_in,coalesce(p_out,'infinity'::timestamptz),'[)')) then raise exception 'Clock times overlap another session.';end if;
 select name into sname from public.staff where id=p_staff_id;
 if p_id is null then insert into public.work_sessions(user_id,staff_id,staff_name,clocked_in_at,clocked_out_at,corrected_by,correction_reason,revision) values(uid,p_staff_id,sname,p_in,p_out,auth.uid(),trim(p_reason),1) returning * into w;
 else update public.work_sessions set clocked_in_at=p_in,clocked_out_at=p_out,corrected_by=auth.uid(),correction_reason=trim(p_reason),revision=revision+1 where id=p_id returning * into w;end if;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_clock_corrected',jsonb_build_object('staff_id',p_staff_id,'before',to_jsonb(old),'after',to_jsonb(w),'reason',trim(p_reason)));return w;end; $$;
-- Only the Edge Function can verify PINs. Five failures lock that profile for 15 minutes.
create function public.verify_staff_pin(p_profile text,p_pin text) returns jsonb language plpgsql security definer set search_path='' as $$ declare ps public.staff_pin_secrets;sid integer;begin
 select p.staff_id into sid from public.portal_profiles p join public.staff s on s.id=p.staff_id and s.active where p.profile_key=p_profile and p.active and p.role in('staff','admin');
 select * into ps from public.staff_pin_secrets where staff_id=sid for update;
 if ps.staff_id is null or ps.pin_hash is null or ps.locked_until>now() then return jsonb_build_object('valid',false);end if;
 if coalesce(p_pin,'') !~ '^[0-9]{4}$' or extensions.crypt(coalesce(p_pin,''),ps.pin_hash)<>ps.pin_hash then
  update public.staff_pin_secrets set failed_attempts=case when locked_until<=now() then 1 else failed_attempts+1 end,locked_until=case when (case when locked_until<=now() then 1 else failed_attempts+1 end)>=5 then now()+interval '15 minutes' else null end where staff_id=sid;return jsonb_build_object('valid',false);end if;
 update public.staff_pin_secrets set failed_attempts=0,locked_until=null where staff_id=sid;
 return jsonb_build_object('valid',true,'staff_id',sid,'user_id',coalesce(ps.managed_user_id,(select user_id from public.staff_users where staff_id=sid and active)));end; $$;
create function public.link_staff_pin_account(p_staff_id integer,p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$ declare p public.portal_profiles;begin
 select * into p from public.portal_profiles where staff_id=p_staff_id and active for update;if p.profile_key is null or not exists(select 1 from public.staff where id=p_staff_id and active) then raise exception 'Active profile required.';end if;
 if exists(select 1 from public.staff_pin_secrets where staff_id=p_staff_id and managed_user_id is not null and managed_user_id<>p_user_id) then raise exception 'Profile already linked.';end if;
 if exists(select 1 from public.staff_users where staff_id=p_staff_id and active and user_id<>p_user_id) then raise exception 'Use the existing linked identity.';end if;
 insert into public.staff_users(user_id,role,staff_id,profile_key,active) values(p_user_id,p.role,p_staff_id,p.profile_key,true) on conflict(user_id) do update set role=excluded.role,staff_id=excluded.staff_id,profile_key=excluded.profile_key,active=true;
 update public.staff_pin_secrets set managed_user_id=p_user_id where staff_id=p_staff_id;end; $$;
revoke all on function public.verify_staff_pin(text,text),public.link_staff_pin_account(integer,uuid) from public;grant execute on function public.verify_staff_pin(text,text),public.link_staff_pin_account(integer,uuid) to service_role;
revoke all on function public.list_admin_staff(),public.save_admin_staff(integer,jsonb,text,integer),public.archive_admin_staff(integer,date,text,integer),public.add_staff_note(integer,text),public.remove_staff_note(uuid),public.save_staff_shifts(integer,jsonb),public.save_staff_skills(integer,integer[]),public.correct_staff_clock(integer,uuid,timestamptz,timestamptz,text,integer) from public;
grant execute on function public.list_admin_staff(),public.save_admin_staff(integer,jsonb,text,integer),public.archive_admin_staff(integer,date,text,integer),public.add_staff_note(integer,text),public.remove_staff_note(uuid),public.save_staff_shifts(integer,jsonb),public.save_staff_skills(integer,integer[]),public.correct_staff_clock(integer,uuid,timestamptz,timestamptz,text,integer) to authenticated;

create or replace function public.get_booking_slots(p_treatment_id integer,p_date date,p_staff_id integer default null,p_exclude_id uuid default null) returns table(start_minute integer,staff_id integer) language plpgsql stable security definer set search_path='' as $$
begin
 if p_exclude_id is not null and (not public.is_salon_staff() or not exists(select 1 from public.appointments where id=p_exclude_id and status in ('booked','checked_in'))) then raise exception 'Staff amendment access required.';end if;
 return query select slot::integer,r.staff_id from (select w.staff_id,w.start_minute,w.end_minute,w.weekday from public.weekly_rotas w where w.weekday=extract(dow from p_date)::integer and not exists(select 1 from public.staff_day_shifts ds where ds.staff_id=w.staff_id and ds.shift_date=p_date)
 union all select ds.staff_id,ds.start_minute,ds.end_minute,extract(dow from p_date)::integer from public.staff_day_shifts ds where ds.shift_date=p_date and ds.start_minute is not null) r
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

create or replace function public.clock_in() returns public.work_sessions language plpgsql security definer set search_path='' as $$
declare w public.work_sessions;sid integer;sname text;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select u.staff_id,s.name into sid,sname from public.staff_users u join public.staff s on s.id=u.staff_id and s.active where u.user_id=auth.uid() and u.active;
 if sid is null then raise exception 'Your account must be mapped to its diary column.';end if;
 perform pg_advisory_xact_lock(hashtextextended('clock:'||auth.uid()::text,0));
 perform pg_advisory_xact_lock(hashtextextended('staff-clock:'||sid::text,0));
 if exists(select 1 from public.work_sessions where user_id=auth.uid() and clocked_out_at is null) then raise exception 'You are already clocked in.';end if;
 insert into public.work_sessions(user_id,staff_id,staff_name) values(auth.uid(),sid,sname) returning * into w;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_clocked_in',jsonb_build_object('session_id',w.id,'staff_id',sid,'clocked_in_at',w.clocked_in_at));return w;
end; $$;
create or replace function public.clock_out() returns public.work_sessions language plpgsql security definer set search_path='' as $$
declare w public.work_sessions;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('clock:'||auth.uid()::text,0));
 perform pg_advisory_xact_lock(hashtextextended('staff-clock:'||(select staff_id from public.staff_users where user_id=auth.uid())::text,0));
 select * into w from public.work_sessions where user_id=auth.uid() and clocked_out_at is null for update;
 if not found then raise exception 'Clock in before clocking out.';end if;
 update public.work_sessions set clocked_out_at=clock_timestamp(),revision=revision+1 where id=w.id returning * into w;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_clocked_out',jsonb_build_object('session_id',w.id,'staff_id',w.staff_id,'clocked_in_at',w.clocked_in_at,'clocked_out_at',w.clocked_out_at));return w;
end; $$;
commit;
