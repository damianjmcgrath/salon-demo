-- Apply once after 025. Purchaser snapshots and authenticated staff voucher emailing.
begin;
alter table public.vouchers add column purchaser_name text,add column purchaser_email text;
create function public.snapshot_voucher_purchaser() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.purchased_by is not null then
 new.purchaser_name:=coalesce(nullif(new.purchaser_name,''),(select name from public.clients where auth_user_id=new.purchased_by and merged_into is null),(select raw_user_meta_data->>'full_name' from auth.users where id=new.purchased_by));
 new.purchaser_email:=coalesce(nullif(new.purchaser_email,''),(select email from auth.users where id=new.purchased_by));end if;return new;end;$$;
revoke all on function public.snapshot_voucher_purchaser() from public;
create trigger voucher_purchaser_snapshot before insert or update on public.vouchers for each row execute function public.snapshot_voucher_purchaser();
update public.vouchers set purchaser_name=purchaser_name where purchased_by is not null;
alter function public.create_voucher(numeric,date,uuid) rename to issue_staff_voucher;
revoke all on function public.issue_staff_voucher(numeric,date,uuid) from public,anon,authenticated;
create function public.create_voucher(p_amount numeric,p_expires_on date,p_client_id uuid default null,p_purchaser_name text default null,p_purchaser_email text default null) returns public.vouchers language plpgsql security definer set search_path='' as $$ declare v public.vouchers;begin
 perform public.require_any_permission(array['view.vouchers']);
 if length(coalesce(p_purchaser_name,''))>200 or length(coalesce(p_purchaser_email,''))>254 or (nullif(trim(p_purchaser_email),'') is not null and trim(p_purchaser_email)!~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'Enter valid purchaser details.';end if;
 v:=public.issue_staff_voucher(p_amount,p_expires_on,p_client_id);
 update public.vouchers set purchaser_name=nullif(trim(p_purchaser_name),''),purchaser_email=nullif(lower(trim(p_purchaser_email)),'') where id=v.id returning * into v;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),v.client_id,'voucher_purchaser_recorded',jsonb_build_object('voucher_id',v.id,'purchaser_name',v.purchaser_name,'purchaser_email',v.purchaser_email));return v;end;$$;
