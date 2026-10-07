# Appointment reminders

1. Run `028_appointment_reminders.sql` in the Supabase SQL Editor, after migration 027.
2. Create an Edge Function named `send-appointment-reminder`. Add `index.ts` and `email.ts` from `supabase/functions/send-appointment-reminder/`, keeping the `./email.ts` import. Disable **Verify JWT** and deploy. The function verifies the signed-in user and staff permissions itself.
3. The function reuses the existing `RESEND_API_KEY`, `SALON_EMAIL_ENABLED=true` and `SALON_EMAIL_FROM` secrets. No additional secrets or database webhook are required.
4. After the website deploys, refresh and open an active appointment in Staff Diary. Click **Send Reminder**, check or amend the email address, and click **Send**.
5. Check Gmail and the attendee's **Communications** tab. An accepted reminder appears as an Email communication by SYSTEM, with appointment details and the requested recipient. All actual deliveries remain fixed to `damianjmcgrath@gmail.com` during testing.

Reminders are available for booked and checked-in appointments, not completed, cancelled or no-show appointments. An email-service failure does not create a successful communication entry. Retries retain a request reference to prevent duplicate delivery and history. Accepted means accepted by the email service, rather than confirmed delivery to the inbox.
