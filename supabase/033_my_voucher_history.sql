-- Apply after 032_staff_voucher_recipients.sql.
begin;
create function public.get_my_voucher_history() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare own_vouchers jsonb; result jsonb;
begin
 own_vouchers:=public.get_my_vouchers();
 select jsonb_build_object('vouchers',coalesce(jsonb_agg(x.value||jsonb_build_object('purchaser_name',coalesce(nullif(v.purchaser_name,''),nullif(v.purchaser_email,''),'Not recorded'))),'[]'::jsonb),'uses',
 (select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('voucher_code',v.code) order by r.used_at desc),'[]'::jsonb) from public.client_value_redemptions r join public.vouchers v on v.id=r.voucher_id where v.id in(select (value->>'id')::uuid from jsonb_array_elements(own_vouchers)))) into result
 from jsonb_array_elements(own_vouchers) x join public.vouchers v on v.id=(x.value->>'id')::uuid;
 return result;
end;$$;
revoke all on function public.get_my_voucher_history() from public;
grant execute on function public.get_my_voucher_history() to authenticated;
commit;
