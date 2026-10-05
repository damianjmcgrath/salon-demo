# Sculpted Salon — first working slice

React + TypeScript + Vite, with optional Supabase authentication and PostgreSQL persistence. This repository is the development proof of concept, not a live salon replacement.

## Role-aware login update

Existing installations: run ONLY `supabase/003_roles.sql` in the SQL Editor. Do not rerun `001_schema.sql`. New installations run 001, 002, then 003.

The published app now starts in connected mode with a sign-in page. Public treatment browsing remains available. Existing confirmed accounts still work; existing staff role assignments are preserved. Client sign-up, email confirmation, password reset and role-based landing pages are implemented. Configure the exact deployed URL under Authentication → URL Configuration, both as Site URL and an allowed Redirect URL, before using confirmation/reset emails. Do not disable email confirmation to work around delivery issues.

| Role          | Landing page      | Available experience                                                     |
| ------------- | ----------------- | ------------------------------------------------------------------------ |
| Client        | My appointments   | Book treatments and view own booking history                             |
| Staff         | Salon diary       | Check in, complete and cancel appointments                               |
| Owner / Admin | Administration    | Diary, reports and administration overview                               |
| Accountant    | Reports           | Completed-treatment report only; no operational diary or booking writes  |
| IT Support    | Support workspace | Same current operational access as owner, separate account/role identity and audit role snapshot |

Admin screens beyond the overview are still future work. No role can manage users from the application yet. Access comes from `staff_users`, never editable client metadata or a live role selector. Accounts with no staff membership are clients. Invalid roles and permission-loading failures do not open a staff workspace.

### Provision staff and privileged demo accounts

Create each account using Supabase Authentication → Users (Add user / send invitation, depending on your dashboard). The person sets their own password or uses Forgot password with their email. Alternatively, have the person create and confirm a client account first, then assign their salon role. Do not share passwords in chat or put them into SQL.

Use the Auth user's UUID to assign ONE appropriate role in SQL:

```sql
insert into public.staff_users(user_id,role)
values ('AUTH-USER-UUID', 'admin')
on conflict (user_id) do update set role=excluded.role;
```

Replace `admin` with `staff`, `accountant`, or `it_support` as appropriate. Remove a membership to return an account to client permissions. Role changes should be followed by sign-out and sign-in to reload the workspace. Never let customers submit this SQL or choose their own privileged role. Account-level authorisation changes take effect in database checks even before the old UI refreshes.

On a shared computer, use **Sign out / lock** before changing staff. This ends the browser's session and clears the visible client/diary state. It is full sign-out, not a PIN-based account switch. Local role preview remains available through the mode toggle; it uses fictional browser-local data and never changes Supabase permissions.

### Verify the role update

Use separate accounts for each role: confirm client access to own bookings only; staff diary access without report navigation; accountant completed reports with diary/status-change/booking API denial; owner and IT access to diary/reports; sign-out removes the session and visible records; recovery links allow password change and require fresh sign-in afterwards. Client registration must not create a `staff_users` row. Automated tests cover the frontend access matrix; hosted authentication/RLS/recovery checks must be performed after applying 003.

## What works

- All 111 publicly listed services in 10 categories, with exact displayed prices and “From” indicators.
- Search and category browsing; staff preference and calculated availability on one screen.
- Fictional local booking and shared Supabase booking modes.
- A day diary with working hours, lunch breaks, appointment details and status colours.
- Check in, complete with recorded payment method, cancel, and daily recorded takings.
- In Supabase mode: individual email/password accounts; customer/staff read permissions; server-side availability revalidation; database overlap constraint; treatment price/name/duration snapshots; basic booking/status audit events.

## Demo assumptions and boundaries

The catalogue was extracted on 4 October 2026 from https://www.phorest.com/salon/sculptedbyaoifeclaire/book/service-selection?showSpecialOffers=false. Original categories, spelling, similar names and package/course listings are preserved. The source CSV is `data/treatments.csv`.

Durations are provisional by category, not sourced from Phorest. Aoife plus two fictional therapists are seeded. All are provisionally qualified for every service. Opening hours are Monday–Saturday 09:00–17:00, with 13:00–13:30 lunch. Sunday is closed. Verify all these assumptions with the salon.

Patch-test mappings are not configured; seeded treatments have `patch_required=false`. If this is changed to true, the booking function rejects that service until the full patch-test workflow is implemented. This version does NOT prove patch-test compliance. Real payments, card collection, email reminders, social sign-in, client notes, rota/admin editing, HR reporting, voucher/credit ledgers, migration and production hardening are later milestones. Voucher/credit checkout buttons record a label only; they do not redeem balances. “From” prices use the displayed starting amount for demo totals.

Local mode is visibly labelled, saves only to this browser's localStorage and is not shared across devices. Supabase mode saves to the development project. Switch using the button at the top. Use fictional client details in both modes. The simulated card indicator never collects or charges a card. The diary does not update automatically across browsers; use Refresh in Supabase mode.

## Run on your computer

