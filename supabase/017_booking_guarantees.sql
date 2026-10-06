-- Run after 016. Sandbox only; no card numbers/CVV are stored here.
begin;
create table public.booking_guarantee_cards (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id),
 created_by uuid not null references auth.users(id),
 setup_order_id text not null unique,
 customer_id text,
 payment_method_id text,
 brand text,
 last_four text,
 verified_at timestamptz,
 consent_at timestamptz not null default now(),
 policy_version text not null default 'sandbox-no-show-10-v1',
 environment text not null default 'sandbox' check(environment='sandbox')
);
alter table public.appointments add column guarantee_card_id uuid references public.booking_guarantee_cards(id);
create table public.no_show_fees (
 appointment_id uuid primary key references public.appointments(id),
 actor_id uuid not null references auth.users(id),
 apply_fee boolean not null,
 comments text not null check(length(trim(comments)) between 1 and 2000),
 amount_cents integer not null default 1000 check(amount_cents=1000),
 state text not null check(state in ('waived','pending','processing','completed','failed','review')),
 order_id text unique,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.booking_guarantee_cards enable row level security;
alter table public.no_show_fees enable row level security;
revoke all on public.booking_guarantee_cards,public.no_show_fees from anon,authenticated;
grant all on public.booking_guarantee_cards,public.no_show_fees to service_role;

-- Wrap the established booking functions: guarantee validation and appointment
-- creation/linking happen in one database transaction. Legacy RPCs are private.
create function public.book_guaranteed_appointment(p_treatment_id integer,p_staff_id integer,p_date date,p_start integer,p_client_name text,p_phone text,p_booked_for_self boolean,p_attendee_email text,p_guarantee_id uuid,p_consent boolean,p_client_id uuid default null) returns public.appointments language plpgsql security definer set search_path='' as $$
declare g public.booking_guarantee_cards;a public.appointments;cid uuid;begin
 if not coalesce(p_consent,false) then raise exception 'Agree to the booking guarantee first.';end if;
 if public.is_salon_staff() then
   cid:=p_client_id;
 else
   if p_client_id is not null then raise exception 'Client bookings cannot specify another card owner.';end if;
   cid:=public.ensure_own_client();
 end if;
 select * into g from public.booking_guarantee_cards where id=p_guarantee_id and client_id=cid and verified_at is not null and environment='sandbox';
 if not found then raise exception 'A verified card belonging to the booking payer is required.';end if;
 if public.is_salon_staff() then
   a:=public.staff_book_appointment(cid,p_treatment_id,p_staff_id,p_date,p_start,'saved_demo',true);
 else
   a:=public.book_appointment(p_treatment_id,p_staff_id,p_date,p_start,p_client_name,p_phone,true,p_booked_for_self,p_attendee_email,'saved_demo');
 end if;
 update public.appointments set guarantee_card_id=g.id,demo_card=null,guarantee_policy_version=g.policy_version where id=a.id returning * into a;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,'booking_guarantee_agreed',jsonb_build_object('card_owner_client_id',cid,'card_id',g.id,'policy_version',g.policy_version,'consent_at',now(),'environment','sandbox'));
 return a;
end; $$;
revoke all on function public.book_appointment(integer,integer,date,integer,text,text,boolean,boolean,text,text),public.staff_book_appointment(uuid,integer,integer,date,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid) from public;
grant execute on function public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid) to authenticated;

create function public.record_no_show_decision(p_id uuid,p_revision integer,p_apply_fee boolean,p_comments text) returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if p_apply_fee is null or length(trim(coalesce(p_comments,''))) not between 1 and 2000 then raise exception 'Add comments (up to 2000 characters).';end if;
 select * into a from public.appointments where id=p_id for update;
 if not found then raise exception 'Appointment not found.';end if;
 if exists(select 1 from public.no_show_fees where appointment_id=p_id) then raise exception 'A no-show fee decision has already been recorded.';end if;
 perform public.update_appointment_status(p_id,'no_show',null,p_revision,trim(p_comments));
 insert into public.no_show_fees(appointment_id,actor_id,apply_fee,comments,state) values(p_id,auth.uid(),p_apply_fee,trim(p_comments),case when p_apply_fee then 'pending' else 'waived' end);
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,p_id,'no_show_fee_decision',jsonb_build_object('apply_fee',p_apply_fee,'comments',trim(p_comments),'amount_cents',1000,'environment','sandbox'));
end; $$;
revoke all on function public.record_no_show_decision(uuid,integer,boolean,text) from public;
grant execute on function public.record_no_show_decision(uuid,integer,boolean,text) to authenticated;

-- Only the payment worker can confirm a financial result. Audit every change.
create function public.audit_no_show_fee() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.state is distinct from new.state then
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) select new.actor_id,a.client_id,a.id,'no_show_fee_status',jsonb_build_object('before',old.state,'after',new.state,'order_id',new.order_id,'error',new.error,'environment','sandbox') from public.appointments a where a.id=new.appointment_id;
 end if;
 return new;
end; $$;
revoke all on function public.audit_no_show_fee() from public;
create trigger audit_no_show_fee after update on public.no_show_fees for each row execute function public.audit_no_show_fee();
commit;
