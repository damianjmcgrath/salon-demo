# Self-booking patch tests

## Activate

1. Open the Supabase SQL Editor for the salon project.
2. Copy all of `022_self_patch_test_booking.sql`, then run it once. It requires the previous migrations, including 021.
3. After the GitHub Pages deployment finishes, refresh the booking site. No Edge Function deployment or new secrets are required.

## Behaviour

For client **Yourself** bookings, treatments requiring a patch test are checked against that client’s recorded tests for the exact treatment. Missing clearance changes the booking to the existing PATCH TEST service and retains the intended treatment. The confirmation, email and staff diary display **Patch Test for [treatment]**.

The existing PATCH TEST service is currently five minutes and €0. This migration defaults its **Booking guarantee required** setting to **No**. Its duration, price and guarantee setting can be changed in Treatment Management. A treatment’s guarantee setting and the client’s Requires Deposit setting must both be Yes to require a card.

Booking or completing a patch appointment does not record clinical clearance. Staff must record the performed test on the client’s Patch Tests tab, selecting the treatments it covers. Subsequent treatment bookings must start at least 24 hours after the recorded test time. No treatment appointment is created automatically. Existing bookings are not converted. Automatic redirection applies only to clients booking for themselves; booking for someone else is unchanged.

## Test

- Choose a patch-required treatment as a client without a recorded test. Check the explanation, patch label, patch duration/price and confirmation without card details.
- Check the staff diary and confirmation email show the intended treatment.
- Record a patch test for that client and treatment. Confirm the original treatment is offered, with slots at least 24 hours after the recorded test.
- Confirm a different patch-required treatment without coverage still redirects.
- Confirm treatments not requiring a patch test book normally.
