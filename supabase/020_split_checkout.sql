-- Apply once after 019. Treatment card/cash payments are recorded, never charged online.
begin;
alter table public.appointments drop constraint appointments_payment_method_check;
alter table public.appointments add constraint appointments_payment_method_check check(payment_method in ('card','cash','voucher','credit','split'));
create table public.appointment_payments (
 id uuid primary key default gen_random_uuid(),
 appointment_id uuid not null references public.appointments(id),
 method text not null check(method in ('card','cash','voucher','credit')),
 amount numeric(10,2) not null check(amount>0),
 redemption_id uuid unique references public.client_value_redemptions(id),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 unique(appointment_id,method),
 check((method in ('voucher','credit'))=(redemption_id is not null))
);
alter table public.appointment_payments enable row level security;
create policy staff_payment_read on public.appointment_payments for select to authenticated using(public.is_salon_staff());
grant select on public.appointment_payments to authenticated;
create index on public.client_value_redemptions(voucher_id);
create index on public.client_value_redemptions(credit_note_id);

create function public.get_checkout_options(p_id uuid,p_code text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.appointments; values_json jsonb; found_voucher jsonb;
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into a from public.appointments where id=p_id;
 if a.id is null then raise exception 'Appointment not found.';end if;
 if a.status<>'checked_in' then raise exception 'Check the client in before checking out.';end if;
 values_json:=case when a.client_id is null then '{"vouchers":[],"credit_notes":[]}'::jsonb else public.get_client_values(a.client_id) end;
 if trim(coalesce(p_code,''))<>'' then
 select to_jsonb(q) into found_voucher from (
 select v.id,v.code,v.assigned_client_name,v.expires_on,
 v.expires_on<(now() at time zone 'Europe/Dublin')::date expired,
 (select coalesce(sum(t.amount),0) from public.voucher_transactions t where t.voucher_id=v.id)-(select coalesce(sum(r.amount),0) from public.client_value_redemptions r where r.voucher_id=v.id) balance
 from public.vouchers v where regexp_replace(upper(v.code),'[^A-Z0-9]','','g')=regexp_replace(upper(p_code),'[^A-Z0-9]','','g')
 ) q;
 if found_voucher is null then raise exception 'Voucher not found.';end if;
 if (found_voucher->>'expired')::boolean then raise exception 'This voucher has expired.';end if;
 if (found_voucher->>'balance')::numeric<=0 then raise exception 'This voucher has no remaining value.';end if;
 end if;
 return values_json||jsonb_build_object('found_voucher',found_voucher);
end; $$;

create function public.checkout_appointment(p_id uuid,p_revision integer,p_method text,p_voucher_code text default null,p_credit_note_id uuid default null,p_remainder_method text default null,p_value_amount numeric default null)
returns public.appointments language plpgsql security definer set search_path='' as $$
declare a public.appointments; v public.vouchers; n public.client_credit_notes; balance numeric; used numeric:=0; remainder numeric; rid uuid; therapist text; label text;
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into a from public.appointments where id=p_id for update;
 if a.id is null then raise exception 'Appointment not found.';end if;
 if a.revision is distinct from p_revision then raise exception 'This appointment changed. Reload before checking out.';end if;
 if a.status<>'checked_in' then raise exception 'Only checked-in appointments can be checked out.';end if;
 if p_method is null or p_method not in ('card','cash','voucher','credit') then raise exception 'Choose a payment method.';end if;
 if a.price<0 then raise exception 'Invalid treatment price.';end if;
 if (p_method<>'voucher' and nullif(trim(p_voucher_code),'') is not null) or (p_method<>'credit' and p_credit_note_id is not null) then raise exception 'Select only one voucher or credit note.';end if;
 if p_method in ('card','cash') and p_remainder_method is not null then raise exception 'No remainder method is needed.';end if;
 remainder:=a.price;
 if p_method in ('voucher','credit') then
 if a.client_id is null then raise exception 'Link this appointment to a client before using a voucher or credit note.';end if;
 if a.price=0 then raise exception 'No voucher or credit note is needed for a free treatment.';end if;
 if p_method='voucher' then
 select * into v from public.vouchers where regexp_replace(upper(code),'[^A-Z0-9]','','g')=regexp_replace(upper(coalesce(p_voucher_code,'')),'[^A-Z0-9]','','g') for update;
 if v.id is null then raise exception 'Choose a valid voucher.';end if;
 if v.expires_on<(now() at time zone 'Europe/Dublin')::date then raise exception 'This voucher has expired.';end if;
 select (select coalesce(sum(t.amount),0) from public.voucher_transactions t where t.voucher_id=v.id)-(select coalesce(sum(r.amount),0) from public.client_value_redemptions r where r.voucher_id=v.id) into balance;
 else
 select * into n from public.client_credit_notes where id=p_credit_note_id for update;
 if n.id is null or n.client_id<>a.client_id then raise exception 'Choose a credit note assigned to this client.';end if;
 select n.amount-coalesce(sum(r.amount),0) into balance from public.client_value_redemptions r where r.credit_note_id=n.id;
 end if;
 if balance<=0 then raise exception 'There is no remaining value. Choose another payment method.';end if;
 used:=least(balance,a.price);remainder:=a.price-used;
 if p_value_amount is distinct from used then raise exception 'The balance changed. Reload checkout and review the new breakdown.';end if;
 if remainder>0 and (p_remainder_method is null or p_remainder_method not in ('card','cash')) then raise exception 'Choose Card or Cash for the remaining balance.';end if;
 if remainder=0 and p_remainder_method is not null then raise exception 'The balance changed. Review the payment breakdown before confirming.';end if;
 select name into therapist from public.staff where id=a.staff_id;
 insert into public.client_value_redemptions(client_id,voucher_id,credit_note_id,appointment_id,amount,treatment_name,staff_name,recorded_by)
 values(a.client_id,v.id,n.id,a.id,used,a.treatment_name,coalesce(therapist,'Salon staff'),auth.uid()) returning id into rid;
 insert into public.appointment_payments(appointment_id,method,amount,redemption_id,recorded_by) values(a.id,p_method,used,rid,auth.uid());
 if v.id is not null then update public.vouchers set revision=revision+1 where id=v.id;end if;
 end if;
 if remainder>0 then insert into public.appointment_payments(appointment_id,method,amount,recorded_by) values(a.id,case when used>0 then p_remainder_method else p_method end,remainder,auth.uid());end if;
 label:=case when used>0 and remainder>0 then 'split' else p_method end;
 perform pg_advisory_xact_lock(a.staff_id,(a.appointment_date-date '2000-01-01')::integer);
 update public.appointments set status='completed',completed_at=now(),revision=revision+1,payment_method=label where id=a.id returning * into a;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,'appointment_checked_out',jsonb_build_object('payment_method',label,'payments',(select coalesce(jsonb_agg(jsonb_build_object('method',p.method,'amount',p.amount,'redemption_id',p.redemption_id)),'[]'::jsonb) from public.appointment_payments p where p.appointment_id=a.id),'voucher_code',v.code,'credit_note_id',n.id));
 return a;
