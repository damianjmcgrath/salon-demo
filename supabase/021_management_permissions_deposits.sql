-- Apply once after 020_split_checkout.sql. Defaults preserve existing staff access.
begin;
alter table public.treatments add column description text not null default '',add column revision integer not null default 0;
alter table public.clients add column requires_deposit boolean not null default true;
alter table public.appointments add column guarantee_required boolean not null default true;
create table public.staff_permissions(staff_id integer primary key references public.staff(id),grants jsonb not null default '{}',revision integer not null default 0,updated_by uuid references auth.users(id),updated_at timestamptz not null default now());
alter table public.staff_permissions enable row level security;
revoke all on public.staff_permissions from public,anon,authenticated;
create function public.permission_keys() returns text[] language sql immutable set search_path='' as $$ select array['view.appointments','view.clients','view.diary','view.vouchers','view.staff','view.reporting','view.permissions','view.treatments','perform.own_breaks','perform.discounts','perform.waive_fees','perform.credit_notes']::text[] $$;
revoke all on function public.permission_keys() from public;
create function public.effective_staff_permissions(p_staff integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role_name text;g jsonb;result jsonb:='{}';k text;allowed boolean;begin
 select role into role_name from public.portal_profiles where staff_id=p_staff and active;
 if role_name not in ('admin','staff') or role_name is null then return result;end if;
 select grants into g from public.staff_permissions where staff_id=p_staff;
 foreach k in array public.permission_keys() loop
 allowed:=case when role_name='admin' and k='view.permissions' then true when coalesce(g,'{}') ? k then (g->>k)::boolean else role_name='admin' or k=any(array['view.appointments','view.clients','view.diary','view.vouchers','perform.own_breaks','perform.waive_fees','perform.credit_notes']) end;
 result:=result||jsonb_build_object(k,allowed);
 end loop;return result;end; $$;
revoke all on function public.effective_staff_permissions(integer) from public;
create function public.has_staff_permission(p_user uuid,p_key text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select case when u.role='accountant' then p_key='view.reporting' when u.role in ('staff','admin') then coalesce((public.effective_staff_permissions(u.staff_id)->>p_key)::boolean,false) else false end from public.staff_users u where u.user_id=p_user and u.active),false);
$$;
revoke all on function public.has_staff_permission(uuid,text) from public;
create function public.has_permission(p_key text) returns boolean language sql stable security definer set search_path='' as $$ select public.has_staff_permission(auth.uid(),p_key); $$;
create function public.require_any_permission(p_keys text[]) returns void language plpgsql stable security definer set search_path='' as $$ begin
 if not exists(select 1 from unnest(p_keys) k where public.has_permission(k)) then raise exception 'Permission denied for this feature.';end if;
end; $$;
revoke all on function public.has_permission(text),public.require_any_permission(text[]) from public;
grant execute on function public.has_permission(text),public.require_any_permission(text[]) to authenticated;
create function public.get_my_permissions() returns jsonb language plpgsql stable security definer set search_path='' as $$ declare u public.staff_users;begin
 select * into u from public.staff_users where user_id=auth.uid() and active;
 if u.role='accountant' then return '{"view.reporting":true}'::jsonb;end if;
 if u.role not in ('admin','staff') or u.user_id is null then return '{}'::jsonb;end if;
 return public.effective_staff_permissions(u.staff_id);
end; $$;
create function public.list_staff_permissions() returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform public.require_any_permission(array['view.permissions']);
 return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'role',p.role,'permissions',public.effective_staff_permissions(s.id),'revision',coalesce(g.revision,0)) order by s.name) from public.staff s join public.portal_profiles p on p.staff_id=s.id and p.active left join public.staff_permissions g on g.staff_id=s.id where s.active and p.role in ('staff','admin')),'[]'::jsonb);
