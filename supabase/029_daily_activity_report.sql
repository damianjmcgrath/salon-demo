-- Apply after 028_appointment_reminders.sql.
begin;
create function public.get_daily_activity_report(p_from date,p_to date,p_methods text[] default array['card','cash','voucher','credit']) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_any_permission(array['view.reporting']);
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of up to ten years.';end if;
 if p_methods is null or cardinality(p_methods)=0 or exists(select 1 from unnest(p_methods) m where m is null or m not in('card','cash','voucher','credit')) then raise exception 'Choose valid payment methods.';end if;
 with entries as (
 select a.id appointment_id,a.appointment_date,a.start_minute,coalesce(c.name,a.client_name) client_name,coalesce(c.email,a.attendee_email,'') client_email,
 a.treatment_name,s.name staff_name,coalesce(p.method,case when a.payment_method in('card','cash','voucher','credit') then a.payment_method end,'') method,
 ''::text revolut_id,coalesce(v.code,'') voucher_code,coalesce(p.amount,a.price) amount,coalesce(p.id::text,a.id::text) row_id
 from public.appointments a left join public.clients c on c.id=a.client_id left join public.staff s on s.id=a.staff_id
 left join public.appointment_payments p on p.appointment_id=a.id left join public.client_value_redemptions r on r.id=p.redemption_id left join public.vouchers v on v.id=r.voucher_id
 where a.status='completed' and a.appointment_date between p_from and p_to
 and a.appointment_date+a.start_minute*interval '1 minute' <= now() at time zone 'Europe/Dublin'
 union all
 select a.id,a.appointment_date,a.start_minute,coalesce(c.name,a.client_name),coalesce(c.email,a.attendee_email,''),a.treatment_name||' (NO SHOW)',s.name,'card',coalesce(f.order_id,''),'',f.amount_cents::numeric/100,'no-show-'||a.id::text
 from public.no_show_fees f join public.appointments a on a.id=f.appointment_id left join public.clients c on c.id=a.client_id left join public.staff s on s.id=a.staff_id
 where a.status='no_show' and f.apply_fee and f.state='completed' and a.appointment_date between p_from and p_to
 and a.appointment_date+a.start_minute*interval '1 minute' <= now() at time zone 'Europe/Dublin'
 )
 select coalesce(jsonb_agg(to_jsonb(e) order by appointment_date,start_minute,appointment_id,row_id),'[]'::jsonb) into result from entries e
 where method=any(p_methods) or (method='' and p_methods @> array['card','cash','voucher','credit']);
 return result;
end;$$;
revoke all on function public.get_daily_activity_report(date,date,text[]) from public;
grant execute on function public.get_daily_activity_report(date,date,text[]) to authenticated;
commit;
