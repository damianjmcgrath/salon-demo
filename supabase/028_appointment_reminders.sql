-- Apply after 027_client_communications.sql.
begin;
create table public.appointment_reminder_requests(
 id uuid primary key,created_by uuid not null references auth.users(id),appointment_id uuid not null references public.appointments(id),
 client_id uuid not null references public.clients(id),requested_email text not null,snapshot jsonb not null,
 status text not null default 'pending' check(status in('pending','accepted','failed')),resend_id text,last_error text,created_at timestamptz not null default now(),sent_at timestamptz
);
alter table public.appointment_reminder_requests enable row level security;
revoke all on public.appointment_reminder_requests from public,anon,authenticated;
create function public.prepare_appointment_reminder(p_id uuid,p_email text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.appointments;r public.appointment_reminder_requests; snapshot jsonb;
begin
 perform public.require_any_permission(array['view.diary','view.appointments']);
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if p_request is null or p_email is null or length(trim(p_email))>254 or trim(p_email)!~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid email address.';end if;
 select * into a from public.appointments where id=p_id;
 if a.id is null or a.client_id is null then raise exception 'Appointment not found.';end if;
 select * into r from public.appointment_reminder_requests where id=p_request;
 if r.id is not null then
  if r.created_by<>auth.uid() or r.appointment_id<>p_id or r.requested_email<>lower(trim(p_email)) then raise exception 'Email request changed. Start a new request.';end if;
  if r.status='accepted' then return to_jsonb(r);end if;
 end if;
 if a.status not in('booked','checked_in') then raise exception 'Only active appointments can receive reminders.';end if;
 snapshot:=to_jsonb(a)||jsonb_build_object('staff_name',(select name from public.staff where id=a.staff_id));
 insert into public.appointment_reminder_requests(id,created_by,appointment_id,client_id,requested_email,snapshot) values(p_request,auth.uid(),a.id,a.client_id,lower(trim(p_email)),snapshot) on conflict(id) do nothing;
 select * into r from public.appointment_reminder_requests where id=p_request;
 if r.created_by<>auth.uid() or r.appointment_id<>p_id or r.requested_email<>lower(trim(p_email)) then raise exception 'Email request changed. Start a new request.';end if;
 return to_jsonb(r);
end;$$;
revoke all on function public.prepare_appointment_reminder(uuid,text,uuid) from public;
grant execute on function public.prepare_appointment_reminder(uuid,text,uuid) to authenticated;
create function public.finish_appointment_reminder(p_request uuid,p_status text,p_resend_id text default null,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare r public.appointment_reminder_requests;
begin
 if p_status is null or p_status not in('accepted','failed') then raise exception 'Invalid status.';end if;
 select * into r from public.appointment_reminder_requests where id=p_request for update;
 if r.id is null then raise exception 'Reminder request not found.';end if;
 if r.status='accepted' then return;end if;
 if p_status='accepted' and nullif(p_resend_id,'') is null then raise exception 'Provider reference required.';end if;
 update public.appointment_reminder_requests set status=p_status,resend_id=p_resend_id,last_error=left(p_error,500),sent_at=case when p_status='accepted' then now() end where id=r.id;
 if p_status='accepted' then
 insert into public.client_communications(client_id,communication_type,note,staff_name,recorded_by)
 values(r.client_id,'Email','Appointment reminder sent for '||(r.snapshot->>'treatment_name')||' on '||to_char((r.snapshot->>'appointment_date')::date,'DD/MM/YYYY')||' '||lpad(((r.snapshot->>'start_minute')::integer/60)::text,2,'0')||':'||lpad(((r.snapshot->>'start_minute')::integer%60)::text,2,'0')||'. Requested recipient: '||r.requested_email||'. Test delivery: damianjmcgrath@gmail.com.','SYSTEM',r.created_by);
 end if;
 insert into public.audit_events(user_id,client_id,appointment_id,action,details) values(r.created_by,r.client_id,r.appointment_id,'appointment_reminder_'||p_status,jsonb_build_object('request_id',r.id,'requested_email',r.requested_email,'actual_recipient','damianjmcgrath@gmail.com','resend_id',p_resend_id));
end;$$;
revoke all on function public.finish_appointment_reminder(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_appointment_reminder(uuid,text,text,text) to service_role;
commit;
