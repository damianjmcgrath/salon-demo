# Rebook reminder emails — activation and testing

Apply after migration 048. Existing booking/voucher email functions do not need redeploying.

## 1. Database
Run `supabase/049_rebook_reminders.sql` in the Supabase SQL Editor.
This creates a private queue, eligibility checks, daily scan state and SYSTEM Communications logging. It does not send any emails by itself.

## 2. Edge Function
Create/deploy `send-rebook-reminders` with both files from `supabase/functions/send-rebook-reminders/`: `index.ts` and `email.ts`. Keep the `./email.ts` import.
Disable **Verify JWT**. This worker checks the private `x-salon-email-secret` header before any database access.
It uses your existing secrets: `SALON_EMAIL_WORKER_SECRET`, `SALON_EMAIL_ENABLED=true`, `RESEND_API_KEY`, and `SALON_EMAIL_FROM`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically. Do not share secret values or put them in GitHub.

## 3. Schedule
Enable **Cron (pg_cron)** and **pg_net** in Supabase Database Extensions if not already enabled.
In Supabase **Vault**, add a secret named `salon_email_worker_secret`, with the exact same value as the existing `SALON_EMAIL_WORKER_SECRET` Edge Function secret.
Run `supabase/schedule_rebook_reminders.sql` in the SQL Editor. It invokes the worker every 15 minutes. The database only scans for newly overdue clients once per Europe/Dublin calendar day; later invocations drain/retry the queue, up to ten emails each time. No database webhook is needed.
The first invocation includes existing overdue appointments, so check treatment windows before activating.

## Behaviour
- Only completed appointments count as attendance. Eligibility uses their scheduled appointment date/time, as requested, rather than payment date.
- The latest completed appointment for each client/treatment is used. The client must be strictly beyond the configured window. Weeks are seven-day periods; months use calendar months, in the salon timezone.
- Empty windows, inactive treatments, merged clients and empty email addresses are skipped.
- Any future booked/checked-in appointment for the same treatment suppresses the reminder, including bookings made by someone else.
- Each client/treatment/latest attendance has one unique queue record. A new completed appointment allows another reminder once its window passes. A future booking cancelled before a reminder was sent may make that reminder eligible again.
- Rechecks happen when messages are claimed. A booking made after a message is already submitted can still overlap with that send.
- **All eligible clients are included**, regardless of marketing preference, as selected for this version.
- All delivery remains redirected to **damianjmcgrath@gmail.com**. The intended client email is recorded for testing; this is not a production recipient configuration.
- Resend acceptance creates a single SYSTEM / Email entry in that client's Communications. Acceptance means submitted to the provider, not proof of inbox delivery.
- Temporary provider/network failures retry with the same frozen payload and idempotency key. Ambiguous retries older than 23 hours stop in `review` to avoid duplicate messages; inspect Resend before intervening. Permanent provider errors remain `failed`.
- The branded email links to the requested treatment. Clients sign in if necessary, then select availability through the normal booking process.

## Test
Use a test treatment with a non-empty Rebook Window and a completed appointment older than that window. Ensure the attendee has an email address and no future active booking for that treatment. Wait for the schedule, or use the function's dashboard Test with POST and header `x-salon-email-secret` set privately to your worker secret.
Check Gmail, the attendee's Communications tab, and the queue:

```sql
select q.id,c.name,t.name treatment,q.status,q.attempts,q.resend_id,q.last_error,q.created_at
from public.rebook_email_queue q
join public.clients c on c.id=q.client_id
join public.treatments t on t.id=q.treatment_id
order by q.created_at desc;
```
Invoke again: the same attendance must not send another email. Test with a future appointment: no reminder should send. Complete a later appointment and check after its window: one new reminder becomes eligible.
If you change test data after today's scan, explicitly reset the daily scan marker before invoking again:
```sql
update public.rebook_scan_state set last_scan=null where id=true;
```
This does not clear sent-message deduplication. Do not delete accepted queue records to repeat a test; create a separate completed attendance instead.

Pause the schedule:
```sql
select cron.unschedule('salon-rebook-reminders');
```
Existing emails already accepted cannot be recalled.
