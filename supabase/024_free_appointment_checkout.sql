-- Apply once after 023. Complete zero-price appointments without recording a payment.
begin;
do $free$ declare def text;marker text;branch text;begin
 select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='checkout_appointment';
 marker:='if p_method is null or p_method not in (''card'',''cash'',''voucher'',''credit'') then raise exception ''Choose a payment method.'';end if;';
 branch:='if a.price=0 then
 if p_method is not null or p_voucher_code is not null or p_credit_note_id is not null or p_remainder_method is not null or p_value_amount is not null then raise exception ''No payment method is needed for a free appointment.'';end if;
 perform pg_advisory_xact_lock(a.staff_id,(a.appointment_date-date ''2000-01-01'')::integer);
 update public.appointments set status=''completed'',completed_at=now(),revision=revision+1,payment_method=null where id=a.id returning * into a;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,''appointment_checked_out'',jsonb_build_object(''payment_method'',null,''payments'',''[]''::jsonb,''free_appointment'',true));
 return a;end if;';
 if position(marker in def)=0 then raise exception 'Expected checkout function was not found.';end if;
 execute replace(def,marker,branch||marker);
end;$free$;
commit;
