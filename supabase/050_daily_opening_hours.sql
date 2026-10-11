-- Active salon staff: 09:00 to 20:00 every day, including Sunday.
-- Keep past dated shifts intact for payroll/history.
begin;
insert into public.audit_events(action,details)
select 'staff_hours_updated',jsonb_build_object('staff_id',s.id,'previous_weekly',
(select jsonb_agg(to_jsonb(w)) from public.weekly_rotas w where w.staff_id=s.id),
'previous_dated_shifts',(select jsonb_agg(to_jsonb(d)) from public.staff_day_shifts d where d.staff_id=s.id and d.shift_date >= (now() at time zone 'Europe/Dublin')::date),
'new_start_minute',540,'new_end_minute',1200)
from public.staff s where s.active;
insert into public.weekly_rotas(staff_id,weekday,start_minute,end_minute)
select s.id,d,540,1200 from public.staff s cross join generate_series(0,6) d where s.active
on conflict(staff_id,weekday) do update set start_minute=excluded.start_minute,end_minute=excluded.end_minute;
update public.staff_day_shifts d set start_minute=540,end_minute=1200,revision=d.revision+1
from public.staff s where s.id=d.staff_id and s.active
and d.shift_date >= (now() at time zone 'Europe/Dublin')::date;
commit;
