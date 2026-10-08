-- Apply after 033. Financial reporting uses actual payment/completion timestamps in Dublin time.
begin;
create or replace function public.get_daily_activity_report(p_from date,p_to date,p_methods text[] default array['card','cash','voucher','credit']) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_any_permission(array['view.reporting']);
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of up to ten years.';end if;
 if p_methods is null or cardinality(p_methods)=0 or exists(select 1 from unnest(p_methods) m where m is null or m not in('card','cash','voucher','credit')) then raise exception 'Choose valid payment methods.';end if;
 with entries as (
 select a.id appointment_id,coalesce(p.recorded_at,a.completed_at,(a.appointment_date+a.start_minute*interval '1 minute') at time zone 'Europe/Dublin') at time zone 'Europe/Dublin' activity_at,coalesce(c.name,a.client_name) client_name,coalesce(c.email,a.attendee_email,'') client_email,
 a.treatment_name,s.name staff_name,coalesce(p.method,case when a.payment_method in('card','cash','voucher','credit') then a.payment_method end,'') method,
 ''::text revolut_id,coalesce(v.code,'') voucher_code,coalesce(p.amount,a.price) amount,coalesce(p.id::text,a.id::text) row_id
 from public.appointments a left join public.clients c on c.id=a.client_id left join public.staff s on s.id=a.staff_id
 left join public.appointment_payments p on p.appointment_id=a.id left join public.client_value_redemptions r on r.id=p.redemption_id left join public.vouchers v on v.id=r.voucher_id
 where a.status='completed'
 union all
 select a.id,f.updated_at at time zone 'Europe/Dublin' activity_at,coalesce(c.name,a.client_name),coalesce(c.email,a.attendee_email,''),a.treatment_name||' (NO SHOW)',s.name,'card',coalesce(f.order_id,''),'',f.amount_cents::numeric/100,'no-show-'||a.id::text
 from public.no_show_fees f join public.appointments a on a.id=f.appointment_id left join public.clients c on c.id=a.client_id left join public.staff s on s.id=a.staff_id
 where a.status='no_show' and f.apply_fee and f.state='completed'
 ), dated as (select e.*,activity_at::date appointment_date,extract(hour from activity_at)::int*60+extract(minute from activity_at)::int start_minute from entries e)
 select coalesce(jsonb_agg(to_jsonb(e) order by appointment_date,start_minute,appointment_id,row_id),'[]'::jsonb) into result from dated e
 where activity_at::date between p_from and p_to and (method=any(p_methods) or (method='' and p_methods @> array['card','cash','voucher','credit']));
 return result;
end;$$;
revoke all on function public.get_daily_activity_report(date,date,text[]) from public;
grant execute on function public.get_daily_activity_report(date,date,text[]) to authenticated;
create or replace function public.get_activity_report(p_from date,p_to date,p_period text default 'day')
returns table(period_start date,appointments_scheduled bigint,appointments_completed bigint,card_payments numeric,card_terminal_fee numeric,retained_card_payments numeric,cash_payments numeric,vouchers_used numeric,credit_notes_used numeric,total_payments numeric)
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_any_permission(array['view.reporting']);
 if p_from is null or p_to is null or p_from>p_to or p_period not in ('day','month') or p_period is null then raise exception 'Choose a valid date range and period.';end if;
 if p_to-p_from>3660 then raise exception 'Choose a range of ten years or less.';end if;
 return query
 with periods as (
 select d::date as start from pg_catalog.generate_series(pg_catalog.date_trunc(p_period,p_from::timestamp),pg_catalog.date_trunc(p_period,p_to::timestamp),case when p_period='day' then interval '1 day' else interval '1 month' end) d
 ), payment_rows as (
 select r.appointment_id id,r.appointment_date paid_date,r.method,r.amount from jsonb_to_recordset(public.get_daily_activity_report(case when p_period='month' then date_trunc('month',p_from)::date else p_from end,case when p_period='month' then (date_trunc('month',p_to)+interval '1 month - 1 day')::date else p_to end)) as r(appointment_id uuid,appointment_date date,method text,amount numeric)
 ), totals as (
 select p.start,
 (select count(*) from public.appointments a where a.status<>'cancelled' and a.appointment_date>=p.start and a.appointment_date<(p.start+case when p_period='day' then interval '1 day' else interval '1 month' end)) as scheduled,
 (select count(*) from public.appointments a where a.status='completed' and coalesce((a.completed_at at time zone 'Europe/Dublin')::date,a.appointment_date)>=p.start and coalesce((a.completed_at at time zone 'Europe/Dublin')::date,a.appointment_date)<(p.start+case when p_period='day' then interval '1 day' else interval '1 month' end)) as completed,
 coalesce(sum(a.amount) filter(where a.method='card'),0) as card,
 coalesce(sum(a.amount) filter(where a.method='cash'),0) as cash,
 coalesce(sum(a.amount) filter(where a.method='voucher'),0) as voucher,
 coalesce(sum(a.amount) filter(where a.method='credit'),0) as credit
 from periods p left join payment_rows a on a.paid_date>=p.start and a.paid_date<(p.start+case when p_period='day' then interval '1 day' else interval '1 month' end)
 group by p.start
 )
 select t.start,t.scheduled,t.completed,t.card,round(t.card*0.015,2),t.card-round(t.card*0.015,2),t.cash,t.voucher,t.credit,t.card-round(t.card*0.015,2)+t.cash+t.voucher+t.credit from totals t order by t.start;
end; $$;

commit;
