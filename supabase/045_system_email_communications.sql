begin;
alter table public.client_communications add column email_source_key text;
create unique index client_communication_email_once on public.client_communications(client_id,email_source_key) where email_source_key is not null;
-- Private helper: only trusted database triggers may create SYSTEM email entries.
create function public.record_system_email_communication(p_client uuid,p_actor uuid,p_key text,p_note text,p_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_client is null or p_actor is null then return;end if;
 insert into public.client_communications(client_id,communication_type,note,staff_name,recorded_by,recorded_at,email_source_key)
 values(p_client,'Email',left(p_note,5000),'SYSTEM',p_actor,coalesce(p_at,now()),p_key)
 on conflict(client_id,email_source_key) where email_source_key is not null do nothing;
end;$$;
revoke all on function public.record_system_email_communication(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
create function public.log_booking_email_communication() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.appointments; label text;
begin
 if new.status<>'accepted' or new.resend_id is null then return new;end if;
 select * into a from public.appointments where id=new.appointment_id;
 label:=case new.event_kind when 'amended' then 'Appointment amendment email' when 'cancelled' then 'Appointment cancellation email' else 'Booking confirmation email' end;
 perform public.record_system_email_communication(a.client_id,a.user_id,'booking-email:'||new.id::text,label||' accepted for sending: '||coalesce(new.snapshot->>'treatment_name',a.treatment_name)||' on '||to_char(coalesce((new.snapshot->>'appointment_date')::date,a.appointment_date),'DD/MM/YYYY')||'. Email reference: '||new.resend_id||'. Test delivery: damianjmcgrath@gmail.com.',coalesce(new.first_attempt_at,now()));
 return new;
end;$$;
create trigger booking_email_communication after insert or update on public.booking_email_queue for each row execute function public.log_booking_email_communication();
create function public.log_voucher_email_communication() returns trigger language plpgsql security definer set search_path='' as $$
declare v public.vouchers; recipient uuid; purchaser uuid; label text;
begin
 if new.status<>'accepted' or new.resend_id is null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('voucher-email-history:'||new.voucher_id::text,0));
 select * into v from public.vouchers where id=new.voucher_id;
 label:=case when exists(select 1 from public.voucher_email_requests r where r.voucher_id=new.voucher_id and r.id<>new.id and r.status='accepted' and ((r.created_at,r.id)<(new.created_at,new.id) or exists(select 1 from public.client_communications c where c.email_source_key='voucher-email:'||r.id::text))) then 'Voucher email re-send' else 'Voucher purchase email' end;
 select c.id into purchaser from public.clients c where c.auth_user_id=v.purchased_by and c.merged_into is null limit 1;
 select c.id into recipient from public.clients c where lower(trim(c.email))=lower(trim(new.requested_email)) and c.merged_into is null limit 1;
 recipient:=coalesce(recipient,v.client_id);
 perform public.record_system_email_communication(recipient,new.created_by,'voucher-email:'||new.id::text,label||' accepted for sending. Voucher: '||v.code||'. Requested recipient: '||new.requested_email||'. Email reference: '||new.resend_id||'. Test delivery: damianjmcgrath@gmail.com.',new.sent_at);
 if purchaser is distinct from recipient then
 perform public.record_system_email_communication(purchaser,new.created_by,'voucher-email:'||new.id::text,label||' accepted for sending. Voucher: '||v.code||'. Requested recipient: '||new.requested_email||'. Email reference: '||new.resend_id||'. Test delivery: damianjmcgrath@gmail.com.',new.sent_at);
 end if;
 return new;
end;$$;
create trigger voucher_email_communication after insert or update on public.voucher_email_requests for each row execute function public.log_voucher_email_communication();
-- Existing accepted messages can be listed without sending another email.
update public.booking_email_queue set status=status where status='accepted';
update public.voucher_email_requests set status=status where status='accepted';
commit;
