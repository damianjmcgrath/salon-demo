-- Apply once after 042. Keep the existing booking email INSERT webhook.
begin;
alter table public.appointments add column staff_selected boolean,add column preferred_staff_id integer references public.staff(id);
-- NULL is deliberately unknown for historical/staff-created bookings.
do $$ declare def text;sig text;begin
 foreach sig in array array['public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer)','public.book_with_value(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,text,uuid)'] loop
 def:=pg_get_functiondef(sig::regprocedure);
 def:=replace(def,E')\n RETURNS',E', p_staff_selected boolean DEFAULT NULL)\n RETURNS');
 if position('p_staff_selected boolean' in def)=0 then raise exception 'Booking signature changed.';end if;
 def:=replace(def,'return a;','update public.appointments set staff_selected=p_staff_selected,preferred_staff_id=case when p_staff_selected then p_staff_id else null end where id=a.id returning * into a;return a;');execute def;
 execute 'drop function '||sig;
 end loop;
end;$$;
revoke all on function public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,boolean),public.book_with_value(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,text,uuid,boolean) from public;
grant execute on function public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,boolean),public.book_with_value(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer,text,uuid,boolean) to authenticated;

-- Retain original payment snapshots in a separate immutable audit ledger.
create table public.prepaid_cancellation_adjustments(
 appointment_id uuid primary key references public.appointments(id),value_id uuid not null,method text not null check(method in('voucher','credit')),
 original_amount numeric(10,2) not null,fee_amount numeric(10,2) not null,refund_amount numeric(10,2) not null,
 original_redemption jsonb not null,original_payment jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 check(original_amount=fee_amount+refund_amount and fee_amount>=0 and refund_amount>=0)
);
alter table public.prepaid_cancellation_adjustments enable row level security;
revoke all on public.prepaid_cancellation_adjustments from public,anon,authenticated;
alter table public.client_value_redemptions drop constraint client_value_redemptions_amount_check;
alter table public.client_value_redemptions add constraint client_value_redemptions_amount_check check(amount>=0);
-- Policy distinguishes prepaid refunds from card guarantees.
do $$ declare def text;begin
 def:=pg_get_functiondef('public.client_appointment_policy(uuid)'::regprocedure);
 def:=replace(def,'c.can_cancel_free or not a.guarantee_required or a.prepaid_method is not null or not exists','case when a.prepaid_method is not null then c.can_cancel_free else c.can_cancel_free or not a.guarantee_required or not exists');
 def:=replace(def,$find$g.verified_at is not null),'fee_cents'$find$,$new$g.verified_at is not null) end,'fee_cents'$new$);
 def:=replace(def,$find$'fee_cents',a.guarantee_fee_cents$find$,$new$'fee_cents',case when a.prepaid_method is not null then round(a.price*50)::integer else a.guarantee_fee_cents end,'prepaid_method',a.prepaid_method$new$);execute def;
end;$$;