end; $$;
revoke all on function public.get_checkout_options(uuid,text),public.checkout_appointment(uuid,integer,text,text,uuid,text,numeric) from public;
grant execute on function public.get_checkout_options(uuid,text),public.checkout_appointment(uuid,integer,text,text,uuid,text,numeric) to authenticated;
create or replace function public.update_appointment_status(p_id uuid,p_status text,p_payment text default null,p_revision integer default null,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into a from public.appointments where id=p_id for update;
 if not found then raise exception 'Appointment not found.';end if;
 if p_revision is not null and a.revision<>p_revision then raise exception 'This appointment changed. Reload before editing.';end if;
 if not ((a.status='booked' and p_status in ('checked_in','cancelled','no_show')) or (a.status='checked_in' and p_status in ('completed','cancelled'))) then raise exception 'Invalid appointment status transition.';end if;
 if p_status in ('cancelled','no_show') and length(trim(coalesce(p_reason,'')))=0 then raise exception 'Add a reason.';end if;
 if p_status='no_show' and a.appointment_date+make_interval(mins=>a.start_minute)>now() at time zone 'Europe/Dublin' and not public.sandbox_no_show_testing_enabled() then raise exception 'A future appointment cannot be marked no-show.';end if;
 if p_status='completed' then raise exception 'Use Check Client Out to record payment.';end if;
 perform pg_advisory_xact_lock(a.staff_id,(a.appointment_date-date '2000-01-01')::integer);
 update public.appointments set status=p_status,revision=revision+1,payment_method=case when p_status='completed' then p_payment else null end,checked_in_at=case when p_status='checked_in' then now() else checked_in_at end,completed_at=case when p_status='completed' then now() else completed_at end where id=p_id;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,p_id,'status_changed',jsonb_build_object('before',a.status,'after',p_status,'payment_method',p_payment,'reason',p_reason,'guarantee_charged',false,'sandbox_future_no_show',p_status='no_show' and a.appointment_date+make_interval(mins=>a.start_minute)>now() at time zone 'Europe/Dublin'));
