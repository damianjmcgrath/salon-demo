-- Apply once after 037. Client voucher purchase emails use the existing Resend sender.
begin;
create function public.prepare_client_voucher_email(p_id uuid,p_email text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid;snapshot jsonb;r public.voucher_email_requests;begin
 cid:=public.ensure_own_client();
 if p_request is null or p_email is null or length(trim(p_email))>254 or trim(p_email)!~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid email address.';end if;
 select to_jsonb(v)||jsonb_build_object('balance',(select coalesce(sum(amount),0) from public.voucher_transactions where voucher_id=v.id)-(select coalesce(sum(amount),0) from public.client_value_redemptions where voucher_id=v.id)) into snapshot from public.vouchers v where v.id=p_id and v.purchased_by=auth.uid();
 if snapshot is null then raise exception 'Only vouchers purchased by you can be emailed from this screen.';end if;
 insert into public.voucher_email_requests(id,created_by,voucher_id,requested_email,snapshot) values(p_request,auth.uid(),p_id,lower(trim(p_email)),snapshot) on conflict(id) do nothing;
 select * into r from public.voucher_email_requests where id=p_request;
 if r.created_by<>auth.uid() or r.voucher_id<>p_id or r.requested_email<>lower(trim(p_email)) then raise exception 'Email request changed. Start a new request.';end if;
 return to_jsonb(r);
end;$$;
revoke all on function public.prepare_client_voucher_email(uuid,text,uuid) from public;
grant execute on function public.prepare_client_voucher_email(uuid,text,uuid) to authenticated;
commit;
