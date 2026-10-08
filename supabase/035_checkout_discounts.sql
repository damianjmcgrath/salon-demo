-- Apply after 034_reporting_payment_dates.sql.
begin;
create table public.appointment_discounts (
 id uuid primary key default gen_random_uuid(),appointment_id uuid not null references public.appointments(id),
 original_price numeric(10,2) not null,discounted_price numeric(10,2) not null,
 discount_percentage numeric(7,4) not null,staff_id integer not null references public.staff(id),staff_name text not null,
 recorded_by uuid not null references auth.users(id),recorded_at timestamptz not null default now()
);
alter table public.appointment_discounts enable row level security;
create function public.apply_appointment_discount(p_id uuid,p_revision integer,p_price numeric) returns public.appointments
language plpgsql security definer set search_path='' as $$
declare a public.appointments; original numeric; sid integer; sname text;
begin
 perform public.require_any_permission(array['perform.discounts']);
 select * into a from public.appointments where id=p_id for update;
 if a.id is null or a.status<>'checked_in' then raise exception 'Only checked-in appointments can be discounted.';end if;
 if a.revision is distinct from p_revision then raise exception 'Appointment changed. Reload before applying a discount.';end if;
 select d.original_price into original from public.appointment_discounts d where d.appointment_id=a.id order by d.recorded_at,d.id limit 1;
 original:=coalesce(original,a.price);
 if p_price is null or p_price::text in ('NaN','Infinity','-Infinity') or p_price<0 or p_price>=a.price or p_price<>round(p_price,2) or original<=0 then raise exception 'Enter a lower price between zero and the current total, with at most two decimal places.';end if;
 select s.id,s.name into sid,sname from public.staff_users u join public.staff s on s.id=u.staff_id where u.user_id=auth.uid() and u.active and s.active;
 if sid is null then raise exception 'Active staff profile required.';end if;
 insert into public.appointment_discounts(appointment_id,original_price,discounted_price,discount_percentage,staff_id,staff_name,recorded_by)
 values(a.id,original,p_price,round((original-p_price)*100/original,4),sid,sname,auth.uid());
 update public.appointments set price=p_price,revision=revision+1 where id=a.id returning * into a;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,'appointment_discount_applied',jsonb_build_object('original_price',original,'discounted_price',p_price,'staff_name',sname));
 return a;
end;$$;
create function public.get_discounts_report(p_from date default null,p_to date default null,p_staff integer default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 perform public.require_any_permission(array['view.reporting']);
 if (p_from is null)<>(p_to is null) or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of up to ten years.';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.recorded_at desc,q.id),'[]'::jsonb) into result from (
 select d.*,coalesce(c.name,a.client_name) client_name,coalesce(c.email,a.attendee_email,'') client_email,a.treatment_name
 from public.appointment_discounts d join public.appointments a on a.id=d.appointment_id left join public.clients c on c.id=a.client_id
 where (p_from is null or (d.recorded_at at time zone 'Europe/Dublin')::date between p_from and p_to) and (p_staff is null or d.staff_id=p_staff)
 order by d.recorded_at desc,d.id limit case when p_from is null then 25 else null end
 ) q;return result;
end;$$;
create function public.get_discount_report_staff() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform public.require_any_permission(array['view.reporting']);return (select coalesce(jsonb_agg(to_jsonb(q) order by q.name),'[]'::jsonb) from (select s.id,s.name from public.staff s where s.active or exists(select 1 from public.appointment_discounts d where d.staff_id=s.id)) q);end;$$;
revoke all on function public.apply_appointment_discount(uuid,integer,numeric),public.get_discounts_report(date,date,integer),public.get_discount_report_staff() from public;
grant execute on function public.apply_appointment_discount(uuid,integer,numeric),public.get_discounts_report(date,date,integer),public.get_discount_report_staff() to authenticated;
commit;