end; $$;
create or replace function public.get_my_vouchers() returns jsonb language plpgsql stable security definer set search_path='' as $$ declare mail text;begin
 if auth.uid() is null or exists(select 1 from public.staff_users where user_id=auth.uid()) then raise exception 'Client sign-in required.';end if;
 select lower(email) into mail from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if mail is null then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'code',v.code,'original_amount',v.original_amount,'expires_on',v.expires_on,'assigned_client_name',v.assigned_client_name,'recipient_email',coalesce(v.recipient_email,c.email),'client_id',v.client_id,'revision',v.revision,'created_at',v.created_at,'demo_purchase',v.demo_purchase,'balance',(select coalesce(sum(l.amount),0) from public.voucher_transactions l where l.voucher_id=v.id)-(select coalesce(sum(r.amount),0) from public.client_value_redemptions r where r.voucher_id=v.id)) order by v.created_at desc) from public.vouchers v left join public.clients c on c.id=v.client_id where lower(coalesce(v.recipient_email,c.email))=mail),'[]'::jsonb);end; $$;
create or replace function public.reassign_voucher(p_id uuid,p_client_id uuid,p_revision integer) returns public.vouchers language plpgsql security definer set search_path='' as $$
declare old public.vouchers;v public.vouchers;cname text;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into old from public.vouchers where id=p_id for update;if not found then raise exception 'Voucher not found.';end if;
 if old.revision is distinct from p_revision then raise exception 'Voucher changed. Search again before transferring.';end if;
 if old.expires_on<(now() at time zone 'Europe/Dublin')::date then raise exception 'An expired voucher cannot be transferred.';end if;
 if old.client_id=p_client_id then raise exception 'Voucher is already assigned to this client.';end if;
 if ((select coalesce(sum(amount),0) from public.voucher_transactions where voucher_id=p_id)-(select coalesce(sum(amount),0) from public.client_value_redemptions where voucher_id=p_id))<=0 then raise exception 'This voucher has no remaining value.';end if;
 select name into cname from public.clients where id=p_client_id;if not found then raise exception 'Choose an existing client.';end if;
 update public.vouchers set client_id=p_client_id,assigned_client_name=cname,recipient_email=(select email from public.clients where id=p_client_id),revision=revision+1 where id=p_id returning * into v;
 insert into public.voucher_transactions(voucher_id,kind,amount,from_client_id,to_client_id,user_id) values(v.id,case when old.client_id is null then 'assigned' else 'reassigned' end,0,old.client_id,v.client_id,auth.uid());
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),v.client_id,'voucher_reassigned',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(v),'previous_client_id',old.client_id));return v;
end; $$;
create or replace function public.search_vouchers(p_code text default '',p_client_id uuid default null) returns table(id uuid,code text,original_amount numeric,expires_on date,client_id uuid,assigned_client_name text,revision integer,created_at timestamptz,balance numeric) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if trim(coalesce(p_code,''))='' and p_client_id is null then raise exception 'Enter a voucher ID or select a client.';end if;
 return query select v.id,v.code,v.original_amount,v.expires_on,v.client_id,v.assigned_client_name,v.revision,v.created_at,coalesce(sum(l.amount),0)-(select coalesce(sum(r.amount),0) from public.client_value_redemptions r where r.voucher_id=v.id) from public.vouchers v left join public.voucher_transactions l on l.voucher_id=v.id
 where (trim(coalesce(p_code,''))='' or regexp_replace(upper(v.code),'[^A-Z0-9]','','g')=regexp_replace(upper(p_code),'[^A-Z0-9]','','g')) and (p_client_id is null or v.client_id=p_client_id or lower(v.recipient_email)=(select lower(cc.email) from public.clients cc where cc.id=p_client_id))
 group by v.id order by v.created_at desc limit 100;
