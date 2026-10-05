# Prepare the salon test accounts

The interface is connected-only. These database steps must be run by the project owner; publishing the site does not execute them.

1. From the repository folder, install dependencies with `npm ci`.
2. Set `SUPABASE_SERVICE_ROLE_KEY` locally using the project's service-role key. Never paste this key into chat, browser code or GitHub.
3. Run `node scripts/create-test-clients.mjs`. The script requests password `123456` for all three accounts. Supabase's default minimum is six characters; if rejected, set `SALON_TEST_PASSWORD` to a permitted password (for example `SalonTest1234!`) and rerun. The script confirms email addresses and sets the requested names/phone numbers. It refuses to overwrite a staff login with the same email.
4. After all three report Ready, run `supabase/reset_testing_data.sql` in the Supabase SQL Editor. It deletes all appointments and the named old example clients, preserving audit records and staff data. It stops if the three clients are not ready.

Accounts: jacqui@example.com — Jacqui Durnin; aoife@example.com — Aoife Durnin; damian@example.com — Damian McGrath.

The reset does not delete Auth users belonging to the old example clients. If such Auth users exist, remove their corresponding client-only logins from Authentication > Users after checking that they are not staff accounts.
