# Upfront voucher and credit note bookings

1. Run all of `037_upfront_value_bookings.sql` in the Supabase SQL Editor after migration 036.
2. Update `email.ts` in the existing `send-booking-confirmations` Edge Function using `supabase/functions/send-booking-confirmations/email.ts`, and redeploy. Keep the existing `index.ts`, secrets and webhook settings. This makes confirmation emails show the prepaid voucher/credit note rather than asking for payment in the salon.
3. After the GitHub Pages deployment finishes, refresh the client and staff pages.

## Test

- Assign a voucher or credit note whose remaining balance covers the treatment price to a testing client.
- Book the treatment: choose voucher/credit note, select the balance, and confirm. Check that only the treatment price was deducted and the appointment remains Booked with Paid already details.
- Check the client in, then check out: the prepaid message appears, no payment method is requested, and checkout marks the treatment Completed without another deduction.
- Test a client with both kinds of balance, and a client with Requires Deposit = No. Both can select upfront payment or their usual in-salon route.
- Expired vouchers, other clients' balances and balances below the treatment price cannot be used. If a balance changes before confirmation, booking fails atomically and no appointment or payment is saved.
- Reports show upfront payments on the booking payment date. Completing the appointment does not create another payment row.

## Current limits

A single voucher or credit note must cover the full treatment price; combining balances online is not included. The signed-in client's own balance is used, including when they book for someone else.

A prepaid appointment can be moved without changing its price. Price changes and discounts are blocked to prevent a mismatch with the recorded payment. Cancelling or marking a prepaid appointment as a no-show preserves its payment: this feature does not yet implement automatic refunds or balance restoration. Refund policy and reversal actions can be added separately.
