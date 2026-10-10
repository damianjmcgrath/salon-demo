# Patch test and treatment booking

Run `supabase/048_patch_test_treatment_flow.sql` once in Supabase SQL Editor after 047. No Edge Functions or secrets need changing. Refresh after GitHub Pages deployment.

The configured Patch Test service must be active, free, require no patch test itself and have Booking Guarantee Required = No. Assign staff both the Patch Test service and the treatments they can test.

Clients choose their treatments, then a single patch-test slot covering all missing tests, then a contiguous treatment visit starting at least 24 actual hours later (Europe/Dublin, including daylight-saving changes). The test can use another qualified staff member. Recorded tests retain the existing permanent coverage and 24-hour waiting rule.

The patch-test selection is not a saved booking. Final confirmation saves the entire set atomically, including treatment payments/card agreements. A rejected guarantee, stale treatment price or unavailable slot saves nothing. Retrying the same request does not duplicate bookings or value deductions.

The confirmation lists the patch test first and each treatment with its date, time and staff member. Existing email processing sends a separate confirmation for each appointment. Calendar buttons add the treatment visit, excluding the patch test.

Each treatment remains individually amendable/cancellable, with its own fee/refund rules. A patch-test amendment cannot break the gap to pending linked treatments. Treatment amendments require either recorded clearance or an active scheduled patch test covering the treatment, at least 24 hours earlier. Cancelling or missing the test leaves treatments booked but flags them for staff review. Treatments with pending clearance cannot be checked in or completed until their test is recorded and the waiting period is satisfied. Recording an eligible test clears the pending flag. Checking out a patch test opens Record Patch Test with all intended treatments preselected.

## Suggested testing

1. Client without clearance: select one patch-required treatment. Choose the test, then check that treatment slots less than 24 hours later are hidden. Confirm both appointments.
2. Select two patch-required treatments plus one that needs no test. Confirm one test and three sequential treatment appointments. Check the 50% guarantee uses only the treatment total.
3. Client with recorded clearance: confirm that no new test is requested, and existing 24-hour timing is respected.
4. Try booking for a new person using their email. Confirm the test and treatments share the same attendee profile.
5. Try a voucher/credit note covering the treatment total; check that the test stays free.
6. Move the test too late or a pending treatment too early: the database must reject the change. Cancel/miss the test and check the staff warning.
7. Complete the test and record its selected treatments. Check pending status clears only for covered treatments with sufficient time between recording and their scheduled start.

Private booking clones reuse the current identity, guarantee, payments and audit checks. Future changes to those legacy checks must also update the flow clones.
