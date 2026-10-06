-- Repair backend read permissions for the Sandbox guarantee worker.
-- This grants only the columns it reads, to the private server role.
-- Browser/client permissions and row-level security remain unchanged.
begin;
grant select (id, name, email) on public.clients to service_role;
grant select (id, status, guarantee_card_id) on public.appointments to service_role;
commit;
