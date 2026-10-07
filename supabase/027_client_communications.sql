-- Apply after 026_voucher_find_email.sql.
begin;
create table public.client_communications (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id),
 communication_type text not null check (communication_type in ('Phone Call','Email','WhatsApp','In Person')),
 note text not null check (length(trim(note)) between 1 and 5000),
 staff_name text not null,
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now()
);
create index client_communications_history on public.client_communications(client_id,recorded_at desc);
alter table public.client_communications enable row level security;
revoke all on public.client_communications from anon,authenticated;
grant select on public.client_communications to authenticated;
create policy staff_communication_history on public.client_communications for select to authenticated
 using (public.is_salon_staff() and public.has_permission('view.clients'));
create function public.record_client_communication(p_client uuid,p_type text,p_note text) returns public.client_communications
language plpgsql security definer set search_path='' as $$
declare result public.client_communications; sname text;
begin
 perform public.require_any_permission(array['view.clients']);
 if not public.is_salon_staff() then raise exception 'Staff access required.'; end if;
 if not exists(select 1 from public.clients where id=p_client and merged_into is null) then raise exception 'Client not found.'; end if;
 select s.name into sname from public.staff_users u join public.staff s on s.id=u.staff_id where u.user_id=auth.uid() and u.active and s.active;
 if sname is null then raise exception 'Active staff profile required.'; end if;
 if p_type is null or p_type not in ('Phone Call','Email','WhatsApp','In Person') then raise exception 'Choose a valid communication type.'; end if;
 if p_note is null or length(trim(p_note)) not between 1 and 5000 then raise exception 'Enter communication notes (maximum 5000 characters).'; end if;
 insert into public.client_communications(client_id,communication_type,note,staff_name,recorded_by)
 values(p_client,p_type,trim(p_note),sname,auth.uid()) returning * into result;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),p_client,'client_communication_recorded',to_jsonb(result));
 return result;
end; $$;
revoke all on function public.record_client_communication(uuid,text,text) from public;
grant execute on function public.record_client_communication(uuid,text,text) to authenticated;
commit;
