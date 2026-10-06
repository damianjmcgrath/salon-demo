-- Apply after 010. Match proxy attendees by contact email, retaining the booking creator.
begin;
alter table public.clients add column if not exists merged_into uuid references public.clients(id);
create or replace function public.attach_booking_client() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;mail text;begin
 if new.client_id is not null then return new;end if;
 if new.booked_for_self then
  cid:=public.ensure_own_client();
 else
  mail:=lower(trim(coalesce(new.attendee_email,'')));
  if mail<>'' then
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('salon-client-email:'||mail,0));
   if (select count(*) from public.clients where lower(trim(email))=mail and merged_into is null and auth_user_id is not null)>1 then
    raise exception 'Multiple client accounts use this email. Please contact the salon.';
   end if;
   select id into cid from public.clients where lower(trim(email))=mail and merged_into is null
    order by (auth_user_id is not null) desc,created_at,id limit 1;
  end if;
  if cid is null then
   insert into public.clients(name,email,phone) values(new.client_name,mail,new.phone) returning id into cid;
  end if;
 end if;
 new.client_id:=cid;return new;
end; $$;
-- Attendees can read bookings linked to their authenticated client record, never by an unverified email supplied in the browser.
drop policy diary_read on public.appointments;
create policy diary_read on public.appointments for select to authenticated using(
 public.is_salon_staff() or (
  not exists(select 1 from public.staff_users u where u.user_id=auth.uid() and u.role='accountant')
  and (user_id=auth.uid() or client_id in(select c.id from public.clients c where c.auth_user_id=auth.uid() and c.merged_into is null))
 )
);
create function public.get_my_appointments() returns setof public.appointments language plpgsql security definer set search_path='' as $$
declare cid uuid;begin
 cid:=public.ensure_own_client();
 return query select a.* from public.appointments a where a.user_id=auth.uid() or a.client_id=cid order by a.appointment_date desc,a.start_minute;
end; $$;
revoke all on function public.get_my_appointments() from public;
grant execute on function public.get_my_appointments() to authenticated;
create or replace function public.search_clients(p_name text default '',p_email text default '',p_phone text default '') returns setof public.clients language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_salon_staff() then raise exception 'Staff access required.'; end if;
 if trim(coalesce(p_name,''))='' and trim(coalesce(p_email,''))='' and trim(coalesce(p_phone,''))='' then raise exception 'Enter at least one search field.';end if;
 return query select c.* from public.clients c where c.merged_into is null and
 (trim(coalesce(p_name,''))='' or strpos(lower(c.name),lower(trim(p_name)))>0) and
 (trim(coalesce(p_email,''))='' or strpos(lower(c.email),lower(trim(p_email)))>0) and
 (trim(coalesce(p_phone,''))='' or strpos(regexp_replace(c.phone,'[^0-9]','','g'),regexp_replace(p_phone,'[^0-9]','','g'))>0)
 order by c.name,c.created_at limit 100;
end; $$;
create or replace function public.create_client(p_name text,p_email text,p_phone text) returns public.clients language plpgsql security definer set search_path='' as $$
declare c public.clients;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if length(trim(coalesce(p_name,'')))=0 or coalesce(p_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'))<5 then raise exception 'Valid name, email and phone are required.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('salon-client-email:'||lower(trim(p_email)),0));
 if exists(select 1 from public.clients where lower(trim(email))=lower(trim(p_email)) and merged_into is null) then raise exception 'A client with this email already exists. Search for the existing client.';end if;
 insert into public.clients(name,email,phone) values(trim(p_name),lower(trim(p_email)),trim(p_phone)) returning * into c;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),c.id,'client_created',jsonb_build_object('after',to_jsonb(c)));
 return c;
end; $$;
commit;
