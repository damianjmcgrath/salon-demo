-- Apply once after 038. Codes transfer the remaining balance; purchases remain demo payments.
begin;
-- Install the current numeric amount validation even when 031 was missed.
create or replace function public.purchase_demo_voucher(p_option text,p_treatment_id integer,p_for_self boolean,p_recipient_name text,p_recipient_email text,p_card text,p_ack boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;c public.clients;mail text;rname text;amount numeric;t public.treatments;v public.vouchers;confirmed jsonb;tries integer:=0;begin
 p_for_self:=true; cid:=public.ensure_own_client();select * into c from public.clients where id=cid;select email into mail from auth.users where id=auth.uid();
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

-- Private helper shared by client claims, staff reassignments and checkout.
create function public.transfer_voucher_owner(p_id uuid,p_client uuid) returns public.vouchers
language plpgsql security definer set search_path='' as $$
declare old public.vouchers;v public.vouchers;c public.clients;remaining numeric;begin
 select * into old from public.vouchers where id=p_id for update;
 select * into c from public.clients where id=p_client and merged_into is null;
 if old.id is null or c.id is null then raise exception 'Voucher or client not found.';end if;
 if old.expires_on<(now() at time zone 'Europe/Dublin')::date then raise exception 'This voucher has expired.';end if;
 select (select coalesce(sum(amount),0) from public.voucher_transactions where voucher_id=p_id)-(select coalesce(sum(amount),0) from public.client_value_redemptions where voucher_id=p_id) into remaining;
 if remaining<=0 then raise exception 'This voucher has no remaining value.';end if;
 if old.client_id=p_client then return old;end if;
 update public.vouchers set client_id=c.id,assigned_client_name=c.name,recipient_name=c.name,recipient_email=c.email,revision=revision+1 where id=p_id returning * into v;
 insert into public.voucher_transactions(voucher_id,kind,amount,from_client_id,to_client_id,user_id) values(v.id,case when old.client_id is null then 'assigned' else 'reassigned' end,0,old.client_id,c.id,auth.uid());
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),c.id,'voucher_transferred',jsonb_build_object('voucher_id',v.id,'voucher_code',v.code,'from_client_id',old.client_id,'to_client_id',c.id,'from_name',old.assigned_client_name,'to_name',c.name,'remaining_amount',remaining));
 return v;end;$$;
revoke all on function public.transfer_voucher_owner(uuid,uuid) from public,anon,authenticated;

create function public.claim_my_voucher(p_code text) returns public.vouchers
language plpgsql security definer set search_path='' as $$
declare cid uuid;vid uuid;begin
 cid:=public.ensure_own_client();
 if length(coalesce(p_code,''))>100 or length(regexp_replace(upper(coalesce(p_code,'')),'[^A-Z0-9]','','g'))<12 then raise exception 'Enter a valid voucher code.';end if;
 select id into vid from public.vouchers where regexp_replace(upper(code),'[^A-Z0-9]','','g')=regexp_replace(upper(p_code),'[^A-Z0-9]','','g');
 if vid is null then raise exception 'Voucher not found. Check the code and try again.';end if;
 return public.transfer_voucher_owner(vid,cid);
end;$$;
revoke all on function public.claim_my_voucher(text) from public;
grant execute on function public.claim_my_voucher(text) to authenticated;

create function public.claim_checkout_voucher(p_id uuid,p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.appointments;opts jsonb;begin
 perform public.require_any_permission(array['view.diary','view.appointments']);
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into a from public.appointments where id=p_id for update;
 if a.id is null or a.status<>'checked_in' or a.client_id is null then raise exception 'Choose a checked-in appointment linked to a client.';end if;
 if trim(coalesce(p_code,''))='' then raise exception 'Enter a voucher code.';end if;
 opts:=public.get_checkout_options(p_id,p_code);
 perform public.transfer_voucher_owner((opts->'found_voucher'->>'id')::uuid,a.client_id);
 return public.get_checkout_options(p_id,p_code);
end;$$;
revoke all on function public.claim_checkout_voucher(uuid,text) from public;
grant execute on function public.claim_checkout_voucher(uuid,text) to authenticated;

-- Transfer atomically with redemption too (protects stale selections).
do $$ declare def text;begin
 def:=pg_get_functiondef('public.checkout_appointment(uuid,integer,text,text,uuid,text,numeric)'::regprocedure);
 if position(' select name into therapist from public.staff where id=a.staff_id;' in def)=0 then raise exception 'Checkout definition changed. Migration stopped.';end if;
 def:=replace(def,' select name into therapist from public.staff where id=a.staff_id;',' if v.id is not null then perform public.transfer_voucher_owner(v.id,a.client_id);end if; select name into therapist from public.staff where id=a.staff_id;');execute def;
end;$$;

create or replace function public.get_my_voucher_history() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cid uuid;own_vouchers jsonb;begin
 -- get_my_vouchers already restricts clients to verified ownership/email.
 own_vouchers:=public.get_my_vouchers();select id into cid from public.clients where auth_user_id=auth.uid() and merged_into is null;
 return jsonb_build_object('vouchers',(select coalesce(jsonb_agg(x.value||jsonb_build_object('purchaser_name',coalesce(v.purchaser_name,v.purchaser_email,'Not recorded'))),'[]'::jsonb) from jsonb_array_elements(own_vouchers) x join public.vouchers v on v.id=(x.value->>'id')::uuid),
 'uses',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('voucher_code',v.code) order by r.used_at desc),'[]'::jsonb) from public.client_value_redemptions r join public.vouchers v on v.id=r.voucher_id where r.client_id=cid),
 'transfers',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'code',v.code,'original_amount',v.original_amount,'transferred_at',t.created_at,'transferred_to',coalesce(e.details->>'to_name',c.name)) order by t.created_at desc),'[]'::jsonb) from public.voucher_transactions t join public.vouchers v on v.id=t.voucher_id join public.clients c on c.id=t.to_client_id left join lateral(select details from public.audit_events where details->>'voucher_id'=v.id::text and details->>'to_client_id'=t.to_client_id::text and created_at=t.created_at and action='voucher_transferred' limit 1)e on true where t.from_client_id=cid and t.kind in('assigned','reassigned')));
end;$$;

-- Email permission follows current ownership, not original purchaser.
do $$ declare def text;begin
 def:=pg_get_functiondef('public.prepare_client_voucher_email(uuid,text,uuid)'::regprocedure);
 def:=replace(def,'v.purchased_by=auth.uid()','(v.client_id=cid or (v.client_id is null and lower(trim(v.recipient_email))=(select lower(email) from auth.users where id=auth.uid())))');
 def:=replace(def,'Only vouchers purchased by you can be emailed from this screen.','Only vouchers currently assigned to you can be emailed from this screen.');execute def;
end;$$;
commit;
