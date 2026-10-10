# System email communication history
Run `045_system_email_communications.sql` in the Supabase SQL Editor after 044. No Edge Function deployment or webhook change is required.

Successful booking emails (including amendment/cancellation confirmations) and voucher emails now appear as Email / SYSTEM in client Communication History. The first accepted voucher email is labelled Voucher purchase email; subsequent sends are Voucher email re-send. No automatic voucher email is sent merely by purchasing: the existing Email Voucher action still sends it. Voucher entries appear for the purchasing client's profile and the known recipient/current voucher holder, without duplication when they are the same client. Booking entries belong to the appointment's attending client.

Existing accepted messages are included without sending them again. Repeated processing of the same email request cannot create duplicate history entries. Failed/pending messages are not logged as sent. Entries mean Resend accepted the message, not confirmed inbox delivery. Test delivery remains damianjmcgrath@gmail.com.

Staff reminder emails already record Email / SYSTEM through finish_appointment_reminder. Any future automatic reminder sender should use that same prepare/finish pipeline to get identical logging.
