# Multi-treatment client visits

Run `supabase/047_multi_treatment_visits.sql` once in the Supabase SQL Editor after 046. No Edge Function deployment or new secrets are required. Refresh the site after GitHub Pages deployment.

## Client flow

Select a treatment, then choose Add Another Treatment or Choose a Date/Time. The selection summary lists treatment order, individual prices/durations and the combined total. Remove an item to change the selection; up to 12 treatments / 720 minutes can be selected. A therapist must be qualified for every selected treatment.

Availability covers the entire visit, including shifts, appointments, lunch, breaks and Busy calendar entries. Only the first treatment's start-time alignment applies; following treatments start immediately afterwards. Free calendar entries allow overlap as before.

The guarantee screen shows the combined price and 50% guarantee. Each appointment keeps its own 50% fee, card consent and payment information. An exempt client can book without a card. If a card guarantee is required for the visit, that verified card covers all its appointments. A voucher or credit note must cover the entire total; it is redeemed separately for each treatment, preserving cancellation/refund and reporting behaviour.

Confirmation lists every treatment and its start/end time. The optional calendar link covers the full visit. Each treatment appears separately in My Appointments and the diary. Client amendment/cancellation and staff checkout/no-show actions remain per appointment: no other appointment is moved/cancelled/charged automatically. A no-show covering the full visit is recorded against each missed appointment; their individual 50% fees add up to the full visit's applicable fee. Existing email processing sends individual appointment confirmations.

Database booking is atomic and idempotent: a lost-response retry with the same request ID returns the existing appointments, without additional payments. Any invalid treatment, changed catalogue price/duration, unavailable slot, rejected card agreement or insufficient value rolls back the whole visit. Existing single-booking and rebooking journeys remain supported. Staff single-treatment booking stays unchanged.

No new patch-test policy is introduced. Existing clearance checks still run. Treatments routed to a Patch Test retain their existing single-appointment flow, pending the planned patch-test redesign.

## Test

1. Select non-patch treatments of 15, 30 and 45 minutes, with one qualified therapist. Confirm 90-minute availability and starts such as 10:00, 10:15, 10:45.
2. Check that a lunch/break/Busy entry or existing booking anywhere in the 90-minute range removes the start time.
3. Check card-exempt and card-guaranteed clients. The guarantee display should use the total price.
4. Pay with a voucher/credit note covering the full visit. Check each appointment's payment and the remaining balance.
5. Amend/cancel only one treatment; verify the other appointments remain unchanged. For a paid cancellation, check only that treatment's applicable 50% retention/refund.

The migration copies the existing private booking/payment checks to permit sequential starts after a full visit validation. Future changes to those checks (including patch-test policy) must update these private copies as well. The copies are not executable by browser roles.
