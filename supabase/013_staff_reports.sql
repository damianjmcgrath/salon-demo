-- Apply after 012_activity_reports.sql. All times use Europe/Dublin.
begin;
create or replace function public.report_staff_options() returns table(id integer,name text,active boolean)
language plpgsql stable security definer set search_path='' as $$ begin
 if not exists(select 1 from public.staff_users u where u.user_id=auth.uid() and u.active and u.role in ('admin','accountant')) then raise exception 'Reporting access required.';end if;
 return query select s.id,s.name,s.active from public.staff s join public.staff_details d on d.staff_id=s.id order by s.name;
end; $$;
create or replace function public.staff_report_days(p_staff integer,p_from date,p_to date)
returns table(day date,first_clock_in timestamptz,expected_start integer,start_difference numeric,last_clock_out timestamptz,expected_end integer,end_difference numeric,worked_minutes numeric,scheduled_minutes integer,open_sessions bigint,notes text)
language sql stable security definer set search_path='' as $$
 with days as (select d::date as day from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d),
 data as (
 select d.day,case when ds.staff_id is not null then ds.start_minute else wr.start_minute end st,case when ds.staff_id is not null then ds.end_minute else wr.end_minute end en,
 (select min(w.clocked_in_at) from public.work_sessions w where w.staff_id=p_staff and (w.clocked_in_at at time zone 'Europe/Dublin')::date=d.day) first_in,
 (select w.clocked_out_at from public.work_sessions w where w.staff_id=p_staff and (w.clocked_in_at at time zone 'Europe/Dublin')::date=d.day order by w.clocked_in_at desc,w.id desc limit 1) last_out,
 (select coalesce(sum(extract(epoch from least(w.clocked_out_at,((d.day+1)::timestamp at time zone 'Europe/Dublin'))-greatest(w.clocked_in_at,(d.day::timestamp at time zone 'Europe/Dublin')))/60),0) from public.work_sessions w where w.staff_id=p_staff and w.clocked_out_at is not null and w.clocked_in_at<((d.day+1)::timestamp at time zone 'Europe/Dublin') and w.clocked_out_at>(d.day::timestamp at time zone 'Europe/Dublin')) worked,
 (select count(*) from public.work_sessions w where w.staff_id=p_staff and w.clocked_out_at is null and (w.clocked_in_at at time zone 'Europe/Dublin')::date=d.day) unfinished,
 (select string_agg(n.body||case when n.removed_at is not null then ' [removed]' else '' end,E'\n\n' order by n.created_at,n.id) from public.staff_notes n where n.staff_id=p_staff and (n.created_at at time zone 'Europe/Dublin')::date=d.day) note
 from days d left join public.staff_day_shifts ds on ds.staff_id=p_staff and ds.shift_date=d.day left join public.weekly_rotas wr on wr.staff_id=p_staff and wr.weekday=extract(dow from d.day)::integer
 ) select d.day,d.first_in,d.st,extract(epoch from d.first_in-((d.day::timestamp+make_interval(mins=>d.st)) at time zone 'Europe/Dublin'))/60,d.last_out,d.en,extract(epoch from d.last_out-((d.day::timestamp+make_interval(mins=>d.en)) at time zone 'Europe/Dublin'))/60,d.worked,coalesce(d.en-d.st,0),d.unfinished,d.note from data d order by d.day;
$$;
revoke all on function public.staff_report_days(integer,date,date) from public;
create or replace function public.get_staff_report(p_kind text,p_staff integer default null,p_from date default null,p_to date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;lo date;hi date;begin
 if not exists(select 1 from public.staff_users u where u.user_id=auth.uid() and u.active and u.role in ('admin','accountant')) then raise exception 'Reporting access required.';end if;
 if p_kind is null or p_kind not in ('clock','payroll','hr') then raise exception 'Choose a valid report.';end if;
 if p_kind<>'payroll' and not exists(select 1 from public.staff_details where staff_id=p_staff) then raise exception 'Choose a staff member.';end if;
 if p_kind='hr' then
 select min(x.day),max(x.day) into lo,hi from (
 select (w.clocked_in_at at time zone 'Europe/Dublin')::date as day from public.work_sessions w where w.staff_id=p_staff
 union all select (n.created_at at time zone 'Europe/Dublin')::date from public.staff_notes n where n.staff_id=p_staff) x;
 if lo is null then return '[]'::jsonb;end if;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.day),'[]'::jsonb) into result from public.staff_report_days(p_staff,lo,hi) d where d.notes is not null or abs(d.start_difference)>15 or abs(d.end_difference)>15;
 else
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of ten years or less.';end if;
 if p_kind='clock' then select coalesce(jsonb_agg(to_jsonb(d) order by d.day),'[]'::jsonb) into result from public.staff_report_days(p_staff,p_from,p_to) d;
 else
 select coalesce(jsonb_agg(to_jsonb(q) order by q.name),'[]'::jsonb) into result from (
 select s.id,s.name,s.active,sd.employment_type,sd.hourly_rate,sum(d.scheduled_minutes) expected_minutes,sum(d.worked_minutes) actual_minutes,sum(d.open_sessions) open_sessions,
 case when sd.employment_type='hourly' and sd.hourly_rate is not null then round(sum(d.worked_minutes)/60*sd.hourly_rate,2) else null end total_pay
 from public.staff s join public.staff_details sd on sd.staff_id=s.id cross join lateral public.staff_report_days(s.id,p_from,p_to) d group by s.id,s.name,s.active,sd.employment_type,sd.hourly_rate
 ) q;
 end if;
 end if;
 return result;
end; $$;
revoke all on function public.report_staff_options(),public.get_staff_report(text,integer,date,date) from public;
grant execute on function public.report_staff_options(),public.get_staff_report(text,integer,date,date) to authenticated;
commit;