end; $$;
create function public.save_staff_permissions(p_staff integer,p_grants jsonb,p_revision integer) returns void language plpgsql security definer set search_path='' as $$ declare old public.staff_permissions;k text;v jsonb;r text;begin
 perform public.require_any_permission(array['view.permissions']);
 perform pg_advisory_xact_lock(741021,p_staff);
 select role into r from public.portal_profiles where staff_id=p_staff and active and role in ('staff','admin');
 if r is null then raise exception 'Select an active staff member.';end if;
 if jsonb_typeof(p_grants) is distinct from 'object' then raise exception 'Invalid permissions.';end if;
 for k,v in select * from jsonb_each(p_grants) loop
 if not k=any(public.permission_keys()) or jsonb_typeof(v)<>'boolean' then raise exception 'Invalid permission key or value.';end if;
 end loop;
 if r='admin' and p_grants->'view.permissions' is distinct from 'true'::jsonb then raise exception 'Admin Permission Management cannot be disabled.';end if;
 select * into old from public.staff_permissions where staff_id=p_staff for update;
 if coalesce(old.revision,0) is distinct from p_revision then raise exception 'Permissions changed. Reload before saving.';end if;
 insert into public.staff_permissions(staff_id,grants,revision,updated_by) values(p_staff,p_grants,1,auth.uid()) on conflict(staff_id) do update set grants=excluded.grants,revision=public.staff_permissions.revision+1,updated_by=auth.uid(),updated_at=now();
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_permissions_updated',jsonb_build_object('staff_id',p_staff,'before',old.grants,'after',p_grants));
end; $$;
revoke all on function public.get_my_permissions(),public.list_staff_permissions(),public.save_staff_permissions(integer,jsonb,integer) from public;
grant execute on function public.get_my_permissions(),public.list_staff_permissions(),public.save_staff_permissions(integer,jsonb,integer) to authenticated;

create function public.save_treatment(p_id integer,p_name text,p_description text,p_duration integer,p_price numeric,p_patch_required boolean,p_revision integer) returns public.treatments language plpgsql security definer set search_path='' as $$ declare old public.treatments;t public.treatments;begin
 perform public.require_any_permission(array['view.treatments']);
 if length(trim(coalesce(p_name,''))) not between 1 and 200 or length(coalesce(p_description,''))>5000 then raise exception 'Enter a treatment name and a description of up to 5000 characters.';end if;
 if p_duration is null or p_duration not between 1 and 720 or p_price is null or p_price<0 or p_price>=1000000 or p_price<>round(p_price,2) or p_patch_required is null then raise exception 'Enter a valid length, price and patch test setting.';end if;
 select * into old from public.treatments where id=p_id for update;
 if old.id is null or old.revision is distinct from p_revision then raise exception 'Treatment changed or was not found. Reload before saving.';end if;
 update public.treatments set name=trim(p_name),description=coalesce(p_description,''),duration=p_duration,price=p_price,patch_required=p_patch_required,revision=revision+1 where id=p_id returning * into t;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'treatment_updated',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(t)));return t;
end; $$;
revoke all on function public.save_treatment(integer,text,text,integer,numeric,boolean,integer) from public;
grant execute on function public.save_treatment(integer,text,text,integer,numeric,boolean,integer) to authenticated;

create function public.update_client_details(p_id uuid,p_name text,p_email text,p_phone text,p_revision integer,p_requires_deposit boolean) returns public.clients language plpgsql security definer set search_path='' as $$ declare c public.clients;before_flag boolean;begin
 perform public.require_any_permission(array['view.clients']);
 if p_requires_deposit is null then raise exception 'Choose Yes or No for Requires Deposit.';end if;
 select requires_deposit into before_flag from public.clients where id=p_id for update;
 c:=public.update_client(p_id,p_name,p_email,p_phone,p_revision);
 update public.clients set requires_deposit=p_requires_deposit where id=c.id returning * into c;
 if before_flag is distinct from p_requires_deposit then insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),c.id,'client_deposit_requirement_updated',jsonb_build_object('before',before_flag,'after',p_requires_deposit));end if;
 return c;
end; $$;
revoke all on function public.update_client_details(uuid,text,text,text,integer,boolean) from public;
grant execute on function public.update_client_details(uuid,text,text,text,integer,boolean) to authenticated;

-- Resolve the attendee's requirement. Unknown people require the normal guarantee.
create function public.booking_requires_guarantee(p_attendee_email text default null,p_client_id uuid default null) returns boolean language plpgsql security definer set search_path='' as $$ declare cid uuid;required boolean;begin
 if public.is_salon_staff() then
 perform public.require_any_permission(array['view.appointments']);cid:=p_client_id;
 else
 cid:=public.ensure_own_client();
 if p_client_id is not null then raise exception 'Clients cannot select another client ID.';end if;
 if nullif(trim(p_attendee_email),'') is not null then select id into cid from public.clients where merged_into is null and lower(trim(email))=lower(trim(p_attendee_email)) order by (auth_user_id is not null) desc,created_at,id limit 1;end if;
 end if;
 select requires_deposit into required from public.clients where id=cid and merged_into is null;
 return coalesce(required,true);
