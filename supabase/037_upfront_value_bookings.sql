-- Apply once after 036_calendar_entries.sql. Also update the booking confirmation email template; see UPFRONT_VALUE_BOOKINGS_SETUP.md.
begin;
alter table public.appointments add column prepaid_method text check(prepaid_method in ('voucher','credit')),
 add column prepaid_value_id uuid, add column prepaid_voucher_code text, add column prepaid_at timestamptz;
create function public.get_booking_value_options(p_treatment_id integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid;mail text;price numeric;v jsonb;n jsonb;begin
 cid:=public.ensure_own_client();select lower(trim(email)) into mail from public.clients where id=cid;
 select t.price into price from public.treatments t where t.id=p_treatment_id and t.active;
 if price is null then raise exception 'Treatment unavailable.';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v from (
 select v.id,v.code,(select coalesce(sum(t.amount),0) from public.voucher_transactions t where t.voucher_id=v.id)-(select coalesce(sum(r.amount),0) from public.client_value_redemptions r where r.voucher_id=v.id) balance
 from public.vouchers v where v.expires_on>=(now() at time zone 'Europe/Dublin')::date and (v.client_id=cid or (v.client_id is null and lower(trim(v.recipient_email))=mail))
 ) q where q.balance>=price and price>0;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into n from (
 select n.id,n.reason,n.amount-(select coalesce(sum(r.amount),0) from public.client_value_redemptions r where r.credit_note_id=n.id) balance from public.client_credit_notes n where n.client_id=cid
 ) q where q.balance>=price and price>0;
 return jsonb_build_object('vouchers',v,'credit_notes',n);
end;$$;
-- Clone the current booking checks, including patch routing and calendar availability.
-- The prepaid entry point validates ownership, locks the value, and redeems atomically.
do $migration$ declare def text;marker text;validation text;payment text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='book_guaranteed_appointment';
 def:=replace(def,'FUNCTION public.book_guaranteed_appointment(','FUNCTION public.book_with_value(');
 def:=replace(def,E')\n RETURNS',E', p_value_method text DEFAULT NULL, p_value_id uuid DEFAULT NULL)\n RETURNS');
 if position('p_value_method text' in def)=0 then raise exception 'Unexpected booking function signature.';end if;
 def:=replace(def,'original public.treatments;','original public.treatments;v public.vouchers;n public.client_credit_notes;balance numeric;price numeric;rid uuid;mail text;');
 marker:='begin p_attendee_email:=lower(trim(p_attendee_email));';
 validation:='begin
 cid:=public.ensure_own_client();
 if p_client_id is not null or p_value_method is null or p_value_method not in (''voucher'',''credit'') or p_value_id is null then raise exception ''Choose a voucher or credit note belonging to your account.'';end if;
 select lower(trim(email)) into mail from public.clients where id=cid;
 select t.price into price from public.treatments t where t.id=p_treatment_id and t.active for share;
 if price is null or price<=0 then raise exception ''No upfront payment is needed for a free treatment.'';end if;
 if p_value_method=''voucher'' then
 select * into v from public.vouchers where id=p_value_id for update;
 if v.id is null or not coalesce((v.client_id=cid or (v.client_id is null and lower(trim(v.recipient_email))=mail)),false) or v.expires_on<(now() at time zone ''Europe/Dublin'')::date then raise exception ''Choose a valid voucher belonging to your account.'';end if;
 select (select coalesce(sum(t.amount),0) from public.voucher_transactions t where t.voucher_id=v.id)-(select coalesce(sum(r.amount),0) from public.client_value_redemptions r where r.voucher_id=v.id) into balance;
 else
 select * into n from public.client_credit_notes where id=p_value_id for update;
 if n.id is null or n.client_id<>cid then raise exception ''Choose a credit note belonging to your account.'';end if;
 select n.amount-coalesce(sum(r.amount),0) into balance from public.client_value_redemptions r where r.credit_note_id=n.id;
 end if;
 if balance<price then raise exception ''The balance no longer covers this treatment. Choose another payment option.'';end if;
 p_attendee_email:=lower(trim(p_attendee_email));';
 if position(marker in def)=0 then raise exception 'Unexpected booking body.';end if;
 def:=replace(def,marker,validation);
 marker:='required:=public.booking_requires_guarantee(case when p_booked_for_self then null else p_attendee_email end,p_client_id,p_treatment_id);';
 if position(marker in def)=0 then raise exception 'Unexpected booking guarantee check.';end if;
 def:=replace(def,marker,'required:=false;');
 payment:='if a.price<>price then raise exception ''Treatment price changed. Review your booking.'';end if;
 insert into public.client_value_redemptions(client_id,voucher_id,credit_note_id,appointment_id,amount,treatment_name,staff_name,recorded_by)
 values(cid,v.id,n.id,a.id,a.price,a.treatment_name,(select name from public.staff where id=a.staff_id),auth.uid()) returning id into rid;
 insert into public.appointment_payments(appointment_id,method,amount,redemption_id,recorded_by) values(a.id,p_value_method,a.price,rid,auth.uid());
 if v.id is not null then update public.vouchers set revision=revision+1 where id=v.id;end if;
 update public.appointments set prepaid_method=p_value_method,prepaid_value_id=p_value_id,prepaid_voucher_code=v.code,prepaid_at=now(),payment_method=p_value_method where id=a.id returning * into a;
 update public.booking_email_queue set snapshot=snapshot||jsonb_build_object(''prepaid_method'',p_value_method,''prepaid_voucher_code'',v.code) where appointment_id=a.id and status=''pending'' and payload is null;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,''booking_paid_upfront'',jsonb_build_object(''method'',p_value_method,''value_id'',p_value_id,''voucher_code'',v.code,''amount'',a.price,''payer_client_id'',cid));
 return a;';
 def:=replace(def,'return a;',payment);execute def;
