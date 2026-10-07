# Booking for someone else: patch tests

## Activate

1. In the salon Supabase SQL Editor, run all of `023_proxy_patch_test_booking.sql` once. Migration 022 must already have been applied.
2. Refresh the booking site after GitHub Pages finishes deploying. No Edge Function deployment or new secrets are needed.

## Behaviour

The client home page has Yourself, Someone Else and Buy a Voucher as three equal-sized choices. Multiple-person booking enquiries use the phone/email links beneath them.

The Someone Else flow uses the recipient's email (ignoring letter case and surrounding spaces) to find their existing client record. For a treatment requiring a patch test, missing coverage redirects to the existing PATCH TEST service and remembers the intended treatment. This applies to both new recipients and existing clients without coverage. The time screen explains the patch appointment; the diary, confirmation and email show Patch Test for [treatment]. Booking alone does not create clinical clearance.

An existing recipient with coverage for the exact treatment can book that treatment, with availability at least 24 hours after the recorded test. Treatments not requiring a patch test book normally.

A new client record is created only when the booking is confirmed. Repeated bookings reuse the same email-matched record. The appointment remains linked to the attendee and visible to its booking creator. Where a guarantee is required, the booking creator must use their own saved card, never the attendee's card. The PATCH TEST service's existing Treatment Management guarantee setting still applies.

## Test

- Unknown email + patch-required treatment: redirects to patch booking.
- Existing client email + patch-required treatment without coverage: redirects to patch booking.
- Existing client email + coverage for the selected treatment: normal booking, respecting the 24-hour gap.
- Any email + treatment without patch requirement: normal booking.
- Repeat an attendee's email with different letter case: appointments stay on one client record.
