# Split checkout activation

1. Apply `020_split_checkout.sql` once in the Supabase SQL Editor after migrations 001–019. Run the entire file, including its transaction. No Edge Function or secret changes are needed.
2. Wait for the GitHub Pages update, then refresh the staff portal.
3. Open a checked-in appointment. Choose **Check Client Out**, then Card, Cash, Voucher or Credit Note.
4. For a voucher, select an assigned active voucher or enter its exact physical voucher code. A code entered manually may belong to another client; its assigned name is shown for staff to verify. Credit notes must belong to the appointment's attendee.
5. If the balance is smaller than the treatment price, choose Card or Cash for the remainder. Confirm the displayed breakdown after taking any Card amount on the physical terminal or collecting Cash.

The first version supports one voucher OR one credit note, with optional Card OR Cash for the remainder. It uses up to the treatment price and preserves unused value. It does not support multiple vouchers or combining a voucher with a credit note.

## Suggested checks

- €100 voucher / €80 treatment: €80 usage, €20 remaining.
- €60 voucher / €80 treatment: €60 voucher and €20 Card or Cash.
- Repeat both examples with a credit note.
- Verify Used Vouchers/Used Credit Notes, completed appointment payment breakdown, and Daily/Monthly Activity Report totals.
- Try an expired voucher, exhausted balance, a credit note assigned elsewhere, and a second checkout of a completed appointment. These must fail without changing balances.

## Data and permissions

`appointment_payments` stores each tender separately. `client_value_redemptions` links value usage to the appointment, attendee, treatment, therapist and staff user who recorded it. The original voucher/credit value is retained; remaining value subtracts all usages. Checkout locks the appointment and selected voucher/credit note and saves payment rows, redemption, completion and audit in one transaction. The server compares the expected amount to the current balance and refuses stale breakdowns.

Historical completed appointments retain their existing payment labels and are included once in reports. New checkouts use the detailed payment rows. Historical voucher labels are not retroactively deducted because the original voucher is unknown.

The old status-update RPC can still check in, cancel or mark no-show, but cannot complete an appointment without the new checkout. Card and Cash are accounting records only; checkout never calls Revolut or charges the guarantee card. The existing 1.5% terminal-fee estimate in activity reports is retained.
