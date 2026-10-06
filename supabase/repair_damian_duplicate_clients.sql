-- Apply after 011. Scoped repair of Damian's test records; preserves originals and audits.
begin;
do $$ declare target uuid;dup public.clients;n integer;begin
 select count(*) into n from public.clients c join auth.users u on u.id=c.auth_user_id
 where lower(trim(c.email))='damian@example.com' and lower(trim(u.email))='damian@example.com' and c.merged_into is null;
 if n<>1 then raise exception 'Expected exactly one Damian client linked to his login. No changes made.';end if;
 select c.id into target from public.clients c join auth.users u on u.id=c.auth_user_id
 where lower(trim(c.email))='damian@example.com' and lower(trim(u.email))='damian@example.com' and c.merged_into is null;
 for dup in select * from public.clients where lower(trim(email))='damian@example.com' and auth_user_id is null and merged_into is null and id<>target for update loop
  update public.appointments set client_id=target,revision=revision+1 where client_id=dup.id;
  update public.client_notes set client_id=target where client_id=dup.id;
  update public.vouchers set client_id=target,assigned_client_name=(select name from public.clients where id=target),revision=revision+1 where client_id=dup.id;
  update public.clients set merged_into=target,revision=revision+1,updated_at=now() where id=dup.id;
  insert into public.audit_events(client_id,action,details) values(target,'client_duplicate_merged',jsonb_build_object('retained_client_id',target,'duplicate_before',to_jsonb(dup),'reason','Damian test proxy bookings matched by email'));
 end loop;
end; $$;
commit;
