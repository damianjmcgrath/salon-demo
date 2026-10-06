-- Apply after 011_client_email_matching.sql. Reporting access is admin/accountant only.
begin;
create or replace function public.get_activity_report(p_from date,p_to date,p_period text default 'day')
returns table(period_start date,appointments_scheduled bigint,appointments_completed bigint,card_payments numeric,card_terminal_fee numeric,retained_card_payments numeric,cash_payments numeric,vouchers_used numeric,credit_notes_used numeric,total_payments numeric)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.staff_users where user_id=auth.uid() and active and role in ('admin','accountant')) then raise exception 'Reporting access required.';end if;
 if p_from is null or p_to is null or p_from>p_to or p_period not in ('day','month') or p_period is null then raise exception 'Choose a valid date range and period.';end if;
 if p_to-p_from>3660 then raise exception 'Choose a range of ten years or less.';end if;
 return query
 with periods as (
 select d::date as start from pg_catalog.generate_series(pg_catalog.date_trunc(p_period,p_from::timestamp),pg_catalog.date_trunc(p_period,p_to::timestamp),case when p_period='day' then interval '1 day' else interval '1 month' end) d
 ), totals as (
 select p.start,
 (select count(*) from public.appointments a where a.status<>'cancelled' and a.appointment_date>=p.start and a.appointment_date<(p.start+case when p_period='day' then interval '1 day' else interval '1 month' end)) as scheduled,
 (select count(*) from public.appointments a where a.status='completed' and a.appointment_date>=p.start and a.appointment_date<(p.start+case when p_period='day' then interval '1 day' else interval '1 month' end)) as completed,
 coalesce(sum(a.price) filter(where a.payment_method='card'),0) as card,
 coalesce(sum(a.price) filter(where a.payment_method='cash'),0) as cash,
 coalesce(sum(a.price) filter(where a.payment_method='voucher'),0) as voucher,
 coalesce(sum(a.price) filter(where a.payment_method='credit'),0) as credit
 from periods p left join public.appointments a on a.status='completed' and coalesce((a.completed_at at time zone 'Europe/Dublin')::date,a.appointment_date)>=p.start and coalesce((a.completed_at at time zone 'Europe/Dublin')::date,a.appointment_date)<(p.start+case when p_period='day' then interval '1 day' else interval '1 month' end)
 group by p.start
 )
 select t.start,t.scheduled,t.completed,t.card,round(t.card*0.015,2),t.card-round(t.card*0.015,2),t.cash,t.voucher,t.credit,t.card-round(t.card*0.015,2)+t.cash+t.voucher+t.credit from totals t order by t.start;
end; $$;
revoke all on function public.get_activity_report(date,date,text) from public;
grant execute on function public.get_activity_report(date,date,text) to authenticated;
commit;
