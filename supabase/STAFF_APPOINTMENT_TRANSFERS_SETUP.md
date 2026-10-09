# Staff appointment transfers

Run `044_staff_appointment_transfers.sql` in the Supabase SQL Editor, after migration 043. Refresh the deployed site.

No Edge Function changes are required. Open an active diary appointment. Its price is below the staff name. Available qualified colleagues have a **Move to [name]** link. The transfer preserves the booked duration, price, time, status, payment and guarantee, and checks shifts, lunch/breaks, busy calendar entries and other appointments. Availability is checked again when clicked. Completed, cancelled and no-show appointments cannot be transferred.

The current diary assignment changes. The original client preference (`staff_selected`, `preferred_staff_id`) remains unchanged for the Staff Preference Report. `original_staff_id` records the initial allocation for new appointments; existing appointments use the original explicitly selected staff where recorded, otherwise their allocation at migration time. Transfers are audited with before/after details. The existing amendment email queue also receives the staff change.
