# Appointment emails, prepaid cancellation refunds and staff preferences

## Activate

1. Run `043_booking_lifecycle_values_preferences.sql` once in Supabase SQL Editor, after 042.
2. Redeploy `send-booking-confirmations` with the updated `email.ts` and the existing `index.ts` and `calendar.ts`. Keep the relative imports.
3. Keep the existing INSERT webhook on `public.booking_email_queue`, worker secret, sender settings and test routing. No extra webhook or secret is needed.
4. Refresh after the GitHub Pages deployment finishes.

All emails continue to go to `damianjmcgrath@gmail.com` during testing. The same queue, provider idempotency keys and retry protection serve booking, amendment and cancellation emails. Jobs have a unique appointment/event/revision identity. Pending outdated confirmation jobs are superseded by the latest change. A request already being processed may have sent before the later change; the later email corrects it.

Amendment emails show original and new appointment details; cancellation emails confirm cancellation. Prepaid cancellation emails include the returned amount and retained fee. Calendar files are included for amendments, but not cancellations; existing calendar entries are not automatically updated/deleted.

## Prepaid client cancellations

For a €50 treatment prepaid from a €100 voucher or credit note:

- Free cancellation: return €50, restoring the balance to €100. No used cancellation-fee entry remains.
- Normal cancellation: retain €25, return €25, restoring the balance to €75. Used Vouchers/Credit Notes shows €25 against `Treatment (cancellation fee)`.

The Can Cancel anytime for free flag determines this, including the automatic Yes for Requires Deposit = No. Prepaid bookings no longer get a free cancellation simply because they do not require a card guarantee. The adjustment is atomic and recorded once per appointment. No card is charged for a prepaid cancellation. Refunds return to the original voucher/credit note rather than issuing a new instrument.

The original payment amount and date remain intact. Original redemption/payment snapshots, retained fee and refund are stored in `prepaid_cancellation_adjustments` and the cancellation audit. Financial reports include the refund as a negative voucher/credit-note amount on its actual cancellation date. Used histories show the amount retained rather than the original full prepayment. A voucher's existing expiry date and current ownership are retained.

These rules apply to the client cancellation flow. Existing cancelled bookings are not retrospectively refunded. Staff cancellation controls have not gained a new refund/fee decision flow.

## Client credit notes

My Vouchers now contains My Credit Notes, with Active and Used sections, responsive cards on mobile and no creation button. The database returns only the signed-in client's credit notes; staff creation permissions are unchanged.

## Staff preferences

New client bookings record whether a staff member was explicitly selected or No preference was chosen. Explicit bookings also retain the originally requested staff ID, so subsequent staff amendments do not rewrite the client's original choice. The diary details show this alongside the assigned staff name.

The Staff Preference Report loads all bookings by default, including cancelled/completed bookings, and filters by appointment date. Staff columns are generated from active staff plus previously selected archived staff. Only treatments with bookings appear. Historical and staff-created bookings without recorded client choices appear in a separate Not recorded column; they are not guessed as No preference. CSV exports the generated table.

## Checks

Test a normal voucher cancellation and free voucher cancellation, then repeat both with credit notes. Verify balances, retained-fee histories, cancellation emails and report refunds; repeat the request to ensure no second refund. Amend a booking and verify the email's old/new times. Book once with Aoife selected and once with No preference, then inspect diary details, report counts and CSV. Historical appointments should show Not recorded.