end; $$;
revoke all on function public.booking_requires_guarantee(text,uuid) from public;
grant execute on function public.booking_requires_guarantee(text,uuid) to authenticated;
create or replace function public.book_guaranteed_appointment(p_treatment_id integer,p_staff_id integer,p_date date,p_start integer,p_client_name text,p_phone text,p_booked_for_self boolean,p_attendee_email text,p_guarantee_id uuid,p_consent boolean,p_client_id uuid default null) returns public.appointments language plpgsql security definer set search_path='' as $$
declare g public.booking_guarantee_cards;a public.appointments;cid uuid;required boolean;begin
 if public.is_salon_staff() then cid:=p_client_id;else
 if p_client_id is not null then raise exception 'Client bookings cannot specify another card owner.';end if;cid:=public.ensure_own_client();end if;
 -- Serialize exemption changes with the booking decision for an existing attendee.
 perform 1 from public.clients where id=case when public.is_salon_staff() or p_booked_for_self then cid else (select id from public.clients where merged_into is null and lower(trim(email))=lower(trim(p_attendee_email)) order by (auth_user_id is not null) desc,created_at,id limit 1) end for share;
 required:=public.booking_requires_guarantee(case when p_booked_for_self then null else p_attendee_email end,p_client_id);
 if required then
 if not coalesce(p_consent,false) then raise exception 'Agree to the booking guarantee first.';end if;
 select * into g from public.booking_guarantee_cards where id=p_guarantee_id and client_id=cid and verified_at is not null and environment='sandbox';
 if g.id is null then raise exception 'A verified card belonging to the booking payer is required.';end if;
 end if;
 if public.is_salon_staff() then a:=public.staff_book_appointment(cid,p_treatment_id,p_staff_id,p_date,p_start,'saved_demo',true);
 else a:=public.book_appointment(p_treatment_id,p_staff_id,p_date,p_start,p_client_name,p_phone,true,p_booked_for_self,p_attendee_email,'saved_demo');end if;
 update public.appointments set guarantee_card_id=case when required then g.id else null end,demo_card=null,guarantee_policy_version=case when required then g.policy_version else null end,guarantee_required=required where id=a.id returning * into a;
 update public.booking_email_queue set snapshot=snapshot||jsonb_build_object('guarantee_required',required) where appointment_id=a.id and status='pending' and payload is null;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,case when required then 'booking_guarantee_agreed' else 'booking_guarantee_exempt' end,jsonb_build_object('card_owner_client_id',cid,'card_id',g.id,'policy_version',g.policy_version,'requires_deposit',required,'environment','sandbox'));
 return a;
end; $$;
-- Keep no-show decisions atomic; the general status endpoint cannot bypass them.
alter function public.update_appointment_status(uuid,text,text,integer,text) rename to apply_appointment_status;
revoke all on function public.apply_appointment_status(uuid,text,text,integer,text) from public,anon,authenticated;
create function public.update_appointment_status(p_id uuid,p_status text,p_payment text default null,p_revision integer default null,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.require_any_permission(array['view.appointments','view.diary','view.clients']);
 if p_status='no_show' then raise exception 'Use the no-show fee decision to mark this appointment.';end if;
 perform public.apply_appointment_status(p_id,p_status,p_payment,p_revision,p_reason);
end; $$;
revoke all on function public.update_appointment_status(uuid,text,text,integer,text) from public;
grant execute on function public.update_appointment_status(uuid,text,text,integer,text) to authenticated;
create or replace function public.record_no_show_decision(p_id uuid,p_revision integer,p_apply_fee boolean,p_comments text) returns void language plpgsql security definer set search_path='' as $$ declare a public.appointments;begin
 perform public.require_any_permission(array['view.diary','view.appointments']);
 if p_apply_fee is null or length(trim(coalesce(p_comments,''))) not between 1 and 2000 then raise exception 'Add comments (up to 2000 characters).';end if;
 select * into a from public.appointments where id=p_id for update;
 if not found then raise exception 'Appointment not found.';end if;
 if a.guarantee_required and not p_apply_fee and not public.has_permission('perform.waive_fees') then raise exception 'You do not have permission to waive no-show fees.';end if;
 if not a.guarantee_required and p_apply_fee then raise exception 'This booking is exempt from the card guarantee. No fee can be charged.';end if;
 if exists(select 1 from public.no_show_fees where appointment_id=p_id) then raise exception 'A no-show fee decision has already been recorded.';end if;
 perform public.apply_appointment_status(p_id,'no_show',null,p_revision,trim(p_comments));
 insert into public.no_show_fees(appointment_id,actor_id,apply_fee,comments,state) values(p_id,auth.uid(),p_apply_fee,trim(p_comments),case when p_apply_fee then 'pending' else 'waived' end);
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,p_id,'no_show_fee_decision',jsonb_build_object('apply_fee',p_apply_fee,'comments',trim(p_comments),'guarantee_exempt',not a.guarantee_required,'amount_cents',1000));
end; $$;

