begin;
-- Original allocation is separate from today's diary allocation and client preference.
alter table public.appointments add column original_staff_id integer references public.staff(id);
update public.appointments set original_staff_id=coalesce(preferred_staff_id,staff_id);
create function public.preserve_original_staff() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then new.original_staff_id:=new.staff_id;
 else new.original_staff_id:=old.original_staff_id; end if;
 return new;
end;$$;
create trigger preserve_original_staff before insert or update on public.appointments for each row execute function public.preserve_original_staff();

-- Exact booked interval: do not substitute today's catalogue duration or exclude
-- a checked-in appointment simply because its scheduled start has passed.
create function public.staff_available_for_transfer(p_id uuid,p_staff_id integer) returns boolean language sql stable security definer set search_path='' as $$
 select exists (
 select 1 from public.appointments a join public.staff s on s.id=p_staff_id and s.active
 join public.staff_treatments sk on sk.staff_id=s.id and sk.treatment_id=coalesce(a.patch_for_treatment_id,a.treatment_id)
 where a.id=p_id and a.status in('booked','checked_in') and a.staff_id<>s.id
 and exists(
  select 1 from public.staff_day_shifts d where d.staff_id=s.id and d.shift_date=a.appointment_date and d.start_minute<=a.start_minute and d.end_minute>=a.start_minute+a.duration
  union all
  select 1 from public.weekly_rotas w where w.staff_id=s.id and w.weekday=extract(dow from a.appointment_date)::integer and w.start_minute<=a.start_minute and w.end_minute>=a.start_minute+a.duration and not exists(select 1 from public.staff_day_shifts d where d.staff_id=s.id and d.shift_date=a.appointment_date)
 )
 and not exists(select 1 from public.weekly_breaks b where b.staff_id=s.id and b.weekday=extract(dow from a.appointment_date)::integer and not exists(select 1 from public.staff_day_breaks d where d.staff_id=s.id and d.appointment_date=a.appointment_date and d.kind='lunch') and int4range(b.start_minute,b.start_minute+b.duration,'[)')&&int4range(a.start_minute,a.start_minute+a.duration,'[)'))
 and not exists(select 1 from public.staff_day_breaks b where b.staff_id=s.id and b.appointment_date=a.appointment_date and int4range(b.start_minute,b.start_minute+b.duration,'[)')&&int4range(a.start_minute,a.start_minute+a.duration,'[)'))
 and not exists(select 1 from public.staff_calendar_entries e where e.staff_id=s.id and e.appointment_date=a.appointment_date and e.show_as='busy' and int4range(e.start_minute,e.start_minute+e.duration,'[)')&&int4range(a.start_minute,a.start_minute+a.duration,'[)'))
 and not exists(select 1 from public.appointments other where other.staff_id=s.id and other.appointment_date=a.appointment_date and other.status<>'cancelled' and other.id<>a.id and int4range(other.start_minute,other.start_minute+other.duration,'[)')&&int4range(a.start_minute,a.start_minute+a.duration,'[)'))
 );
$$;
revoke all on function public.staff_available_for_transfer(uuid,integer) from public,anon,authenticated;
create function public.get_appointment_transfer_options(p_id uuid) returns table(id integer,name text) language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_any_permission(array['view.diary','view.appointments']);
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 return query select s.id,s.name from public.staff s where public.staff_available_for_transfer(p_id,s.id) order by s.name;
end;$$;
create function public.transfer_appointment(p_id uuid,p_staff_id integer,p_revision integer) returns public.appointments language plpgsql security definer set search_path='' as $$
declare old public.appointments; updated public.appointments; day_key integer;
begin
 perform public.require_any_permission(array['view.diary','view.appointments']);
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into old from public.appointments where id=p_id for update;
 if old.id is null or old.status not in('booked','checked_in') then raise exception 'This appointment is no longer available to transfer.';end if;
 if old.revision<>p_revision then raise exception 'This appointment has changed. Reopen it before transferring.';end if;
 if p_staff_id is null or p_staff_id=old.staff_id then raise exception 'Choose a different staff member.';end if;
 day_key:=(old.appointment_date-date '2000-01-01')::integer;
 perform pg_advisory_xact_lock(least(old.staff_id,p_staff_id),day_key);
 perform pg_advisory_xact_lock(greatest(old.staff_id,p_staff_id),day_key);
 if not public.staff_available_for_transfer(p_id,p_staff_id) then raise exception 'That staff member is no longer available at this time. Reopen the appointment to see current options.';end if;
 update public.appointments set staff_id=p_staff_id,revision=revision+1 where id=p_id returning * into updated;
 insert into public.audit_events(user_id,appointment_id,action,details) values(auth.uid(),p_id,'appointment_transferred',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(updated),'reason','Operational staff transfer'));
 return updated;
end;$$;
revoke all on function public.get_appointment_transfer_options(uuid),public.transfer_appointment(uuid,integer,integer) from public,anon;
grant execute on function public.get_appointment_transfer_options(uuid),public.transfer_appointment(uuid,integer,integer) to authenticated;
commit;
