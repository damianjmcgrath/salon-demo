-- Sandbox-only test records. No appointments or real client records are changed.
begin;
create table if not exists public.revolut_sandbox_tests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 setup_order_id text not null unique,
 charge_order_id text,
 charge_attempted boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.revolut_sandbox_tests enable row level security;
revoke all on public.revolut_sandbox_tests from anon, authenticated;
grant all on public.revolut_sandbox_tests to service_role;
commit;
