# 50% booking guarantee

Apply in this order:

1. Run `041_percentage_booking_guarantee.sql` in Supabase SQL Editor after 040.
2. Redeploy the existing `booking-guarantee` function with the updated `index.ts` and its unchanged `payment-state.ts`.
3. Redeploy `send-booking-confirmations` with updated `email.ts` and its existing `index.ts` and `calendar.ts`.
4. Redeploy `send-appointment-reminder` with updated `email.ts` and its existing `index.ts`.
5. Refresh after GitHub Pages finishes deploying.

Keep all existing function settings, secrets, Sandbox mode and test-recipient routing unchanged.

New appointments record 50% of their booked treatment price, rounded to the nearest cent. A €49 treatment has a €24.50 guarantee; a €49.99 treatment has a €25.00 guarantee. No money is taken at booking. Marking a no-show and approving its fee charges the recorded amount through Revolut Sandbox. Staff can waive the fee with their existing permission. Reports use the recorded payment amount automatically.

Existing bookings retain the €10 amount clients previously agreed to. Existing fee decisions and completed charges are untouched. Subsequent treatment catalogue changes, amendments and checkout discounts do not increase or rewrite the agreed guarantee. Free, guarantee-exempt and prepaid bookings remain exempt from the card fee. Late-cancellation charging is not added by this update.

The separate Reports → Revolut Sandbox test continues to use a fixed €10 test charge; it is independent of real appointment guarantees.

Test a new €49 booking, check the €24.50 amount is displayed, then mark it no-show and approve the fee. Verify the €24.50 Sandbox order and report row. Also test waiving, an exempt booking, and an old booking retaining €10.
