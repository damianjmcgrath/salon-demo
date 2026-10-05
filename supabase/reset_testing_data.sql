-- Manual, one-off reset requested for the salon testing project. Not a migration.
-- Run after creating the three test accounts. Clears ALL appointments.
begin;
do $$ begin
 if (select count(*) from public.clients c join auth.users u on u.id=c.auth_user_id where lower(c.email) in ('jacqui@example.com','aoife@example.com','damian@example.com')) <> 3 then
  raise exception 'Create the three test client accounts before clearing appointments.';
 end if;
end $$;
update public.audit_events set appointment_id=null where appointment_id is not null;
delete from public.appointments;
create temporary table old_demo_clients on commit drop as
 select id from public.clients where name in ('Emma Demo','Grace Demo','Sophie Demo');
update public.audit_events set client_id=null where client_id in(select id from old_demo_clients);
update public.vouchers set client_id=null,assigned_client_name=null,recipient_email=null where client_id in(select id from old_demo_clients);
update public.voucher_transactions set from_client_id=null where from_client_id in(select id from old_demo_clients);
update public.voucher_transactions set to_client_id=null where to_client_id in(select id from old_demo_clients);
delete from public.client_notes where client_id in(select id from old_demo_clients);
delete from public.clients where id in(select id from old_demo_clients);
insert into public.audit_events(action,details) values('testing_data_reset','{"appointments_cleared":true,"removed_example_clients":["Emma Demo","Grace Demo","Sophie Demo"]}'::jsonb);
commit;