end;$migration$;
revoke all on function public.get_booking_value_options(integer),public.book_with_value(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,text,uuid) from public;
grant execute on function public.get_booking_value_options(integer),public.book_with_value(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,text,uuid) to authenticated;
-- Preserve the recorded payment when checking in, amending, or cancelling.
create function public.guard_prepaid_appointment() returns trigger language plpgsql set search_path='' as $$ begin
 if old.prepaid_method is not null then
 if new.price<>old.price then raise exception 'An upfront-paid appointment cannot change price. Resolve its payment before changing the treatment cost.';end if;
 new.payment_method:=old.prepaid_method;
 end if;return new;
end;$$;
create trigger prepaid_appointment_guard before update on public.appointments for each row execute function public.guard_prepaid_appointment();
-- Checkout completes the treatment without another redemption or payment.
do $checkout$ declare def text;marker text;branch text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='checkout_appointment';
 marker:='if a.price=0 then';
 branch:='if a.prepaid_method is not null then
 if p_method is not null or p_voucher_code is not null or p_credit_note_id is not null or p_remainder_method is not null or p_value_amount is not null then raise exception ''This appointment has already been paid. No further payment is required.'';end if;
 if (select coalesce(sum(amount),0) from public.appointment_payments where appointment_id=a.id)<>a.price then raise exception ''Upfront payment needs review.'';end if;
 update public.appointments set status=''completed'',completed_at=now(),revision=revision+1 where id=a.id returning * into a;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,''appointment_checked_out'',jsonb_build_object(''already_paid'',true,''payment_method'',a.prepaid_method,''voucher_code'',a.prepaid_voucher_code));
 return a;end if;';
 if position(marker in def)=0 then raise exception 'Unexpected checkout function.';end if;
 execute replace(def,marker,branch||marker);
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='get_daily_activity_report';
 def:=replace(def,'where a.status=''completed''','where (a.status=''completed'' or a.prepaid_method is not null)');execute def;
end;$checkout$;
commit;
