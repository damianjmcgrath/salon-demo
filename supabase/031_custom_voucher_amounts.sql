-- Apply after 030_cancel_check_in.sql. Custom-value limits are checked server-side too.
begin;
create or replace function public.purchase_demo_voucher(p_option text,p_treatment_id integer,p_for_self boolean,p_recipient_name text,p_recipient_email text,p_card text,p_ack boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;c public.clients;mail text;rname text;amount numeric;t public.treatments;v public.vouchers;confirmed jsonb;tries integer:=0;begin
 cid:=public.ensure_own_client();select * into c from public.clients where id=cid;select email into mail from auth.users where id=auth.uid();
 if not coalesce(p_ack,false) or p_card is null or p_card not in('saved_demo','new_demo') or p_request is null or p_for_self is null then raise exception 'Choose a demo card and acknowledge this simulated purchase.';end if;
 perform pg_advisory_xact_lock(hashtextextended('voucher-purchase:'||auth.uid()::text||':'||p_request::text,0));
 select confirmation into confirmed from public.demo_voucher_orders where user_id=auth.uid() and request_id=p_request;if confirmed is not null then return confirmed;end if;
 if p_option ~ '^[0-9]+([.][0-9]{1,2})?$' and length(p_option)<=10 then amount:=p_option::numeric;if amount<5 or amount>500 then raise exception 'Enter a voucher amount between €5.00 and €500.00.';end if;elsif p_option='treatment' then select * into t from public.treatments where id=p_treatment_id and active;if t.id is null then raise exception 'Choose an available treatment.';end if;amount:=t.price;else raise exception 'Choose a voucher amount.';end if;
 if amount is null or amount<=0 then raise exception 'Voucher value must be positive.';end if;
 if p_for_self then rname:=c.name;else mail:=lower(trim(coalesce(p_recipient_email,'')));rname:=trim(coalesce(p_recipient_name,''));end if;
 if length(trim(coalesce(rname,'')))=0 or coalesce(mail,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Recipient name and email are required.';end if;
 loop begin
 insert into public.vouchers(code,original_amount,expires_on,client_id,assigned_client_name,recipient_email,purchased_by,treatment_id,demo_purchase,created_by) values('SC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)),amount,((now() at time zone 'Europe/Dublin')::date+interval '5 years')::date,case when p_for_self then cid end,rname,lower(mail),auth.uid(),case when p_option='treatment' then t.id end,true,auth.uid()) returning * into v;exit;
 exception when unique_violation then tries:=tries+1;if tries>5 then raise exception 'Unable to generate a voucher code. Try again.';end if;end;end loop;
 insert into public.voucher_transactions(voucher_id,kind,amount,to_client_id,user_id) values(v.id,'issued',amount,v.client_id,auth.uid());
 confirmed:=to_jsonb(v)||jsonb_build_object('balance',amount,'treatment_name',case when p_option='treatment' then t.name end);
 insert into public.demo_voucher_orders(user_id,request_id,voucher_id,confirmation,card_option) values(auth.uid(),p_request,v.id,confirmed,p_card);
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),cid,'demo_voucher_purchased',jsonb_build_object('voucher_id',v.id,'amount',amount,'recipient_name',rname,'recipient_email',mail,'treatment_id',v.treatment_id,'card_option',p_card,'payment_taken',false));return confirmed;end; $$;
commit;
