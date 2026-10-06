# Revolut Sandbox booking guarantees and no-show fees

This connects the tested Sandbox flow to bookings. It cannot connect to live
Revolut. Physical terminal treatment payments remain recording actions only.

1. Run `017_booking_guarantees.sql` in the Supabase SQL Editor (after 016).
   If you already applied the original 017 and see “permission denied for table
   clients”, run `018_booking_guarantee_permissions.sql` once. Do not rerun 017.
2. Create an Edge Function named `booking-guarantee`. Add both files from
   `supabase/functions/booking-guarantee/`: `index.ts` and `payment-state.ts`.
   Preserve the relative import `./payment-state.ts`.
3. Disable **Verify JWT** for this function and deploy it. The function validates
   Supabase user sessions and staff permissions itself. Keep the existing secrets
   `REVOLUT_SECRET_KEY` and `REVOLUT_ENVIRONMENT=sandbox`. No new secret is needed.
4. Refresh the website. Sign in as a client, choose a treatment/time and set up a
   guarantee using an official Sandbox test card. Enter a first and last name.
   When verified, confirm the appointment. Book another appointment to test
   selecting the saved card. Test a booking for someone else: the guarantee card
   belongs to the signed-in booker, not the attendee. Staff-created bookings use
   the selected client's card and require their consent.
5. A no-show may only be recorded after the appointment start. In Staff Diary,
   choose **Mark as no-show**, enter comments, then select **Yes — apply €10 fee**
   or **No — waive fee**. Both mark the appointment as a no-show. Yes submits a
   Sandbox payment; No records a waiver and never submits a payment. Reopen the
   appointment to view the comments/result and check an outstanding payment.
6. Repeat the test on a separate appointment with the other choice. Check the
   Merchant area in Revolut Sandbox for the charge. No-show payment states and
   decisions are retained in `no_show_fees` and client Change History/audit logs.

## Boundaries of this iteration

- Old appointments have no real provider guarantee. Choosing Yes records the
  no-show and a failed fee with an explanation, rather than charging a fake card.
- An approved fee has one database record per appointment and one charge attempt.
  Repeated clicks do not submit another payment. An uncertain network outcome is
  recorded for review; staff can check the order but cannot blindly charge again.
- The system records a payment as completed only after Revolut confirms it.
  The status check reads Revolut directly. Automated webhook reconciliation,
  consent withdrawal/card deletion, live-mode approval and no-show financial
  report columns remain future work before production.
- Declining a fee releases no funds: the €0 setup created no hold. Saved card
  references remain for other bookings. Raw card numbers, CVV and secrets are
  never stored in the salon database/browser application.
- Existing activity report treatment-payment totals do not include these
  separate Sandbox no-show fees. No-show money must remain separate from recorded
  terminal takings when adding financial reporting.
- The current tested policy covers no-shows only. Late-cancellation enforcement
  needs the salon's final policy and is not enabled here.
