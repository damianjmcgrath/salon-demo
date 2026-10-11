# Combined booking confirmation emails

1. In Supabase SQL Editor, run `supabase/051_grouped_booking_confirmations.sql` once. This applies to new bookings only; existing emails are not resent.
2. Open the existing `send-booking-confirmations` Edge Function. Replace `email.ts` with the version in `supabase/functions/send-booking-confirmations/email.ts`. Keep `index.ts` and `calendar.ts` in the same function; use the current repository versions of all three files. Deploy with Verify JWT still disabled.
3. Make a new booking containing two treatments. Expect one confirmation email at `damianjmcgrath@gmail.com`, listing both appointments, individual dates/times, staff, prices, payment/guarantee details and the total. Each appointment has its own calendar attachment. A linked patch test appears in the same email.
4. Check the client's Communications tab: one SYSTEM booking confirmation entry lists the treatments. Amendment and cancellation emails continue per individual appointment.

No new webhook, secret, or scheduling configuration is required. The booking transaction consolidates the queue before committing, so concurrent webhook invocations cannot send the superseded individual messages. The existing sender's frozen payload, leases and Resend idempotency key continue to protect retries.
