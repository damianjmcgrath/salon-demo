# Booking confirmations — testing setup

This implementation is ready in the repository but publishing the website does NOT deploy the Supabase function, apply SQL, configure a webhook or send an email.

All recipients are fixed to **damianjmcgrath@gmail.com** in server code. Sender defaults to **Sculpted Testing <bookings@auth.benniescardgame.co.uk>**, using the already verified Resend domain. Subject begins `[TEST]`. The client record's email address is not changed. Bennies password-reset settings are not changed.

## 1. Resend API key

In the existing Resend account, open API Keys and create a new key named `Salon booking confirmations`, with sending permission restricted to `auth.benniescardgame.co.uk` if available. Keep the key private.

## 2. Supabase secrets

In the salon project, open Edge Functions → Secrets. Add:

| Name | Value |
|---|---|
| RESEND_API_KEY | The new Resend key |
| SALON_EMAIL_FROM | Sculpted Testing <bookings@auth.benniescardgame.co.uk> |
| SALON_EMAIL_WORKER_SECRET | A new long random secret you choose; retain privately for the webhook |
| SALON_EMAIL_ENABLED | true |

Never put the Resend key or worker secret in frontend code, a GitHub commit or chat.

## 3. Database migration

Run `010_booking_confirmation_emails.sql` in SQL Editor, after 009. It creates a private queue and an insert trigger. Only newly inserted appointments queue confirmations. Past bookings are not backfilled, and amendments don't send a second initial confirmation.

## 4. Edge Function

Deploy a new function named `send-booking-confirmations`. In the dashboard editor add both files from `functions/send-booking-confirmations/`: `index.ts` and `email.ts`. Keep the relative import `./email.ts`. Disable **Verify JWT** for this function; it authenticates using its private worker secret instead. Deploy.

## 5. Database webhook

Create a Database Webhook on `public.booking_email_queue`, event **INSERT**, HTTP method **POST**, URL:

`https://xmvujvwyfxawtazjiymd.supabase.co/functions/v1/send-booking-confirmations`

Set headers `Content-Type: application/json` and `x-salon-email-secret` to the same private worker secret from step 2. Set timeout to 60000 ms if the dashboard supports it. The function ignores supplied recipients/content and reads the private database queue itself. It processes up to 10 queued records per invocation.

## 6. Automatic retries

Save the SAME worker secret in Supabase Vault under the name `salon_email_worker_secret`, then run `enable_booking_email_retries.sql`. This schedules processing every five minutes. The immediate webhook sends new bookings; the schedule recovers missed webhook calls and transient failures. Disable the schedule if no longer testing.

If Cron isn't configured yet, pending jobs can be retried through the Edge Function's Test panel: POST body `{}` with header `x-salon-email-secret` set to the private worker secret. Do not repeatedly create new appointments to retry email sending.

## 7. Smoke test

Book a new treatment as a client, then another through Staff Appointment Management. Both emails should arrive only at Damian's Gmail. Inspect `booking_email_queue` in Table Editor and the Resend Emails page. `accepted` means Resend accepted the send, not proof of inbox delivery. `failed` indicates a permanent provider rejection; `pending` retries; `review` requires checking Resend before manual recovery because its deduplication window has expired. An open processing lease lasts five minutes.

The same frozen payload and idempotency key are reused for retries. Automatic retries stop after 23 hours to stay inside Resend's 24-hour deduplication window. The database queue is accessible only to the server. Browser callers cannot send arbitrary mail or redirect the recipient. The booking remains saved even if email sending fails.

Turning SALON_EMAIL_ENABLED to false stops sending. Switching to actual recipients later requires a reviewed server-code change; removing a secret cannot accidentally enable real client delivery.

For now this sends the initial booking confirmation only. Cancellation/amendment emails, reminders, voucher emails and delivery webhooks are separate future work.
