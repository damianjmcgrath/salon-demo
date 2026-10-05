begin;
create function public.admin_save_staff_break(p_staff_id integer,p_date date,p_start integer,p_end integer,p_kind text,p_id uuid default null,p_revision integer default 0) returns public.staff_day_breaks language plpgsql security definer set search_path='' as $$
declare sid integer;allowed boolean;old public.staff_day_breaks;b public.staff_day_breaks;begin
 if not public.is_salon_admin() then raise exception 'Admin access required.';end if;
 sid:=p_staff_id;
 if not exists(select 1 from public.staff where id=sid and active) then raise exception 'Select an active staff member.';end if;
 if p_kind not in ('lunch','break') or p_kind is null or p_start is null or p_end is null or p_end<=p_start then raise exception 'Choose a valid start and end time.';end if;
 perform pg_advisory_xact_lock(sid,(p_date-date '2000-01-01')::integer);
 if p_id is not null then
 select * into old from public.staff_day_breaks where id=p_id for update;
 if not found or old.staff_id<>sid or old.appointment_date<>p_date or old.kind<>p_kind then raise exception 'Break does not match the selected staff member and date.';end if;
 elsif p_kind='lunch' then
 select * into old from public.staff_day_breaks where staff_id=sid and appointment_date=p_date and kind='lunch' for update;
 end if;
 if coalesce(old.revision,0) is distinct from p_revision then raise exception 'This break changed. Reload the diary.';end if;
 if not (exists(select 1 from public.staff_day_shifts where staff_id=sid and shift_date=p_date and p_start>=start_minute and p_end<=end_minute) or (not exists(select 1 from public.staff_day_shifts where staff_id=sid and shift_date=p_date) and exists(select 1 from public.weekly_rotas where staff_id=sid and weekday=extract(dow from p_date)::integer and p_start>=start_minute and p_end<=end_minute))) then raise exception 'Break must fit inside your working day.';end if;
 if p_date<(now() at time zone 'Europe/Dublin')::date then raise exception 'Past breaks cannot be changed here.';end if;
 if exists(select 1 from public.appointments where staff_id=sid and appointment_date=p_date and status<>'cancelled' and int4range(start_minute,start_minute+duration,'[)') && int4range(p_start,p_end,'[)')) then raise exception 'Break overlaps an appointment.';end if;
 if exists(select 1 from public.staff_day_breaks d where d.staff_id=sid and d.appointment_date=p_date and (old.id is null or d.id<>old.id) and int4range(d.start_minute,d.start_minute+d.duration,'[)') && int4range(p_start,p_end,'[)')) then raise exception 'Break overlaps another break.';end if;
 if p_kind='break' and not exists(select 1 from public.staff_day_breaks where staff_id=sid and appointment_date=p_date and kind='lunch') and exists(select 1 from public.weekly_breaks where staff_id=sid and weekday=extract(dow from p_date)::integer and int4range(start_minute,start_minute+duration,'[)') && int4range(p_start,p_end,'[)')) then raise exception 'Break overlaps lunch.';end if;
 if old.id is null then insert into public.staff_day_breaks(staff_id,appointment_date,kind,start_minute,duration) values(sid,p_date,p_kind,p_start,p_end-p_start) returning * into b;
 else update public.staff_day_breaks set start_minute=p_start,duration=p_end-p_start,revision=revision+1 where id=old.id returning * into b;end if;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'staff_break_saved',jsonb_build_object('before',case when old.id is null and p_kind='lunch' then (select to_jsonb(w) from public.weekly_breaks w where w.staff_id=sid and w.weekday=extract(dow from p_date)::integer limit 1) else to_jsonb(old) end,'after',to_jsonb(b)));
 return b;
end; $$;
revoke all on function public.admin_save_staff_break(integer,date,integer,integer,text,uuid,integer) from public;
grant execute on function public.admin_save_staff_break(integer,date,integer,integer,text,uuid,integer) to authenticated;
commit;
