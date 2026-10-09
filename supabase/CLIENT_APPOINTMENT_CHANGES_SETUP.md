# Client appointment changes

1. Apply `042_client_appointment_changes.sql` in the Supabase SQL Editor after migration 041. Run once.
2. Redeploy the existing `booking-guarantee` Edge Function using the updated `index.ts` and its unchanged `payment-state.ts`. Keep its current settings, secrets and Sandbox mode.
3. Refresh the site after GitHub Pages deploys.

My Appointments now has Upcoming, Previous and Cancelled sections. Future booked appointments can be amended or cancelled by their attendee or original booking client. Checked-in, completed and past appointments cannot be changed online.

The three-day rule is an exact 72-hour window, using Ireland appointment times. Within that window only a new time on the original date is allowed. Further away, the client can choose a new date too. Online amendments keep the original staff member, treatment, price, payment and agreed guarantee; the database checks availability and saves before/after details in the audit history.

Client profiles have two new flags, default No. Requires Deposit = No automatically makes both flags Yes, including existing exempt profiles. These flags remain Yes if Requires Deposit is later changed back to Yes; staff can change them explicitly then.

Cancellation first frees the diary slot and retains the appointment/audit records, then submits the agreed guarantee fee to Revolut. New bookings use 50%; historical bookings keep their previously agreed amount. The confirmation displays the exact fee. Pending or failed payment does not undo the cancellation. Status checks and repeated requests do not create another fee record or charge. If the request is interrupted, staff can recover the recorded pending fee through the existing booking-guarantee worker; there is no automatic scheduled fee retry in this version.

Clients with Can Cancel anytime for free = Yes get Yes/No confirmation and no fee. Bookings without a verified guarantee card, exempt bookings, and voucher/credit prepayments also cancel without a card fee. Voucher and credit-note balances/redemptions remain unchanged; refunds are deferred to the next iteration as requested.

Collected cancellation fees appear in activity and summary reports on the actual payment date, labelled CANCELLED in Daily Activity.

Test: a booking tomorrow (date locked), one four days away (date editable), an exempt client (unrestricted amendment and free cancellation), and a new card-backed booking (50% Sandbox cancellation charge). Check diary availability, Cancelled Appointments, audit history and reports. The cancellation fee is still a Sandbox payment; do not use real cards.