do $perm$ declare f record;def text;keys text[];guard text;begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='search_clients' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.clients'',''view.appointments'',''view.vouchers'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='create_client' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.clients'',''view.appointments'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='update_client' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.clients'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='add_client_note' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.clients'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='get_client_activity' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.clients'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='record_client_patch_test' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.clients'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='get_client_values' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.clients'',''view.diary'',''view.appointments'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='create_client_credit_note' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.clients'']);perform public.require_any_permission(array[''perform.credit_notes'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='create_voucher' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.vouchers'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='reassign_voucher' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.vouchers'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='search_vouchers' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.vouchers'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='get_diary_breaks' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.diary'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='save_staff_break' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.diary'']);if p_kind=''break'' and p_id is null and true and not public.has_permission(''perform.own_breaks'') then raise exception ''Permission required to create your own breaks.'';end if;','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='admin_save_staff_break' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.diary'']);if p_kind=''break'' and p_id is null and p_staff_id=(select staff_id from public.staff_users where user_id=auth.uid()) and not public.has_permission(''perform.own_breaks'') then raise exception ''Permission required to create your own breaks.'';end if;','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='staff_book_appointment' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.appointments'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='amend_appointment' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.appointments'',''view.diary'',''view.clients'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='get_checkout_options' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.diary'',''view.appointments'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='checkout_appointment' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.diary'',''view.appointments'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='list_admin_staff' loop
 def:=pg_get_functiondef(f.oid);
 def:=replace(def,'public.is_salon_admin()', 'public.has_permission(''view.staff'')');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.staff'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='save_admin_staff' loop
 def:=pg_get_functiondef(f.oid);
 def:=replace(def,'public.is_salon_admin()', 'public.has_permission(''view.staff'')');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.staff'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='archive_admin_staff' loop
 def:=pg_get_functiondef(f.oid);
 def:=replace(def,'public.is_salon_admin()', 'public.has_permission(''view.staff'')');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.staff'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='add_staff_note' loop
 def:=pg_get_functiondef(f.oid);
 def:=replace(def,'public.is_salon_admin()', 'public.has_permission(''view.staff'')');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.staff'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='remove_staff_note' loop
 def:=pg_get_functiondef(f.oid);
 def:=replace(def,'public.is_salon_admin()', 'public.has_permission(''view.staff'')');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.staff'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='save_staff_shifts' loop
 def:=pg_get_functiondef(f.oid);
 def:=replace(def,'public.is_salon_admin()', 'public.has_permission(''view.staff'')');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.staff'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='save_staff_skills' loop
 def:=pg_get_functiondef(f.oid);
 def:=replace(def,'public.is_salon_admin()', 'public.has_permission(''view.staff'')');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.staff'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='correct_staff_clock' loop
 def:=pg_get_functiondef(f.oid);
 def:=replace(def,'public.is_salon_admin()', 'public.has_permission(''view.staff'')');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.staff'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='get_activity_report' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'if not exists\(select 1 from public.staff_users[^;]*then raise exception ''Reporting access required.'';end if;', 'if not public.has_permission(''view.reporting'') then raise exception ''Reporting access required.'';end if;', 'i');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.reporting'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='report_staff_options' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'if not exists\(select 1 from public.staff_users[^;]*then raise exception ''Reporting access required.'';end if;', 'if not public.has_permission(''view.reporting'') then raise exception ''Reporting access required.'';end if;', 'i');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.reporting'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='get_staff_report' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'if not exists\(select 1 from public.staff_users[^;]*then raise exception ''Reporting access required.'';end if;', 'if not public.has_permission(''view.reporting'') then raise exception ''Reporting access required.'';end if;', 'i');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.reporting'']);','i');execute def;end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname='get_daily_report' loop
 def:=pg_get_functiondef(f.oid);
 def:=regexp_replace(def,'if not exists\(select 1 from public.staff_users[^;]*then raise exception ''Reporting access required.'';end if;', 'if not public.has_permission(''view.reporting'') then raise exception ''Reporting access required.'';end if;', 'i');
 def:=regexp_replace(def,'\mBEGIN\M','begin perform public.require_any_permission(array[''view.reporting'']);','i');execute def;end loop;
