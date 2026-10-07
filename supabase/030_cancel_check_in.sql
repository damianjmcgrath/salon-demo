-- Apply after 029_daily_activity_report.sql. Retain the audit trail while clearing the active check-in.
begin;
create function public.cancel_appointment_check_in(p_id uuid,p_revision integer) returns public.appointments
language plpgsql security definer set search_path='' as $$
declare a public.appointments; original_time timestamptz;
begin
 perform public.require_any_permission(array['view.diary','view.appointments']);
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select * into a from public.appointments where id=p_id for update;
 if a.id is null then raise exception 'Appointment not found.';end if;
 if p_revision is null or a.revision<>p_revision then raise exception 'This appointment changed. Reload before editing.';end if;
 if a.status<>'checked_in' then raise exception 'Only checked-in appointments can have check-in cancelled.';end if;
 if exists(select 1 from public.appointment_payments where appointment_id=a.id) then raise exception 'This appointment already has recorded payments.';end if;
 original_time:=a.checked_in_at;
 update public.appointments set status='booked',checked_in_at=null,revision=revision+1 where id=a.id returning * into a;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(auth.uid(),a.client_id,a.id,'appointment_check_in_cancelled',jsonb_build_object('previous_checked_in_at',original_time,'before','checked_in','after','booked'));
 return a;
end;$$;
revoke all on function public.cancel_appointment_check_in(uuid,integer) from public;
grant execute on function public.cancel_appointment_check_in(uuid,integer) to authenticated;
commit;
