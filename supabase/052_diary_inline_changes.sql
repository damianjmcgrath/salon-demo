begin;
create function public.diary_interval_available(p_id uuid,p_staff_id integer,p_treatment integer,p_date date,p_start integer,p_duration integer) returns boolean language sql stable security definer set search_path='' as $$
 select exists (
 select 1 from (select p_id as id,p_treatment as treatment_id,p_date as appointment_date,p_start as start_minute,p_duration as duration) a join public.staff s on s.id=p_staff_id and s.active
 join public.staff_treatments sk on sk.staff_id=s.id and sk.treatment_id=a.treatment_id
 where p_duration>0 and p_start>=540 and p_start+p_duration<=1200
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
revoke all on function public.diary_interval_available(uuid,integer,integer,date,integer,integer) from public,anon,authenticated;
do $$ declare def text; guard text;begin
 def:=pg_get_functiondef('public.amend_appointment(uuid,integer,integer,date,integer,integer,text)'::regprocedure);
 def:=replace(def,'FUNCTION public.amend_appointment(','FUNCTION public.diary_change_appointment(');
 def:=replace(def,E')\n RETURNS',E', p_keep_duration boolean DEFAULT false)\n RETURNS');
 guard:='if not exists(select 1 from public.get_booking_slots(p_treatment_id,p_date,p_staff_id,p_id) where start_minute=p_start) then raise exception ''That time is no longer available.'';end if;';
 if position(guard in def)=0 then raise exception 'Unexpected amendment implementation';end if;
 def:=replace(def,guard,'if not public.diary_interval_available(p_id,p_staff_id,p_treatment_id,p_date,p_start,case when p_keep_duration then old.duration else t.duration end) then raise exception ''That time is no longer available for the selected duration.'';end if;');
 def:=replace(def,'duration=t.duration,','duration=case when p_keep_duration then old.duration else t.duration end,');
 execute def;
end;$$;
revoke all on function public.diary_change_appointment(uuid,integer,integer,date,integer,integer,text,boolean) from public,anon;
grant execute on function public.diary_change_appointment(uuid,integer,integer,date,integer,integer,text,boolean) to authenticated;
commit;
