# Sculpted salon system

React, TypeScript and Vite with Supabase Auth, PostgreSQL and server-side booking functions. This is a development proof of concept with fictional clients and simulated guarantees; it is not a live salon replacement.

- Client entry: https://damianjmcgrath.github.io/salon-demo/
- Staff entry (bookmark this): https://damianjmcgrath.github.io/salon-demo/?portal=staff

A future dedicated staff subdomain can serve this entry point. No custom domain or DNS has been configured. Every privileged operation checks the caller's database role, independently of the URL.

## Updating the existing development database

Apply `supabase/005_staff_flow.sql` once in the Supabase SQL Editor, **after 004**. Do not rerun earlier migrations. For a brand-new environment, apply 001–005 in order. Migration 005 adds independent client records, notes, date-specific breaks, appointment revisions and audited staff operations; it backfills existing demo appointments without changing their original contact/price snapshots.

After applying 005, map each operational account to its diary column. Find its UUID under Authentication → Users, then substitute the UUID and correct column ID below:

```sql
-- Diary columns: 1 = Aoife, 2 = Demo Therapist A, 3 = Demo Therapist B.
-- Change the UUID and staff_id before running. Map each staff member separately.
update public.staff_users
set staff_id = 1
where user_id = 'REPLACE_WITH_AUTH_USER_UUID'::uuid
  and role in ('staff','admin','it_support');
```

A diary column can have one mapped account. An unmapped staff account can manage appointments and clients but cannot change personal breaks. The mapping is explicit; names, selected tiles and editable user metadata never determine a live staff member's identity. `can_manage_own_breaks` defaults to true and can be turned off by trusted database administration. Owner/IT break administration and HR reporting will be built with those role flows.

Existing role assignments remain unchanged. Staff accounts must already have `staff_users` membership; new public registrations remain clients. Accountant access stays reporting-only. To assign an account's role through trusted database administration:

```sql
insert into public.staff_users(user_id,role)
values ('REPLACE_WITH_AUTH_USER_UUID'::uuid,'staff')
on conflict(user_id) do update set role=excluded.role;
```

Use `admin`, `accountant` or `it_support` instead when appropriate. Sign out and back in after changing an assignment. Never put a password or server secret in this SQL or the frontend.

## Staff walkthrough

Switch to **Local demo mode** at the top of the staff entry page to try the complete fictional-data workflow without database setup. Click a profile and use demo PIN **1234**. This PIN is a preview only: it does not authenticate a Supabase account. In connected mode, tiles lead to individual email/password authentication. A real short-PIN flow needs a trusted-device service with server-side attempt limits and independent staff sessions; it is intentionally not implemented as an internet-facing password substitute.

After sign-in, staff home has **Appointment Management**, **Client Administration** and **Staff Diary**.

- Existing-client bookings use name/email/phone search, then the treatment, time, demo guarantee and confirmation screens. Multiple search fields narrow matches using all supplied criteria; phone searches ignore formatting. Connected search returns at most 100 results, so refine broad searches.
- New-client bookings first create an independent client record. A login is optional; creating a record never requires signing the staff member out or registering the client in the staff browser session.
- Amend and cancel workflows show the selected client's open bookings. Amendments revalidate duration, skills, rota, breaks and overlap while excluding the original booking itself. A date/time/staff-only move retains the original price; choosing another treatment uses its current price. Before/after values and an explanatory reason are recorded. Revision checks reject stale edits.
- Client Administration supports contact changes, authored/timestamped notes, booking history, future bookings and change history. Contact email is independent of the client's verified sign-in email. Existing appointments retain their original booking contact details.
- Staff Diary opens today in Dublin time, with previous/next day arrows and a date picker. Staff see appointment and completion counts, without Recorded takings. Opening an appointment supports check-in, payment-method recording, amendment, cancellation, client record access and a reasoned no-show action. Future appointments cannot be marked no-show in connected mode. No-show cards are red; no guarantee is charged in this iteration.
- Lunch defaults to 13:00–13:30. Staff can click only their own lunch and can add their own additional break. Changes affect the selected date, must fit the working day, cannot overlap appointments/other breaks, and change booking availability. Cancelled appointments release their slot; no-show records retain their diary slot and history.
- **Switch profile / lock** clears the current session and visible records. The staff entry uses a separate tab-session auth store from the client entry. The UI signs staff out after five minutes without input. This assists shared-computer use; production session/device controls still require hardening.

Local demo data persists in this browser. It is not protected server data and must remain fictional. Local sample bookings use the current working day; local mode permits past time slots for demonstrations. Connected booking functions allow future slots only.

## Optional temporary-password client logins

Client records and bookings work after migration 005 without an Edge Function. To create **real Supabase demo logins** using the optional temporary-password field, also deploy `supabase/functions/create-client-account/index.ts`:

1. In the development project's Edge Functions area, create a function named `create-client-account`, paste that file's source into its editor, and deploy it. Alternatively, use the Supabase CLI with this repository's `supabase/config.toml`.
2. The function validates the bearer token with Supabase Auth and checks staff membership itself. Disable the platform's legacy JWT-verification toggle for this function, as configured in `supabase/config.toml`; do not remove the function's authentication checks.
3. Add the Edge Function secret `SALON_DEMO_ACCOUNT_PROVISIONING=true`. This is off by default and is for **fictional development accounts only**. The server auto-confirms those fictional emails and sends no messages. Do not enable this workflow for production clients; use verified activation/password-setting links instead.
4. The default allowed browser origin is `https://damianjmcgrath.github.io`. If hosting changes, set `SALON_ALLOWED_ORIGINS` to the allowed origins, separated by commas, without paths.
5. Supabase supplies the server's project/service credentials in the function environment. Do not paste them into the app, repository or chat.

Temporary passwords are passed only to Supabase Auth through the server function, never stored in client records, notes or audit details. They require 12–128 characters. The first client sign-in shows a password-change screen. A trusted Auth app-metadata flag is cleared by the server only when it changes the password; a pending initial password change also blocks self-booking in PostgreSQL.

Provisioning is reserved per client to prevent duplicate creation. A failed account creation retains the client record so it can be retried from that record, without creating a duplicate client. An existing login with the same email is never silently attached. Staff authentication stays unchanged. Test this deployed Edge Function with fictional accounts before demonstrating connected provisioning; local database tests cannot establish hosted Auth/Edge integration.

## Client journey and catalogue

The client entry asks for sign-in or account creation first, followed by self/someone-else selection. Proxy bookings collect attendee name, email and phone; their history is not searched. Previous Bookings lists completed self treatments only. Staff bookings tied to a client's login also appear in their own history.

Morning is 08:00–11:59 and afternoon starts at 12:00. Demo opening hours remain Monday–Saturday 09:00–17:00. Start grids are hourly for 60 minutes, half-hourly for 30, and quarterly for 15. Other provisional durations use quarter-hour starts; short patch-test services use 5-minute starts. These additional-duration assumptions need salon confirmation.

The 111 treatments/prices in `data/treatments.csv` and `src/catalog.json` came from the salon's Phorest catalogue. Duration, working-hour and qualification values are provisional demo assumptions. Patch-test mappings and the full patch-test workflow remain unimplemented; a treatment marked patch-required is rejected rather than bypassing that restriction.

Booking guarantees use saved/new **example** cards, a €10 policy snapshot and consent. No real PAN, CVV, payment token, charge or email is collected/sent. The late-cancellation deadline and payment-provider integration remain to be agreed. Voucher/credit checkout options are payment-method labels, without a financial ledger.

## Development and validation

```sh
npm ci
npm test
npm run build
npm run dev
```

Local Supabase configuration goes into `.env.local` using `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. GitHub Actions supplies those public browser values when building. Server/service keys never belong in Vite variables.

Tests cover availability/periods, roles, search, breaks, date navigation and appointment statuses; offline DOM tests exercise the actual React staff forms and journeys. PostgreSQL tests use PGlite with a minimal Supabase Auth schema and the real migrations, functions, RLS policies and exclusion constraint. They verify audited staff booking, double-booking rejection, client/accountant denial, stale edits, cancellations, amendments, personal breaks, no-shows, self/proxy booking and account-link reservations. These tests do not replace hosted Supabase Auth, Edge deployment, real browser layout or concurrent multi-connection acceptance checks.

GitHub Pages deploys the fictional demo on pushes to main. Production hosting, device/PIN security, recovery/verification, retention, backups, provider terms and operational cutover remain separate work. Use a separate production environment before introducing real salon data.

## Voucher, attendance and three-profile update

Apply `supabase/006_vouchers_clock_profiles.sql` once in the Supabase SQL editor, after migration 005. It adds voucher issuance/transfer history, attendance records and the three portal profiles. Other example memberships become inactive, and retired therapist rows are retained for historical bookings.

Link the actual Auth users to the profiles in `staff_users` (use their Auth UUIDs; profile names do not create login credentials):

| Profile | role | staff_id | profile_key | active |
|---|---|---|---|---|
| Aoife | admin | 1 | aoife | true |
| Leah | staff | 2 | leah | true |
| Jacqui | accountant | NULL | jacqui | true |

Only an existing admin mapped to diary column 1 and an existing staff member mapped to column 2 are automatically retained. Verify that these are the intended people before testing. Update the other memberships or insert the matching Auth UUID for Jacqui. There is one active account per profile. Do not put real passwords into client records. Redeploy `create-client-account` if using temporary client login provisioning; its permission check now rejects inactive accounts.

Connected mode continues to use individual Supabase email/password authentication. Profile tiles are navigation, not authorization. Local preview uses PIN `1234` for each fictional profile. Aoife has six tiles, Leah four, and Jacqui only Reporting. Staff Administration and Reporting are placeholders, with the existing daily report available from Reporting.

Clock times are generated by the server, one open shift per staff member, and cannot be edited through the browser. Voucher transfers preserve the ID, expiry and value, update the printed recipient and retain the previous assignment in the audit history. Redemption and payment collection remain for the later checkout iteration.