create or replace function public.client_cancel_appointment(p_id uuid,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.appointments;policy jsonb;free boolean;r public.client_value_redemptions;p public.appointment_payments;fee numeric;begin
 select * into a from public.appointments where id=p_id for update;policy:=public.client_appointment_policy(p_id);
 if not (policy->>'can_manage')::boolean then raise exception 'This appointment can no longer be cancelled online.';end if;
 if a.revision is distinct from p_revision then raise exception 'Appointment changed. Reload before cancelling.';end if;
 free:=(policy->>'cancel_free')::boolean;
 perform pg_advisory_xact_lock(a.staff_id,(a.appointment_date-date '2000-01-01')::integer);
 if a.prepaid_method is not null then
 -- Lock the same value resource used by booking/checkout before restoring its balance.
 if a.prepaid_method='voucher' then perform 1 from public.vouchers where id=a.prepaid_value_id for update;
 else perform 1 from public.client_credit_notes where id=a.prepaid_value_id for update;end if;
 select * into p from public.appointment_payments where appointment_id=a.id and method=a.prepaid_method for update;
 select * into r from public.client_value_redemptions where id=p.redemption_id for update;
 if r.id is null or p.amount<>a.price or r.amount<>a.price or coalesce(r.voucher_id,r.credit_note_id)<>a.prepaid_value_id then raise exception 'Prepaid payment needs review. Contact the salon.';end if;
 fee:=case when free then 0 else round(a.price*0.5,2) end;
 insert into public.prepaid_cancellation_adjustments(appointment_id,value_id,method,original_amount,fee_amount,refund_amount,original_redemption,original_payment,actor_id) values(a.id,a.prepaid_value_id,a.prepaid_method,a.price,fee,a.price-fee,to_jsonb(r),to_jsonb(p),auth.uid());
 update public.client_value_redemptions set amount=fee,treatment_name=a.treatment_name||' (cancellation fee)',used_at=now() where id=r.id;
 -- Original payment remains immutable; reports record the refund on its actual date.
 if a.prepaid_method='voucher' then update public.vouchers set revision=revision+1 where id=a.prepaid_value_id;end if;
 else
 insert into public.no_show_fees(appointment_id,actor_id,apply_fee,comments,state,purpose) values(p_id,auth.uid(),not free,'Client confirmed online cancellation',case when free then 'waived' else 'pending' end,'cancellation');
 end if;
 update public.appointments set status='cancelled',revision=revision+1 where id=p_id;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,p_id,'client_cancelled_appointment',jsonb_build_object('before',to_jsonb(a),'fee_waived',free,'method',a.prepaid_method,'amount_cents',case when free then 0 else (policy->>'fee_cents')::integer end,'refund_amount',case when a.prepaid_method is not null then a.price-fee else 0 end));
 return jsonb_build_object('cancelled',true,'fee_required',not free and a.prepaid_method is null,'amount_cents',case when free then 0 else (policy->>'fee_cents')::integer end,'prepaid_method',a.prepaid_method,'refund_amount',case when a.prepaid_method is not null then a.price-fee else 0 end);
