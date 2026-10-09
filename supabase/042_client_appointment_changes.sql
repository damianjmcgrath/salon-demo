-- Apply once after 041.
begin;
alter table public.clients add column can_amend_anytime boolean not null default false,add column can_cancel_free boolean not null default false;
update public.clients set can_amend_anytime=true,can_cancel_free=true where not requires_deposit;
create function public.sync_client_appointment_permissions() returns trigger language plpgsql set search_path='' as $$ begin if not new.requires_deposit then new.can_amend_anytime:=true;new.can_cancel_free:=true;end if;return new;end;$$;
create trigger sync_client_appointment_permissions before insert or update on public.clients for each row execute function public.sync_client_appointment_permissions();
alter table public.no_show_fees add column purpose text not null default 'no_show' check(purpose in('no_show','cancellation'));

create function public.client_appointment_policy(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.appointments;c public.clients;begin
 if auth.uid() is null or public.is_salon_staff() or exists(select 1 from public.staff_users where user_id=auth.uid()) then raise exception 'Client sign-in required.';end if;
 select * into c from public.clients where auth_user_id=auth.uid() and merged_into is null;
 select * into a from public.appointments where id=p_id;
 if c.id is null or a.id is null or not coalesce(a.user_id=auth.uid() or a.client_id=c.id,false) then raise exception 'Appointment access denied.';end if;
 return jsonb_build_object('can_manage',a.status='booked' and a.appointment_date+make_interval(mins=>a.start_minute)>now() at time zone 'Europe/Dublin','can_amend_anytime',c.can_amend_anytime,'same_date_only',not c.can_amend_anytime and a.appointment_date+make_interval(mins=>a.start_minute)<= (now() at time zone 'Europe/Dublin')+interval '3 days',
 'cancel_free',c.can_cancel_free or not a.guarantee_required or a.prepaid_method is not null or not exists(select 1 from public.booking_guarantee_cards g where g.id=a.guarantee_card_id and g.verified_at is not null),'fee_cents',a.guarantee_fee_cents);
end;$$;
revoke all on function public.client_appointment_policy(uuid) from public;
grant execute on function public.client_appointment_policy(uuid) to authenticated;

-- Permit availability exclusion only for an authorized open appointment.
do $$ declare def text;oldguard text;begin
 def:=pg_get_functiondef('public.get_booking_slots_before_calendar(integer,date,integer,uuid)'::regprocedure);
 oldguard:='if p_exclude_id is not null and (not public.is_salon_staff() or not exists(select 1 from public.appointments where id=p_exclude_id and status in (''booked'',''checked_in''))) then raise exception ''Staff amendment access required.'';end if;';
 if position(oldguard in def)=0 then raise exception 'Availability definition changed. Migration stopped.';end if;
 def:=replace(def,oldguard,'if p_exclude_id is not null then if public.is_salon_staff() then if not exists(select 1 from public.appointments where id=p_exclude_id and status in (''booked'',''checked_in'')) then raise exception ''Appointment unavailable.'';end if;else if not coalesce((public.client_appointment_policy(p_exclude_id)->>''can_manage'')::boolean,false) then raise exception ''Appointment unavailable.'';end if;end if;end if;');
 def:=replace(def,'t.duration','(case when p_exclude_id is not null and not public.is_salon_staff() then (select duration from public.appointments where id=p_exclude_id) else t.duration end)');execute def;
 def:=pg_get_functiondef('public.get_booking_slots(integer,date,integer,uuid)'::regprocedure);
 def:=replace(def,'s.start_minute+t.duration','s.start_minute+(case when p_exclude_id is not null and not public.is_salon_staff() then (select duration from public.appointments where id=p_exclude_id) else t.duration end)');execute def;
end;$$;

-- Clone staff amendment validation, then constrain clients to date/time only.
do $$ declare def text;begin
 def:=pg_get_functiondef('public.amend_appointment(uuid,integer,integer,date,integer,integer,text)'::regprocedure);
 def:=replace(def,'public.amend_appointment(','public.client_amend_appointment(');
 def:=regexp_replace(def,'perform public.require_any_permission\(array\[[^;]+\);','','g');
 def:=replace(def,'if not public.is_salon_staff() then raise exception ''Staff access required.'';end if;','');
 def:=replace(def,'select * into old from public.appointments where id=p_id for update;','select * into old from public.appointments where id=p_id for update; if not coalesce((public.client_appointment_policy(p_id)->>''can_manage'')::boolean,false) then raise exception ''This appointment can no longer be amended online.'';end if; if p_treatment_id<>old.treatment_id or p_staff_id<>old.staff_id then raise exception ''Online amendments change the date/time only.'';end if; if (public.client_appointment_policy(p_id)->>''same_date_only'')::boolean and p_date<>old.appointment_date then raise exception ''Within three days you can only change the time on the same date.'';end if;');
 def:=replace(def,'duration=t.duration','duration=old.duration');
 def:=replace(def,'treatment_name=case when old.patch_for_treatment_id is not null and old.treatment_id=t.id then old.treatment_name else t.name end','treatment_name=old.treatment_name');execute def;
end;$$;
revoke all on function public.client_amend_appointment(uuid,integer,integer,date,integer,integer,text) from public;
grant execute on function public.client_amend_appointment(uuid,integer,integer,date,integer,integer,text) to authenticated;

create function public.client_cancel_appointment(p_id uuid,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.appointments;policy jsonb;free boolean;begin
 select * into a from public.appointments where id=p_id for update;
 policy:=public.client_appointment_policy(p_id);
 if not (policy->>'can_manage')::boolean then raise exception 'This appointment can no longer be cancelled online.';end if;
 if a.revision is distinct from p_revision then raise exception 'Appointment changed. Reload before cancelling.';end if;
 free:=(policy->>'cancel_free')::boolean;
 perform pg_advisory_xact_lock(a.staff_id,(a.appointment_date-date '2000-01-01')::integer);
 update public.appointments set status='cancelled',revision=revision+1 where id=p_id;
 insert into public.no_show_fees(appointment_id,actor_id,apply_fee,comments,state,purpose) values(p_id,auth.uid(),not free,'Client confirmed online cancellation',case when free then 'waived' else 'pending' end,'cancellation');
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,p_id,'client_cancelled_appointment',jsonb_build_object('before',to_jsonb(a),'fee_waived',free,'amount_cents',case when free then 0 else a.guarantee_fee_cents end));
 return jsonb_build_object('cancelled',true,'fee_required',not free,'amount_cents',case when free then 0 else a.guarantee_fee_cents end);
end;$$;
revoke all on function public.client_cancel_appointment(uuid,integer) from public;
grant execute on function public.client_cancel_appointment(uuid,integer) to authenticated;

-- Staff-only profile edits retain validation, revision checks and an audit.
alter function public.update_client_details(uuid,text,text,text,integer,boolean) rename to update_client_details_before_policy;
revoke all on function public.update_client_details_before_policy(uuid,text,text,text,integer,boolean) from public,authenticated,anon;
create function public.update_client_details(p_id uuid,p_name text,p_email text,p_phone text,p_revision integer,p_requires_deposit boolean,p_can_amend_anytime boolean default false,p_can_cancel_free boolean default false) returns public.clients language plpgsql security definer set search_path='' as $$
declare c public.clients;old public.clients;begin
 perform public.require_any_permission(array['view.clients']);
 if p_can_amend_anytime is null or p_can_cancel_free is null then raise exception 'Choose Yes or No for appointment permissions.';end if;
 select * into old from public.clients where id=p_id for update;
 c:=public.update_client_details_before_policy(p_id,p_name,p_email,p_phone,p_revision,p_requires_deposit);
 update public.clients set can_amend_anytime=p_can_amend_anytime,can_cancel_free=p_can_cancel_free where id=p_id returning * into c;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),p_id,'client_appointment_permissions_updated',jsonb_build_object('before',jsonb_build_object('can_amend_anytime',old.can_amend_anytime,'can_cancel_free',old.can_cancel_free),'after',jsonb_build_object('can_amend_anytime',c.can_amend_anytime,'can_cancel_free',c.can_cancel_free)));
 return c;end;$$;
revoke all on function public.update_client_details(uuid,text,text,text,integer,boolean,boolean,boolean) from public;
grant execute on function public.update_client_details(uuid,text,text,text,integer,boolean,boolean,boolean) to authenticated;

-- Cancellation fees join the same actual-payment reporting ledger.
do $$ declare def text;begin
 def:=pg_get_functiondef('public.get_daily_activity_report(date,date,text[])'::regprocedure);
 def:=replace(def,'a.treatment_name||'' (NO SHOW)''','a.treatment_name||case when a.status=''cancelled'' then '' (CANCELLED)'' else '' (NO SHOW)'' end');
 def:=replace(def,'a.status=''no_show'' and f.apply_fee','a.status in(''no_show'',''cancelled'') and f.apply_fee');execute def;
end;$$;
commit;
