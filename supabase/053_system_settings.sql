begin;
create table public.salon_system_settings(id boolean primary key default true check(id),staff_timeout_seconds integer not null default 300 check(staff_timeout_seconds between 30 and 86400),currency text not null default 'EUR' check(currency in('EUR','GBP')),allow_booking_for_others boolean not null default true,confirmation_delivery text not null default 'email' check(confirmation_delivery in('email','email_whatsapp','whatsapp')),amendment_delivery text not null default 'email' check(amendment_delivery in('email','email_whatsapp','whatsapp')),cancellation_delivery text not null default 'email' check(cancellation_delivery in('email','email_whatsapp','whatsapp')),voucher_delivery text not null default 'email' check(voucher_delivery in('email','email_whatsapp','whatsapp')),revision integer not null default 0);
insert into public.salon_system_settings(id) values(true);
alter table public.salon_system_settings enable row level security;
revoke all on public.salon_system_settings from public,anon,authenticated;
create function public.get_system_settings() returns jsonb language sql stable security definer set search_path='' as $$ select to_jsonb(s)-'id' from public.salon_system_settings s where id; $$;
create function public.save_system_settings(p_settings jsonb,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$ declare old public.salon_system_settings;updated public.salon_system_settings;begin
 perform public.require_any_permission(array['view.permissions']);
 select * into old from public.salon_system_settings where id for update;
 if old.revision is distinct from p_revision then raise exception 'Settings changed. Reload before saving.';end if;
 update public.salon_system_settings set staff_timeout_seconds=(p_settings->>'staff_timeout_seconds')::integer,currency=p_settings->>'currency',allow_booking_for_others=(p_settings->>'allow_booking_for_others')::boolean,confirmation_delivery=p_settings->>'confirmation_delivery',amendment_delivery=p_settings->>'amendment_delivery',cancellation_delivery=p_settings->>'cancellation_delivery',voucher_delivery=p_settings->>'voucher_delivery',revision=revision+1 where id returning * into updated;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'system_settings_changed',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(updated)));
 return to_jsonb(updated)-'id';end;$$;
revoke all on function public.get_system_settings(),public.save_system_settings(jsonb,integer) from public;
grant execute on function public.get_system_settings() to anon,authenticated;
grant execute on function public.save_system_settings(jsonb,integer) to authenticated;
create function public.enforce_recipient_setting() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is not null and not public.is_salon_staff() and not new.booked_for_self and not (select allow_booking_for_others from public.salon_system_settings where id) then raise exception 'Online bookings for someone else are disabled. Please contact the salon.';end if;return new;end;$$;
revoke all on function public.enforce_recipient_setting() from public,anon,authenticated;
create trigger a_system_recipient_setting before insert on public.appointments for each row execute function public.enforce_recipient_setting();
commit;