end;$$;
-- Hide zeroed refunded redemptions; sums still calculate restored balances.
do $$ declare def text;begin
 def:=pg_get_functiondef('public.get_client_values(uuid)'::regprocedure);def:=replace(def,'where t.client_id=c.id;','where t.client_id=c.id and t.amount>0;');execute def;
 def:=pg_get_functiondef('public.get_voucher_status_report()'::regprocedure);def:=replace(def,'where x.voucher_id=v.id)','where x.voucher_id=v.id and x.amount>0)');execute def;
 def:=pg_get_functiondef('public.get_my_voucher_history()'::regprocedure);def:=replace(def,'where r.client_id=cid)','where r.client_id=cid and r.amount>0)');execute def;
 def:=pg_get_functiondef('public.get_daily_activity_report(date,date,text[])'::regprocedure);
 def:=replace(def,'), dated as', 'union all select a.id,x.created_at at time zone ''Europe/Dublin'',coalesce(c.name,a.client_name),coalesce(c.email,a.attendee_email,''''),a.treatment_name||'' (prepayment refund)'',s.name,x.method,''''::text,coalesce(v.code,''''),-x.refund_amount,''refund-''||a.id::text from public.prepaid_cancellation_adjustments x join public.appointments a on a.id=x.appointment_id left join public.clients c on c.id=a.client_id left join public.staff s on s.id=a.staff_id left join public.vouchers v on v.id=x.value_id where x.refund_amount>0 ), dated as');
 def:=replace(def,'where activity_at::date between','where amount<>0 and activity_at::date between');execute def;
end;$$;
create function public.get_my_credit_notes() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cid uuid;begin
 -- Reuse the verified client identity guard, including rejection of staff logins.
 perform public.get_my_vouchers();select id into cid from public.clients where auth_user_id=auth.uid() and merged_into is null;
 return jsonb_build_object('credit_notes',(select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) from(select n.*,n.amount-(select coalesce(sum(r.amount),0) from public.client_value_redemptions r where r.credit_note_id=n.id) balance from public.client_credit_notes n where n.client_id=cid)q),
 'uses',(select coalesce(jsonb_agg(to_jsonb(r) order by used_at desc),'[]'::jsonb) from public.client_value_redemptions r where client_id=cid and credit_note_id is not null and amount>0));
end;$$;
revoke all on function public.get_my_credit_notes() from public;grant execute on function public.get_my_credit_notes() to authenticated;

-- Multiple immutable email jobs per appointment, one per lifecycle revision.
alter table public.booking_email_queue drop constraint booking_email_queue_appointment_id_key;
alter table public.booking_email_queue add column event_kind text not null default 'booked' check(event_kind in('booked','amended','cancelled')),add column event_revision integer not null default 0;
alter table public.booking_email_queue add constraint booking_email_lifecycle_unique unique(appointment_id,event_kind,event_revision);
do $$ declare def text;begin
 def:=pg_get_functiondef('public.queue_booking_confirmation()'::regprocedure);def:=replace(def,'on conflict(appointment_id)','on conflict(appointment_id,event_kind,event_revision)');execute def;
 def:=pg_get_functiondef('public.claim_booking_emails()'::regprocedure);def:=replace(def,$find$where q.status='pending' and exists$find$,$new$where q.status='pending' and q.event_kind in('booked','amended') and exists$new$);execute def;
end;$$;
create function public.queue_appointment_change_email() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;adjustment public.prepaid_cancellation_adjustments;begin
 if new.status='cancelled' and old.status<>'cancelled' then kind:='cancelled';
 elsif new.status in('booked','checked_in') and (new.appointment_date,new.start_minute,new.staff_id,new.treatment_id) is distinct from (old.appointment_date,old.start_minute,old.staff_id,old.treatment_id) then kind:='amended';
 else return new;end if;
 update public.booking_email_queue set status='cancelled',last_error='Superseded by appointment change.' where appointment_id=new.id and status='pending' and event_kind in('booked','amended');
 select * into adjustment from public.prepaid_cancellation_adjustments where appointment_id=new.id;
 insert into public.booking_email_queue(appointment_id,event_kind,event_revision,snapshot) values(new.id,kind,new.revision,to_jsonb(new)||jsonb_build_object('event_kind',kind,'staff_name',(select name from public.staff where id=new.staff_id),'original_date',old.appointment_date,'original_start',old.start_minute,'refund_amount',adjustment.refund_amount,'retained_fee',adjustment.fee_amount)) on conflict do nothing;
 return new;
end;$$;
revoke all on function public.queue_appointment_change_email() from public,anon,authenticated;
create trigger appointment_change_email after update on public.appointments for each row execute function public.queue_appointment_change_email();

create function public.get_staff_preference_report(p_from date default null,p_to date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;staff jsonb;begin
 perform public.require_any_permission(array['view.reporting']);
 if (p_from is null)<>(p_to is null) or p_from>p_to then raise exception 'Choose both dates in the correct order, or leave both blank.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.id),'[]'::jsonb) into staff from public.staff s where s.active or exists(select 1 from public.appointments a where a.preferred_staff_id=s.id);
 with groups as(select a.treatment_id,a.treatment_name,a.staff_selected,a.preferred_staff_id,count(*) n from public.appointments a where (p_from is null or a.appointment_date between p_from and p_to) group by a.treatment_id,a.treatment_name,a.staff_selected,a.preferred_staff_id), totals as(
 select treatment_id,treatment_name,sum(n) total,coalesce(sum(n) filter(where staff_selected=false),0) no_preference,coalesce(sum(n) filter(where staff_selected is null),0) unknown,
 coalesce(jsonb_object_agg(preferred_staff_id::text,n) filter(where staff_selected=true and preferred_staff_id is not null),'{}'::jsonb) selected from groups group by treatment_id,treatment_name)
 select coalesce(jsonb_agg(to_jsonb(t) order by treatment_name),'[]'::jsonb) into rows from totals t;
 return jsonb_build_object('staff',staff,'rows',rows);
end;$$;
revoke all on function public.get_staff_preference_report(date,date) from public;grant execute on function public.get_staff_preference_report(date,date) to authenticated;
commit;
