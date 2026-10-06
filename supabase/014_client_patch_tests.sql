-- Apply after 013_staff_reports.sql.
begin;
create table public.client_patch_tests(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id),
 performed_by integer not null references public.staff(id),
 staff_name text not null,
 treatments_covered jsonb not null,
 recorded_at timestamptz not null default now(),
 recorded_by uuid not null references auth.users(id)
);
alter table public.client_patch_tests enable row level security;
create policy staff_patch_history on public.client_patch_tests for select to authenticated using(public.is_salon_staff());
grant select on public.client_patch_tests to authenticated;
create function public.record_client_patch_test(p_client uuid,p_staff integer,p_treatments integer[]) returns public.client_patch_tests
language plpgsql security definer set search_path='' as $$
declare result public.client_patch_tests;names jsonb;sname text;begin
 if not public.is_salon_staff() then raise exception 'Staff access required.';end if;
 if not exists(select 1 from public.clients where id=p_client and merged_into is null) then raise exception 'Client not found.';end if;
 select name into sname from public.staff where id=p_staff and active;
 if sname is null then raise exception 'Choose an active staff member.';end if;
 if p_treatments is null or cardinality(p_treatments)=0 or exists(select 1 from unnest(p_treatments) as chosen(treatment_id) where chosen.treatment_id is null or not exists(select 1 from public.treatments t where t.id=chosen.treatment_id)) then raise exception 'Choose valid treatments.';end if;
 select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'category',t.category) order by t.category,t.name) into names from public.treatments t where t.id=any(p_treatments);
 insert into public.client_patch_tests(client_id,performed_by,staff_name,treatments_covered,recorded_by) values(p_client,p_staff,sname,names,auth.uid()) returning * into result;
 insert into public.audit_events(user_id,client_id,action,details) values(auth.uid(),p_client,'patch_test_recorded',jsonb_build_object('patch_test_id',result.id,'staff_name',sname,'treatments_covered',names,'recorded_at',result.recorded_at));
 return result;
end; $$;
revoke all on function public.record_client_patch_test(uuid,integer,integer[]) from public;
grant execute on function public.record_client_patch_test(uuid,integer,integer[]) to authenticated;
commit;
