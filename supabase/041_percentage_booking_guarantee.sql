-- Apply once after 040. Old bookings retain the agreed €10 amount.
begin;
alter table public.appointments add column guarantee_fee_cents integer not null default 1000 check(guarantee_fee_cents>=0);
create function public.snapshot_booking_guarantee_fee() returns trigger language plpgsql set search_path='' as $$ begin
 if TG_OP='INSERT' then new.guarantee_fee_cents:=round(new.price*50)::integer;
 else new.guarantee_fee_cents:=old.guarantee_fee_cents;end if;
 return new;end;$$;
create trigger snapshot_booking_guarantee_fee before insert or update on public.appointments for each row execute function public.snapshot_booking_guarantee_fee();
alter table public.no_show_fees drop constraint no_show_fees_amount_cents_check;
alter table public.no_show_fees alter column amount_cents drop default;
alter table public.no_show_fees add constraint no_show_fees_amount_cents_check check(amount_cents>=0 and (not apply_fee or amount_cents>0));
-- Inserted fee rows always use the immutable booking snapshot.
create function public.set_no_show_fee_amount() returns trigger language plpgsql security definer set search_path='' as $$ begin
 select guarantee_fee_cents into new.amount_cents from public.appointments where id=new.appointment_id;
 return new;end;$$;
create trigger set_no_show_fee_amount before insert on public.no_show_fees for each row execute function public.set_no_show_fee_amount();
-- Existing decision permissions and revision validation are retained.
do $$ declare def text;begin
 def:=pg_get_functiondef('public.record_no_show_decision(uuid,integer,boolean,text)'::regprocedure);
 def:=replace(def,'''amount_cents'',1000','''amount_cents'',a.guarantee_fee_cents');execute def;
end;$$;
create function public.queue_percentage_guarantee_details() returns trigger language plpgsql security definer set search_path='' as $$ begin
 update public.booking_email_queue set snapshot=snapshot||jsonb_build_object('guarantee_fee_cents',new.guarantee_fee_cents) where appointment_id=new.id;
 return new;end;$$;
create trigger z_queue_percentage_guarantee_details after insert on public.appointments for each row execute function public.queue_percentage_guarantee_details();
-- The saved card remains reusable; each booking records its own fresh agreement.
do $$ declare def text;begin
 def:=pg_get_functiondef('public.book_guaranteed_appointment(integer,integer,date,integer,text,text,boolean,text,uuid,boolean,uuid,integer)'::regprocedure);
 def:=replace(def,'g.policy_version','''sandbox-no-show-50pct-v2''');execute def;
end;$$;
revoke all on function public.snapshot_booking_guarantee_fee(),public.set_no_show_fee_amount(),public.queue_percentage_guarantee_details() from public,anon,authenticated;
commit;
