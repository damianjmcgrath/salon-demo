-- Apply once after 024. Reporting permission only; no direct client/financial table grants.
begin;
create function public.get_voucher_status_report() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 perform public.require_any_permission(array['view.reporting']);
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',v.id,'code',v.code,'purchased_at',v.created_at,
 'purchased_by',case when v.purchased_by is null then 'Not recorded' else coalesce(nullif(b.name,''),nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Not recorded') end,
 'purchased_for',coalesce(nullif(v.assigned_client_name,''),c.name,v.recipient_email,'Unassigned'),
 'original_amount',v.original_amount,'redeemed_amount',coalesce(r.redeemed,0),
 'balance',greatest(coalesce(i.issued,v.original_amount)-coalesce(r.redeemed,0),0),
 'expires_on',v.expires_on,'uses',coalesce(r.uses,'[]'::jsonb)
 ) order by v.created_at desc,v.id),'[]'::jsonb) into result
 from public.vouchers v
 left join public.clients b on b.auth_user_id=v.purchased_by and b.merged_into is null
 left join auth.users u on u.id=v.purchased_by
 left join public.clients c on c.id=v.client_id
 left join lateral(select sum(t.amount) issued from public.voucher_transactions t where t.voucher_id=v.id) i on true
 left join lateral(select sum(x.amount) redeemed,jsonb_agg(jsonb_build_object('used_at',x.used_at,'treatment_name',x.treatment_name,'appointment_date',a.appointment_date,'start_minute',a.start_minute,'amount',x.amount) order by x.used_at,x.id) uses from public.client_value_redemptions x join public.appointments a on a.id=x.appointment_id where x.voucher_id=v.id) r on true;
 return result;
end;$$;
revoke all on function public.get_voucher_status_report() from public;
grant execute on function public.get_voucher_status_report() to authenticated;
commit;
