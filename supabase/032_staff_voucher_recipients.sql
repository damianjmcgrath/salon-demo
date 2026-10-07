-- Apply after 031_custom_voucher_amounts.sql.
begin;
alter table public.vouchers add column recipient_name text;
create function public.create_staff_recipient_voucher(p_amount numeric,p_expires_on date,p_purchaser_name text default null,p_purchaser_email text default null,p_recipient_name text default null,p_recipient_email text default null) returns public.vouchers
language plpgsql security definer set search_path='' as $$
declare v public.vouchers;cid uuid;mail text:=nullif(lower(trim(p_recipient_email)),'');
begin
 perform public.require_any_permission(array['view.vouchers']);
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if length(coalesce(p_recipient_name,''))>200 or length(coalesce(mail,''))>254 or (mail is not null and mail !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'Enter valid recipient details.';end if;
 if mail is not null then select id into cid from public.clients where lower(trim(email))=mail and merged_into is null order by (auth_user_id is not null) desc,created_at limit 1;end if;
 v:=public.create_voucher(p_amount,p_expires_on,cid,p_purchaser_name,p_purchaser_email);
 update public.vouchers set recipient_name=nullif(trim(p_recipient_name),''),recipient_email=mail where id=v.id returning * into v;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),cid,'voucher_recipient_recorded',jsonb_build_object('voucher_id',v.id,'recipient_name',v.recipient_name,'recipient_email',mail,'matched_client_id',cid));
 return v;
end;$$;
revoke all on function public.create_staff_recipient_voucher(numeric,date,text,text,text,text) from public;
grant execute on function public.create_staff_recipient_voucher(numeric,date,text,text,text,text) to authenticated;
commit;
