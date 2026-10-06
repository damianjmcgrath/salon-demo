-- Apply after 014_client_patch_tests.sql.
begin;
create table public.client_credit_notes(id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id),amount numeric(10,2) not null check(amount>0 and amount<1000000),reason text not null check(length(trim(reason)) between 1 and 5000),created_by uuid not null references auth.users(id),staff_name text not null,created_at timestamptz not null default now());
create table public.client_value_redemptions(id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id),voucher_id uuid references public.vouchers(id),credit_note_id uuid references public.client_credit_notes(id),appointment_id uuid not null references public.appointments(id),amount numeric(10,2) not null check(amount>0),treatment_name text not null,staff_name text not null,used_at timestamptz not null default now(),recorded_by uuid not null references auth.users(id),check((voucher_id is null)<>(credit_note_id is null)));
alter table public.client_credit_notes enable row level security;
alter table public.client_value_redemptions enable row level security;
create policy staff_credit_read on public.client_credit_notes for select to authenticated using(public.is_salon_staff());
create policy staff_value_usage_read on public.client_value_redemptions for select to authenticated using(public.is_salon_staff());
grant select on public.client_credit_notes,public.client_value_redemptions to authenticated;
create function public.create_client_credit_note(p_client uuid,p_amount numeric,p_reason text) returns public.client_credit_notes language plpgsql security definer set search_path='' as $$
declare result public.client_credit_notes;sname text;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if not exists(select 1 from public.clients where id=p_client and merged_into is null) then raise exception 'Client not found.';end if;
 if p_amount is null or p_amount<=0 or p_amount>=1000000 or p_amount<>round(p_amount,2) then raise exception 'Enter a positive euro amount with up to two decimal places.';end if;
 if length(trim(coalesce(p_reason,''))) not between 1 and 5000 then raise exception 'Enter a reason.';end if;
 select s.name into sname from public.staff_users u join public.staff s on s.id=u.staff_id where u.user_id=auth.uid() and u.active;
 insert into public.client_credit_notes(client_id,amount,reason,created_by,staff_name) values(p_client,p_amount,trim(p_reason),auth.uid(),coalesce(sname,'Salon staff')) returning * into result;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),p_client,'credit_note_created',jsonb_build_object('credit_note_id',result.id,'amount',p_amount,'reason',trim(p_reason),'staff_name',result.staff_name));return result;
end; $$;
create function public.get_client_values(p_client uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 select coalesce(jsonb_agg(to_jsonb(t) order by t.used_at desc),'[]'::jsonb) into r from public.client_value_redemptions t where t.client_id=c.id;
 return jsonb_build_object('vouchers',v,'credit_notes',n,'redemptions',r);
end; $$;
-- Only a verified Auth email may claim a record created by somebody else's booking.
create or replace function public.ensure_own_client() returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;u auth.users;mail text;duplicate public.clients;begin
 if auth.uid() is null or exists(select 1 from public.staff_users where user_id=auth.uid()) then raise exception 'Client sign-in required.';end if;
 select * into u from auth.users where id=auth.uid();if u.id is null then raise exception 'Client sign-in required.';end if;
 if coalesce((u.raw_app_meta_data->>'requires_password_change')::boolean,false) then raise exception 'Change your temporary password before booking.';end if;
 mail:=lower(trim(coalesce(u.email,'')));
 perform pg_advisory_xact_lock(hashtextextended('salon-client-email:'||mail,0));
 select id into cid from public.clients where auth_user_id=u.id and merged_into is null;
 if cid is null and u.email_confirmed_at is not null and mail<>'' then
 select id into cid from public.clients where auth_user_id is null and merged_into is null and lower(trim(email))=mail order by created_at,id limit 1 for update;
 if cid is not null then update public.clients set auth_user_id=u.id,revision=revision+1,updated_at=now() where id=cid;end if;
 end if;
 if cid is null then
 insert into public.clients(auth_user_id,name,email,phone) values(u.id,coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),split_part(u.email,'@',1)),coalesce(u.email,''),coalesce(u.raw_user_meta_data->>'mobile','')) on conflict(auth_user_id) do nothing;
 select id into cid from public.clients where auth_user_id=u.id and merged_into is null;
 end if;
 if u.email_confirmed_at is not null and mail<>'' then
 for duplicate in select * from public.clients where auth_user_id is null and merged_into is null and id<>cid and lower(trim(email))=mail for update loop
 update public.appointments set client_id=cid,revision=revision+1 where client_id=duplicate.id;
 update public.client_notes set client_id=cid where client_id=duplicate.id;
 update public.client_patch_tests set client_id=cid where client_id=duplicate.id;
 update public.vouchers set client_id=cid,revision=revision+1 where client_id=duplicate.id;
 update public.client_credit_notes set client_id=cid where client_id=duplicate.id;
 update public.client_value_redemptions set client_id=cid where client_id=duplicate.id;
 update public.clients set merged_into=cid,revision=revision+1,updated_at=now() where id=duplicate.id;
 insert into public.audit_events(user_id,client_id,action,details) values(u.id,cid,'client_email_linked',jsonb_build_object('previous_client_id',duplicate.id,'before',to_jsonb(duplicate)));
 end loop;
 end if;
 return cid;
end; $$;
-- Repair historical proxy bookings assigned to a creator rather than an attendee.
do $$ declare current_booking public.appointments;cid uuid;mail text;begin
 for current_booking in select a.* from public.appointments a join public.clients c on c.id=a.client_id join auth.users u on u.id=a.user_id where c.auth_user_id=a.user_id and lower(trim(c.email))=lower(trim(u.email)) and not a.booked_for_self and trim(coalesce(a.attendee_email,''))<>'' and lower(trim(a.attendee_email))<>lower(trim(c.email)) loop
 mail:=lower(trim(current_booking.attendee_email));
 select id into cid from public.clients where merged_into is null and lower(trim(email))=mail order by (auth_user_id is not null) desc,created_at,id limit 1;
 if cid is null then insert into public.clients(name,email,phone) values(current_booking.client_name,mail,current_booking.phone) returning id into cid;end if;
 update public.appointments set client_id=cid,revision=revision+1 where id=current_booking.id;
 insert into public.audit_events(client_id,appointment_id,action,details) values(cid,current_booking.id,'booking_attendee_link_corrected',jsonb_build_object('previous_client_id',current_booking.client_id,'client_id',cid));
 end loop;
end; $$;
revoke all on function public.create_client_credit_note(uuid,numeric,text),public.get_client_values(uuid) from public;
grant execute on function public.create_client_credit_note(uuid,numeric,text),public.get_client_values(uuid) to authenticated;
commit;
