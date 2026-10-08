# Calendar links in booking confirmations

The website deployment adds Google Calendar and Apple / Outlook Calendar buttons. Calendar entries are copies, with no automatic updates for amendments or cancellations.

For confirmation emails, redeploy the existing `send-booking-confirmations` Edge Function with all three files from `supabase/functions/send-booking-confirmations/`:

- `index.ts`
- `email.ts`
- `calendar.ts` (new)

Keep the relative imports unchanged. Keep Verify JWT disabled and existing worker-secret, Resend, and test-recipient settings unchanged. No SQL or webhook changes are required.

New emails include the two calendar links and a small `sculpted-appointment.ics` attachment. The worker reads the recorded appointment duration before preparing the email. Previously frozen retry payloads remain unchanged for safe Resend idempotency.

After website deployment and function redeployment, book a test appointment, open both calendar buttons, and verify its date, start/end time and address. Test the email attachment on Apple Calendar / Outlook. Irish summer and winter offsets are handled when generating the event.