Install Node.js 22 LTS or newer and clone this repository. In its folder:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

On Windows you can copy `.env.example` to `.env.local` in File Explorer instead. Open the local URL Vite prints. Without `.env.local`, local demo mode still works and the Supabase toggle is disabled. With it, the toggle is available and connected sign-in mode is the default.

The configured project URL and publishable key are browser-safe identifiers. NEVER put a database password, Supabase secret key or service-role key in `VITE_*`, source code, GitHub or the browser.

## Set up your Supabase development database

1. Open the `salon-system` development project in Supabase and go to **SQL Editor**.
2. Run `supabase/001_schema.sql` once in the new empty project. It is transactional and is not a repeatable reset script.
3. Run `supabase/002_seed.sql`, then `supabase/003_roles.sql`. It imports the services and fictional schedules/skills, with conflict guards.
4. In **Authentication → URL Configuration**, set Site URL to the local app URL initially, or the exact published GitHub Pages URL once available. Add both your local URL and the published URL to allowed redirect URLs for email confirmations. Keep email confirmation enabled.
5. Use Supabase mode in the app to create an account through the booking confirmation screen. Confirm its email, then sign in.
6. To give YOUR account staff access, find its UUID in **Authentication → Users**. Run this in the SQL Editor, substituting that UUID:

```sql
insert into public.staff_users(user_id,role)
values ('YOUR-AUTH-USER-UUID', 'admin');
```

Ordinary customer accounts must not be added here. Membership is only editable through trusted database administration in this first slice; customers cannot assign themselves roles. Sign out and back in after adding membership. Staff/admin/IT Support share the first-slice diary actions. Apply 003 for differentiated navigation and accountant reporting access.

No client-side direct INSERT/UPDATE/DELETE grants are provided. Bookings and lifecycle changes use guarded database functions. Availability returns staff/time slots without other clients' details. Customers can read their own appointments; only staff can read the full diary. Tables explicitly have RLS and select grants so this works with “Automatically expose new tables” disabled.

## Publish the fictional-data demo on GitHub Pages

In this repository go to **Settings → Pages → Build and deployment → Source → GitHub Actions**. Then go to **Actions → Build and deploy salon demo → Run workflow** on `main`.

The workflow installs the locked dependencies, runs availability tests, builds the application and deploys `dist`. It contains only the supplied public project URL/publishable key. GitHub reports the actual deployed URL. The Vite base path is `/salon-demo/`; if you rename the repository, update `vite.config.ts`. Routes use application state, avoiding GitHub Pages deep-link 404s.

If workflow creation is unavailable through the connector, upload the provided `pages-workflow.yml` template as `.github/workflows/pages.yml` using your GitHub account first.

Use GitHub Pages for this fictional-data demonstration only. Reassess hosting for a production salon application, including the hosting provider's terms and the operational requirements.

## Walkthrough for the owner

1. Start in local mode and choose a treatment (for example BIAB).
2. Choose no preference, a weekday and a free time.
3. Enter a fictional name; acknowledge the simulated guarantee; confirm.
4. Open the salon diary. Select the new booking, check in, then complete with cash/card.
5. Open Daily overview and check the recorded total.
6. Repeat in Supabase mode after setup to demonstrate persistent shared bookings. A second signed-in browser will see the same data after Refresh, while a customer account cannot access the diary.

Local sample bookings initially appear on the current day (or Monday if today is Sunday). Local mode deliberately permits demonstration of earlier times; Supabase mode permits only future times in the Europe/Dublin timezone.

## Validation

```sh
npm test
npm run build
```

Tests cover overlap boundaries, adjacent appointments, breaks, closing time, no preference and cancellation. Before showing Supabase mode, verify: customer diary denial, staff access, two bookings competing for the same slot, cancellation freeing time, and a catalogue price change leaving old bookings unchanged. The SQL must be executed and these integration checks completed in the configured Supabase development project; frontend build/tests alone do not establish database integration.

Database definitions, access policies and seed data are stored in this repository so future environments can be reproduced. Create a separate production project before using real salon data.


### Client journey update
Apply `supabase/004_client_booking_flow.sql` once, after 003. Client sign-in opens the recipient choice; completed self bookings supply the Previous Bookings filter. Proxy bookings remain owned by the booking account, with separate attendee contact details. No other person's history is looked up.

Morning is 08:00–11:59, afternoon starts at 12:00. Demo rotas still open 09:00–17:00. Start grids: 60 minutes hourly, 30 half-hourly, 15 quarterly. For other provisional durations, 15-minute starts are used (5-minute patch tests use 5-minute starts), pending salon confirmation. Server availability enforces the same grid and preserves breaks, qualification and overlap checks.

Guarantees are simulated with saved/new example cards, €10 policy snapshot and consent. No real PAN, CVV or payments are collected. Real saved cards and secure new-card entry require payment-provider integration; the late-cancellation deadline is unconfirmed. Existing historic appointments are treated as self bookings; their guarantee/email fields remain unknown.
