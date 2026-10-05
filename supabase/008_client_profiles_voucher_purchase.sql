-- Apply once after 007. Purchases and email delivery remain explicitly simulated.
begin;
alter table public.clients add column marketing_email boolean not null default false,add column marketing_sms boolean not null default false,add column marketing_whatsapp boolean not null default false,add column marketing_updated_at timestamptz;
alter table public.vouchers add column recipient_email text,add column purchased_by uuid references auth.users(id),add column treatment_id integer references public.treatments(id),add column demo_purchase boolean not null default false;
update public.vouchers v set recipient_email=c.email from public.clients c where c.id=v.client_id;
create table public.demo_voucher_orders(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),request_id uuid not null,voucher_id uuid not null references public.vouchers(id),confirmation jsonb not null,card_option text not null check(card_option in('saved_demo','new_demo')),created_at timestamptz not null default now(),unique(user_id,request_id));
alter table public.demo_voucher_orders enable row level security;
create policy own_demo_order on public.demo_voucher_orders for select to authenticated using(user_id=auth.uid() and not exists(select 1 from public.staff_users where user_id=auth.uid()));
grant select on public.demo_voucher_orders to authenticated;
create function public.get_my_profile() returns public.clients language plpgsql security definer set search_path='' as $$ declare cid uuid;c public.clients;begin cid:=public.ensure_own_client();select * into c from public.clients where id=cid;c.email:=(select email from auth.users where id=auth.uid());return c;end; $$;
create function public.update_my_profile(p_name text,p_phone text,p_email_marketing boolean,p_sms_marketing boolean,p_whatsapp_marketing boolean,p_revision integer) returns public.clients language plpgsql security definer set search_path='' as $$ declare cid uuid;old public.clients;c public.clients;begin
 cid:=public.ensure_own_client();if length(trim(coalesce(p_name,'')))=0 or length(trim(coalesce(p_phone,'')))=0 then raise exception 'Name and phone number are required.';end if;
 select * into old from public.clients where id=cid for update;if old.revision<>p_revision then raise exception 'Your profile changed. Reload before saving.';end if;
 update public.clients set name=trim(p_name),phone=trim(p_phone),marketing_email=coalesce(p_email_marketing,false),marketing_sms=coalesce(p_sms_marketing,false),marketing_whatsapp=coalesce(p_whatsapp_marketing,false),marketing_updated_at=now(),revision=revision+1,updated_at=now() where id=cid returning * into c;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),cid,'client_self_profile_updated',jsonb_build_object('before',jsonb_build_object('name',old.name,'phone',old.phone,'marketing_email',old.marketing_email,'marketing_sms',old.marketing_sms,'marketing_whatsapp',old.marketing_whatsapp),'after',jsonb_build_object('name',c.name,'phone',c.phone,'marketing_email',c.marketing_email,'marketing_sms',c.marketing_sms,'marketing_whatsapp',c.marketing_whatsapp)));c.email:=(select email from auth.users where id=auth.uid());return c;end; $$;
create function public.get_my_vouchers() returns jsonb language plpgsql stable security definer set search_path='' as $$ declare mail text;begin
 if auth.uid() is null or exists(select 1 from public.staff_users where user_id=auth.uid()) then raise exception 'Client sign-in required.';end if;
 select lower(email) into mail from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if mail is null then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'code',v.code,'original_amount',v.original_amount,'expires_on',v.expires_on,'assigned_client_name',v.assigned_client_name,'recipient_email',coalesce(v.recipient_email,c.email),'client_id',v.client_id,'revision',v.revision,'created_at',v.created_at,'demo_purchase',v.demo_purchase,'balance',(select coalesce(sum(l.amount),0) from public.voucher_transactions l where l.voucher_id=v.id)) order by v.created_at desc) from public.vouchers v left join public.clients c on c.id=v.client_id where lower(coalesce(v.recipient_email,c.email))=mail),'[]'::jsonb);end; $$;
create function public.purchase_demo_voucher(p_option text,p_treatment_id integer,p_for_self boolean,p_recipient_name text,p_recipient_email text,p_card text,p_ack boolean,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;c public.clients;mail text;rname text;amount numeric;t public.treatments;v public.vouchers;confirmed jsonb;tries integer:=0;begin
 cid:=public.ensure_own_client();select * into c from public.clients where id=cid;select email into mail from auth.users where id=auth.uid();
 if not coalesce(p_ack,false) or p_card is null or p_card not in('saved_demo','new_demo') or p_request is null or p_for_self is null then raise exception 'Choose a demo card and acknowledge this simulated purchase.';end if;
 perform pg_advisory_xact_lock(hashtextextended('voucher-purchase:'||auth.uid()::text||':'||p_request::text,0));
 select confirmation into confirmed from public.demo_voucher_orders where user_id=auth.uid() and request_id=p_request;if confirmed is not null then return confirmed;end if;
 if p_option='25' then amount:=25;elsif p_option='50' then amount:=50;elsif p_option='treatment' then select * into t from public.treatments where id=p_treatment_id and active;if t.id is null then raise exception 'Choose an available treatment.';end if;amount:=t.price;else raise exception 'Choose a voucher amount.';end if;
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
create function public.simulate_voucher_email(p_voucher_id uuid,p_to text) returns text language plpgsql security definer set search_path='' as $$ declare order_data jsonb;mail text;cid uuid;begin
 cid:=public.ensure_own_client();select confirmation into order_data from public.demo_voucher_orders where user_id=auth.uid() and voucher_id=p_voucher_id;if order_data is null then raise exception 'Your purchased voucher was not found.';end if;
 if p_to='recipient' then mail:=order_data->>'recipient_email';elsif p_to='self' then select email into mail from auth.users where id=auth.uid();else raise exception 'Choose recipient or yourself.';end if;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),cid,'demo_voucher_email_prepared',jsonb_build_object('voucher_id',p_voucher_id,'email_to',mail,'email_sent',false));return mail;end; $$;
