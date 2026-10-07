# Find, reassign and email vouchers

## Activation

1. In Supabase SQL Editor, run all of `026_voucher_find_email.sql` once, after 025.
2. Create/deploy an Edge Function named **send-voucher-email**. Add both files from `supabase/functions/send-voucher-email/`: `index.ts` and `email.ts`. Keep the import `./email.ts`. Disable **Verify JWT**; the function validates Supabase Auth and Voucher Management permission itself.
3. Refresh the booking site after GitHub Pages finishes deploying.

The function reuses the existing `RESEND_API_KEY`, `SALON_EMAIL_ENABLED=true` and `SALON_EMAIL_FROM` secrets used for booking confirmations. Supabase supplies its project Auth/service keys automatically. No webhook or new secret is required. Existing booking-confirmation functions are unchanged.

## Use

**Find a Voucher** and **Re-Assign a Voucher** lead to the same search and details. Search by voucher ID, assigned client or purchaser name/email. Purchaser search uses the recorded buyer, even when the buyer has no client account or the voucher is unassigned. Optional purchaser name/email fields are now available when staff create vouchers. Previous online purchases are backfilled from their known purchasers; old staff-issued vouchers without buyer information cannot be retrospectively matched to a purchaser.

**Email voucher** opens an editable address, pre-filled from the assigned client's email or recorded recipient email where available. Click Send. All actual emails are currently routed server-side to **damianjmcgrath@gmail.com**, regardless of the address entered. The voucher snapshot, entered recipient, staff actor, actual test recipient and Resend reference are retained for audit. “Accepted” means Resend has accepted the message; inbox delivery can take longer.

A failed/uncertain send can be retried with the same request safely. Email content comes from the database, and the browser cannot override its value or actual delivery recipient. Printing and reassigning remain available alongside Email.