end; $perm$;
do $perm$ declare def text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='reserve_client_account';
 def:=replace(def,'declare c public.clients;begin','declare c public.clients;begin if not (public.has_staff_permission(p_actor_id,''view.clients'') or public.has_staff_permission(p_actor_id,''view.appointments'')) then raise exception ''Permission denied for client creation.'';end if;');execute def;
end; $perm$;
drop policy client_read on public.clients;
create policy client_read on public.clients for select to authenticated using(auth_user_id=auth.uid() or public.has_permission('view.clients') or public.has_permission('view.appointments') or public.has_permission('view.diary') or public.has_permission('view.vouchers'));
drop policy client_notes_read on public.client_notes;create policy client_notes_read on public.client_notes for select to authenticated using(public.has_permission('view.clients'));
drop policy day_break_read on public.staff_day_breaks;create policy day_break_read on public.staff_day_breaks for select to authenticated using(public.has_permission('view.diary'));
drop policy voucher_staff_read on public.vouchers;create policy voucher_staff_read on public.vouchers for select to authenticated using(public.has_permission('view.vouchers') or public.has_permission('view.clients') or public.has_permission('view.diary') or public.has_permission('view.appointments'));
drop policy voucher_ledger_staff_read on public.voucher_transactions;create policy voucher_ledger_staff_read on public.voucher_transactions for select to authenticated using(public.has_permission('view.vouchers') or public.has_permission('view.clients') or public.has_permission('view.diary') or public.has_permission('view.appointments'));
drop policy staff_patch_history on public.client_patch_tests;create policy staff_patch_history on public.client_patch_tests for select to authenticated using(public.has_permission('view.clients'));
drop policy staff_credit_read on public.client_credit_notes;create policy staff_credit_read on public.client_credit_notes for select to authenticated using(public.has_permission('view.clients') or public.has_permission('view.diary') or public.has_permission('view.appointments'));
drop policy staff_value_usage_read on public.client_value_redemptions;create policy staff_value_usage_read on public.client_value_redemptions for select to authenticated using(public.has_permission('view.clients') or public.has_permission('view.diary') or public.has_permission('view.appointments'));
drop policy staff_payment_read on public.appointment_payments;create policy staff_payment_read on public.appointment_payments for select to authenticated using(public.has_permission('view.diary') or public.has_permission('view.appointments'));
drop policy admin_details on public.staff_details;create policy admin_details on public.staff_details for select to authenticated using(public.has_permission('view.staff'));
drop policy admin_notes on public.staff_notes;create policy admin_notes on public.staff_notes for select to authenticated using(public.has_permission('view.staff'));
drop policy admin_shifts on public.staff_day_shifts;create policy admin_shifts on public.staff_day_shifts for select to authenticated using(public.has_permission('view.staff'));
drop policy admin_staff_history on public.staff;create policy admin_staff_history on public.staff for select to authenticated using(public.has_permission('view.staff'));
drop policy diary_read on public.appointments;
create policy diary_read on public.appointments for select to authenticated using(
 public.has_permission('view.appointments') or public.has_permission('view.diary') or public.has_permission('view.clients') or
 (not exists(select 1 from public.staff_users where user_id=auth.uid()) and (user_id=auth.uid() or client_id in(select id from public.clients where auth_user_id=auth.uid() and merged_into is null)))
);

-- HR clock details are available through Staff Management; normal users read only their own sessions.
drop policy own_clock_read on public.work_sessions;
create policy own_clock_read on public.work_sessions for select to authenticated using(public.is_salon_staff() and (user_id=auth.uid() or public.has_permission('view.staff')));
-- Audit details are exposed through the scoped report/profile RPCs, not a broad direct query.
revoke select on public.audit_events from authenticated;
commit;