revoke all on function public.get_my_profile(),public.update_my_profile(text,text,boolean,boolean,boolean,integer),public.get_my_vouchers(),public.purchase_demo_voucher(text,integer,boolean,text,text,text,boolean,uuid),public.simulate_voucher_email(uuid,text) from public;
grant execute on function public.get_my_profile(),public.update_my_profile(text,text,boolean,boolean,boolean,integer),public.get_my_vouchers(),public.purchase_demo_voucher(text,integer,boolean,text,text,text,boolean,uuid),public.simulate_voucher_email(uuid,text) to authenticated;

create or replace function public.create_voucher(p_amount numeric,p_expires_on date,p_client_id uuid default null) returns public.vouchers language plpgsql security definer set search_path='' as $$
declare v public.vouchers;cname text;raw text;attempt integer;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if p_amount is null or not (p_amount>0 and p_amount<1000000) or p_amount<>round(p_amount,2) then raise exception 'Enter a positive euro amount with up to two decimal places.';end if;
 if p_expires_on is null or p_expires_on<(now() at time zone 'Europe/Dublin')::date then raise exception 'Choose an expiry date that is not in the past.';end if;
 if p_client_id is not null then select name into cname from public.clients where id=p_client_id;if not found then raise exception 'Client not found.';end if;end if;
 for attempt in 1..5 loop
 raw:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 begin
 insert into public.vouchers(code,original_amount,expires_on,client_id,assigned_client_name,created_by) values('SC-'||substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4),p_amount,p_expires_on,p_client_id,cname,auth.uid()) returning * into v;exit;
 exception when unique_violation then if attempt=5 then raise;end if;end;
 end loop;
 update public.vouchers set recipient_email=(select email from public.clients where id=v.client_id) where id=v.id returning * into v;
 insert into public.voucher_transactions(voucher_id,kind,amount,to_client_id,user_id) values(v.id,'issued',v.original_amount,v.client_id,auth.uid());
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),v.client_id,'voucher_created',jsonb_build_object('after',to_jsonb(v)));return v;
end; $$;
create or replace function public.reassign_voucher(p_id uuid,p_client_id uuid,p_revision integer) returns public.vouchers language plpgsql security definer set search_path='' as $$
declare old public.vouchers;v public.vouchers;cname text;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into old from public.vouchers where id=p_id for update;if not found then raise exception 'Voucher not found.';end if;
 if old.revision is distinct from p_revision then raise exception 'Voucher changed. Search again before transferring.';end if;
 if old.expires_on<(now() at time zone 'Europe/Dublin')::date then raise exception 'An expired voucher cannot be transferred.';end if;
 if old.client_id=p_client_id then raise exception 'Voucher is already assigned to this client.';end if;
 if (select coalesce(sum(amount),0) from public.voucher_transactions where voucher_id=p_id)<=0 then raise exception 'This voucher has no remaining value.';end if;
 select name into cname from public.clients where id=p_client_id;if not found then raise exception 'Choose an existing client.';end if;
 update public.vouchers set client_id=p_client_id,assigned_client_name=cname,recipient_email=(select email from public.clients where id=p_client_id),revision=revision+1 where id=p_id returning * into v;
 insert into public.voucher_transactions(voucher_id,kind,amount,from_client_id,to_client_id,user_id) values(v.id,case when old.client_id is null then 'assigned' else 'reassigned' end,0,old.client_id,v.client_id,auth.uid());
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),v.client_id,'voucher_reassigned',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(v),'previous_client_id',old.client_id));return v;
end; $$;
create or replace function public.search_vouchers(p_code text default '',p_client_id uuid default null) returns table(id uuid,code text,original_amount numeric,expires_on date,client_id uuid,assigned_client_name text,revision integer,created_at timestamptz,balance numeric) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if trim(coalesce(p_code,''))='' and p_client_id is null then raise exception 'Enter a voucher ID or select a client.';end if;
 return query select v.id,v.code,v.original_amount,v.expires_on,v.client_id,v.assigned_client_name,v.revision,v.created_at,coalesce(sum(l.amount),0) from public.vouchers v left join public.voucher_transactions l on l.voucher_id=v.id
 where (trim(coalesce(p_code,''))='' or regexp_replace(upper(v.code),'[^A-Z0-9]','','g')=regexp_replace(upper(p_code),'[^A-Z0-9]','','g')) and (p_client_id is null or v.client_id=p_client_id or lower(v.recipient_email)=(select lower(cc.email) from public.clients cc where cc.id=p_client_id))
 group by v.id order by v.created_at desc limit 100;
end; $$;
commit;