revoke all on function public.create_voucher(numeric,date,uuid,text,text) from public;
grant execute on function public.create_voucher(numeric,date,uuid,text,text) to authenticated;
create function public.managed_voucher_details(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare result jsonb;begin
 perform public.require_any_permission(array['view.vouchers']);
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 select to_jsonb(v)||jsonb_build_object('recipient_email',coalesce(c.email,v.recipient_email),'balance',(select coalesce(sum(amount),0) from public.voucher_transactions where voucher_id=v.id)-(select coalesce(sum(amount),0) from public.client_value_redemptions where voucher_id=v.id)) into result from public.vouchers v left join public.clients c on c.id=v.client_id where v.id=p_id;
 if result is null then raise exception 'Voucher not found.';end if;return result;end;$$;
revoke all on function public.managed_voucher_details(uuid) from public;
grant execute on function public.managed_voucher_details(uuid) to authenticated;
create function public.search_managed_vouchers(p_code text default '',p_client_id uuid default null,p_purchaser_name text default '',p_purchaser_email text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$ declare result jsonb;begin
 perform public.require_any_permission(array['view.vouchers']);
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if trim(coalesce(p_code,''))='' and p_client_id is null and trim(coalesce(p_purchaser_name,''))='' and trim(coalesce(p_purchaser_email,''))='' then raise exception 'Enter a voucher ID, select a client or enter purchaser details.';end if;
 select coalesce(jsonb_agg(public.managed_voucher_details(x.id) order by x.created_at desc),'[]'::jsonb) into result from (
 select v.id,v.created_at from public.vouchers v where
 (trim(coalesce(p_code,''))='' or regexp_replace(upper(v.code),'[^A-Z0-9]','','g')=regexp_replace(upper(p_code),'[^A-Z0-9]','','g')) and
 (p_client_id is null or v.client_id=p_client_id or lower(v.recipient_email)=(select lower(email) from public.clients where id=p_client_id)) and
 (trim(coalesce(p_purchaser_name,''))='' or position(lower(trim(p_purchaser_name)) in lower(coalesce(v.purchaser_name,'')))>0) and
 (trim(coalesce(p_purchaser_email,''))='' or position(lower(trim(p_purchaser_email)) in lower(coalesce(v.purchaser_email,'')))>0)
 order by v.created_at desc limit 100) x;return result;end;$$;
revoke all on function public.search_managed_vouchers(text,uuid,text,text) from public;
grant execute on function public.search_managed_vouchers(text,uuid,text,text) to authenticated;
create table public.voucher_email_requests(id uuid primary key,created_by uuid not null references auth.users(id),voucher_id uuid not null references public.vouchers(id),requested_email text not null,snapshot jsonb not null,status text not null default 'pending' check(status in('pending','accepted','failed')),resend_id text,last_error text,created_at timestamptz not null default now(),sent_at timestamptz);
alter table public.voucher_email_requests enable row level security;
revoke all on public.voucher_email_requests from public,anon,authenticated;
create function public.prepare_staff_voucher_email(p_id uuid,p_email text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare snapshot jsonb;r public.voucher_email_requests;begin
 snapshot:=public.managed_voucher_details(p_id);
 if p_request is null or p_email is null or length(trim(p_email))>254 or trim(p_email)!~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid email address.';end if;
 insert into public.voucher_email_requests(id,created_by,voucher_id,requested_email,snapshot) values(p_request,auth.uid(),p_id,lower(trim(p_email)),snapshot) on conflict(id) do nothing;
 select * into r from public.voucher_email_requests where id=p_request;
 if r.created_by<>auth.uid() or r.voucher_id<>p_id or r.requested_email<>lower(trim(p_email)) then raise exception 'Email request changed. Start a new request.';end if;return to_jsonb(r);end;$$;
revoke all on function public.prepare_staff_voucher_email(uuid,text,uuid) from public;
grant execute on function public.prepare_staff_voucher_email(uuid,text,uuid) to authenticated;
create function public.finish_staff_voucher_email(p_request uuid,p_status text,p_resend_id text default null,p_error text default null) returns void language plpgsql security definer set search_path='' as $$ declare r public.voucher_email_requests;begin
 if p_status not in('accepted','failed') then raise exception 'Invalid status.';end if;
 select * into r from public.voucher_email_requests where id=p_request for update;
 if r.id is null or r.status='accepted' then return;end if;
 update public.voucher_email_requests set status=p_status,resend_id=p_resend_id,last_error=left(p_error,500),sent_at=case when p_status='accepted' then now() end where id=r.id;
 insert into public.audit_events(user_id,client_id,action,details) values(r.created_by,(r.snapshot->>'client_id')::uuid,'voucher_email_'||p_status,jsonb_build_object('voucher_id',r.voucher_id,'request_id',r.id,'requested_email',r.requested_email,'actual_recipient','damianjmcgrath@gmail.com','resend_id',p_resend_id));end;$$;
revoke all on function public.finish_staff_voucher_email(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_staff_voucher_email(uuid,text,text,text) to service_role;
-- Include manually recorded non-client buyers in Voucher Status too.
do $$ declare def text;begin select pg_get_functiondef(oid) into def from pg_proc where pronamespace='public'::regnamespace and proname='get_voucher_status_report';
 def:=replace(def,'case when v.purchased_by is null then ''Not recorded'' else coalesce(nullif(b.name,''''),nullif(u.raw_user_meta_data->>''full_name'',''''),u.email,''Not recorded'') end','coalesce(nullif(v.purchaser_name,''''),nullif(v.purchaser_email,''''),nullif(b.name,''''),nullif(u.raw_user_meta_data->>''full_name'',''''),u.email,''Not recorded'')');execute def;end;$$;
commit;