end; $$;
create or replace function public.get_activity_report(p_from date,p_to date,p_period text default 'day')
returns table(period_start date,appointments_scheduled bigint,appointments_completed bigint,card_payments numeric,card_terminal_fee numeric,retained_card_payments numeric,cash_payments numeric,vouchers_used numeric,credit_notes_used numeric,total_payments numeric)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.staff_users where user_id=auth.uid() and active and role in ('admin','accountant')) then raise exception 'Reporting access required.';end if;
 if p_from is null or p_to is null or p_from>p_to or p_period not in ('day','month') or p_period is null then raise exception 'Choose a valid date range and period.';end if;
 if p_to-p_from>3660 then raise exception 'Choose a range of ten years or less.';end if;
 return query
 with periods as (
 select d::date as start from pg_catalog.generate_series(pg_catalog.date_trunc(p_period,p_from::timestamp),pg_catalog.date_trunc(p_period,p_to::timestamp),case when p_period='day' then interval '1 day' else interval '1 month' end) d
 ), payment_rows as (
 select a.id,coalesce((a.completed_at at time zone 'Europe/Dublin')::date,a.appointment_date) paid_date,p.method,p.amount
 from public.appointments a join public.appointment_payments p on p.appointment_id=a.id where a.status='completed'
 union all
 select a.id,coalesce((a.completed_at at time zone 'Europe/Dublin')::date,a.appointment_date),a.payment_method,a.price
 from public.appointments a where a.status='completed' and not exists(select 1 from public.appointment_payments p where p.appointment_id=a.id)
 ), totals as (
 select p.start,
 (select count(*) from public.appointments a where a.status<>'cancelled' and a.appointment_date>=p.start and a.appointment_date<(p.start+case when p_period='day' then interval '1 day' else interval '1 month' end)) as scheduled,
 (select count(*) from public.appointments a where a.status='completed' and a.appointment_date>=p.start and a.appointment_date<(p.start+case when p_period='day' then interval '1 day' else interval '1 month' end)) as completed,
 coalesce(sum(a.amount) filter(where a.method='card'),0) as card,
 coalesce(sum(a.amount) filter(where a.method='cash'),0) as cash,
 coalesce(sum(a.amount) filter(where a.method='voucher'),0) as voucher,
 coalesce(sum(a.amount) filter(where a.method='credit'),0) as credit
 from periods p left join payment_rows a on a.paid_date>=p.start and a.paid_date<(p.start+case when p_period='day' then interval '1 day' else interval '1 month' end)
 group by p.start
 )
 select t.start,t.scheduled,t.completed,t.card,round(t.card*0.015,2),t.card-round(t.card*0.015,2),t.cash,t.voucher,t.credit,t.card-round(t.card*0.015,2)+t.cash+t.voucher+t.credit from totals t order by t.start;
end; $$;

create or replace function public.get_client_values(p_client uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.clients;v jsonb;n jsonb;r jsonb;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into c from public.clients where id=p_client and merged_into is null;if c.id is null then raise exception 'Client not found.';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) into v from (
 select v.id,v.code,v.original_amount,v.expires_on,v.created_at,v.demo_purchase,
 coalesce(buyer.name,nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Not recorded') purchaser,
 (select coalesce(sum(t.amount),0) from public.voucher_transactions t where t.voucher_id=v.id) - (select coalesce(sum(t.amount),0) from public.client_value_redemptions t where t.voucher_id=v.id) balance,
 v.expires_on<(now() at time zone 'Europe/Dublin')::date expired
 from public.vouchers v left join auth.users u on u.id=v.purchased_by left join public.clients buyer on buyer.auth_user_id=v.purchased_by
 where v.client_id=c.id or (v.client_id is null and lower(trim(v.recipient_email))=lower(trim(c.email)))
 ) q;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) into n from (select n.*,n.amount-(select coalesce(sum(r.amount),0) from public.client_value_redemptions r where r.credit_note_id=n.id) balance from public.client_credit_notes n where n.client_id=c.id) q;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.used_at desc),'[]'::jsonb) into r from (select t.*,v.code voucher_code from public.client_value_redemptions t left join public.vouchers v on v.id=t.voucher_id where t.client_id=c.id) q;
 return jsonb_build_object('vouchers',v,'credit_notes',n,'redemptions',r);
end; $$;

commit;
