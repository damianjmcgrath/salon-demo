begin;
create table public.staff_calendar_entries(id uuid primary key default gen_random_uuid(),staff_id integer not null references public.staff(id),appointment_date date not null,start_minute integer not null,duration integer not null,show_as text not null check(show_as in ('busy','free')),description text not null,revision integer not null default 0,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),check(start_minute>=0 and duration>0 and start_minute+duration<=1440));
alter table public.staff_calendar_entries enable row level security;
create policy calendar_read on public.staff_calendar_entries for select to authenticated using(public.has_permission('view.diary'));
grant select on public.staff_calendar_entries to authenticated;
create function public.save_calendar_entry(p_staff integer,p_date date,p_start integer,p_end integer,p_show text,p_description text,p_id uuid default null,p_revision integer default 0,p_delete boolean default false) returns public.staff_calendar_entries language plpgsql security definer set search_path='' as $$
declare old public.staff_calendar_entries;r public.staff_calendar_entries;begin
 perform public.require_any_permission(array['view.diary']);
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if not public.is_salon_admin() and p_staff is distinct from (select staff_id from public.staff_users where user_id=auth.uid() and active) then raise exception 'You can only edit your own calendar entries.';end if;
 if p_id is not null then select * into old from public.staff_calendar_entries where id=p_id for update;if old.id is null or old.revision<>p_revision then raise exception 'Calendar entry changed. Reload the diary.';end if;
 if not public.is_salon_admin() and old.staff_id is distinct from p_staff then raise exception 'You can only edit your own calendar entries.';end if;end if;
 if p_delete then delete from public.staff_calendar_entries where id=old.id;return old;end if;
 if p_date is null or p_start is null or p_end is null or p_start<0 or p_end>1440 or p_end<=p_start or p_show is null or p_show not in('busy','free') or length(trim(coalesce(p_description,''))) not between 1 and 500 then raise exception 'Enter valid times, Busy/Free and a description (up to 500 characters).';end if;
 if not exists(select 1 from public.staff where id=p_staff and active) then raise exception 'Choose an active staff member.';end if;
 perform pg_advisory_xact_lock(p_staff,(p_date-date '2000-01-01')::integer);
 if p_show='busy' and exists(select 1 from public.appointments a where a.staff_id=p_staff and a.appointment_date=p_date and a.status<>'cancelled' and int4range(a.start_minute,a.start_minute+a.duration,'[)')&&int4range(p_start,p_end,'[)')) then raise exception 'Busy time overlaps an appointment. Choose Free or amend the appointment first.';end if;
 if old.id is null then insert into public.staff_calendar_entries(staff_id,appointment_date,start_minute,duration,show_as,description,created_by) values(p_staff,p_date,p_start,p_end-p_start,p_show,trim(p_description),auth.uid()) returning * into r;
 else update public.staff_calendar_entries set staff_id=p_staff,appointment_date=p_date,start_minute=p_start,duration=p_end-p_start,show_as=p_show,description=trim(p_description),revision=revision+1 where id=old.id returning * into r;end if;
 return r;
end;$$;
revoke all on function public.save_calendar_entry(integer,date,integer,integer,text,text,uuid,integer,boolean) from public;grant execute on function public.save_calendar_entry(integer,date,integer,integer,text,text,uuid,integer,boolean) to authenticated;
alter function public.get_booking_slots(integer,date,integer,uuid) rename to get_booking_slots_before_calendar;
revoke all on function public.get_booking_slots_before_calendar(integer,date,integer,uuid) from public,authenticated,anon;
create function public.get_booking_slots(p_treatment_id integer,p_date date,p_staff_id integer default null,p_exclude_id uuid default null) returns table(start_minute integer,staff_id integer) language sql stable security definer set search_path='' as $$
 select s.* from public.get_booking_slots_before_calendar(p_treatment_id,p_date,p_staff_id,p_exclude_id) s where not exists(select 1 from public.staff_calendar_entries e join public.treatments t on t.id=p_treatment_id where e.staff_id=s.staff_id and e.appointment_date=p_date and e.show_as='busy' and int4range(e.start_minute,e.start_minute+e.duration,'[)')&&int4range(s.start_minute,s.start_minute+t.duration,'[)'));$$;
revoke all on function public.get_booking_slots(integer,date,integer,uuid) from public;grant execute on function public.get_booking_slots(integer,date,integer,uuid) to authenticated,anon;
create function public.guard_calendar_busy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('booked','checked_in') then
 perform pg_advisory_xact_lock(new.staff_id,(new.appointment_date-date '2000-01-01')::integer);
 if exists(select 1 from public.staff_calendar_entries e where e.staff_id=new.staff_id and e.appointment_date=new.appointment_date and e.show_as='busy' and int4range(e.start_minute,e.start_minute+e.duration,'[)')&&int4range(new.start_minute,new.start_minute+new.duration,'[)')) then raise exception 'That time is blocked as Busy.';end if;end if;return new;end;$$;
create trigger calendar_busy_guard before insert or update of staff_id,appointment_date,start_minute,duration,status on public.appointments for each row execute function public.guard_calendar_busy();
commit;
