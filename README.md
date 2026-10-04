# Sculpted Salon — first working slice

React + TypeScript + Vite, with optional Supabase authentication and PostgreSQL persistence. This repository is the development proof of concept, not a live salon replacement.

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

On Windows you can copy `.env.example` to `.env.local` in File Explorer instead. Open the local URL Vite prints. Without `.env.local`, local demo mode still works and the Supabase toggle is disabled. With it, the toggle is available but local mode remains the default until selected.

The configured project URL and publishable key are browser-safe identifiers. NEVER put a database password, Supabase secret key or service-role key in `VITE_*`, source code, GitHub or the browser.

## Set up your Supabase development database

1. Open the `salon-system` development project in Supabase and go to **SQL Editor**.
2. Run `supabase/001_schema.sql` once in the new empty project. It is transactional and is not a repeatable reset script.
3. Run `supabase/002_seed.sql`. It imports the services and fictional schedules/skills, with conflict guards.
4. In **Authentication → URL Configuration**, set Site URL to the local app URL initially, or the exact published GitHub Pages URL once available. Add both your local URL and the published URL to allowed redirect URLs for email confirmations. Keep email confirmation enabled.
5. Use Supabase mode in the app to create an account through the booking confirmation screen. Confirm its email, then sign in.
6. To give YOUR account staff access, find its UUID in **Authentication → Users**. Run this in the SQL Editor, substituting that UUID:

```sql
insert into public.staff_users(user_id,role)
values ('YOUR-AUTH-USER-UUID', 'admin');
```

Ordinary customer accounts must not be added here. Membership is only editable through trusted database administration in this first slice; customers cannot assign themselves roles. Sign out and back in after adding membership. Staff/admin/IT Support share the limited first-slice staff capabilities; full differentiated permissions and accountant reporting access are not yet implemented.

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
