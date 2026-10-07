# Management, permissions and guarantee exemptions

## Activate

1. Run the entire `021_management_permissions_deposits.sql` file once in the Supabase SQL Editor, after 020. Wait for success. Do not rerun earlier migrations.
2. Update and deploy these existing Edge Functions in the Supabase dashboard:
   - **booking-guarantee**: replace `index.ts` with the updated file from `supabase/functions/booking-guarantee/`. Keep the existing `payment-state.ts` and its `./payment-state.ts` import.
   - **send-booking-confirmations**: replace `email.ts` with the updated file from `supabase/functions/send-booking-confirmations/`. Keep the existing `index.ts` and its `./email.ts` import.
   - **revolut-sandbox-test**: replace `index.ts` with the updated file from `supabase/functions/revolut-sandbox-test/`.
3. Keep Verify JWT disabled on these functions, as before; each function validates the user's session or its private webhook secret internally. Keep all existing secrets and the email webhook unchanged.
4. After GitHub Pages deploys, refresh the website and sign in again.

No new keys, secrets or webhooks are needed. The booking worker enforces operational page permissions; the diagnostic worker enforces Reporting access; confirmation emails describe card-exempt bookings correctly.

## Defaults and behavior

- Staff Administration is now Staff Management. Client Administration is now Client Management, matching the permission labels.
- Aoife initially has all eight tiles; Leah retains Appointment Management, Client Management, Staff Diary and Voucher Management. Jacqui's separate Accountant Portal remains Reporting only.
- Every Admin has Permission Management forcibly enabled. Other page/action permissions can be changed. Permission Management can be delegated to staff, which allows them to manage other staff's permissions too.
- Existing staff/admin users retain their existing break creation, no-show waiver and credit-note privileges initially. Staff discount permission defaults off; Admin defaults on. Discounts are a stored setting for a later checkout feature.
- Permissions are stored by staff ID, audited, and enforced by database functions and private record policies. The UI refreshes permissions on sign-in, window focus and every 30 seconds. Database checks take effect immediately for the next request.
- Can Create Own Breaks applies to creating additional personal breaks. Existing break and lunch editing follows the previous ownership rules; Admin can manage other staff's breaks. Disabling own-break creation does not remove access to the diary or default lunch.

## Treatment Management

Treatments are grouped by category. Editing saves name, description, length, price and Patch Test Required, with an audit and stale-edit protection. Existing appointment snapshots retain their booked name, price and duration. New bookings use current treatment settings.

This adds the requested patch-test setting. It does not implement the later eligibility/24-hour patch-test booking workflow; the existing booking restrictions for patch-required treatments remain in place.

## Requires Deposit

All existing and newly created clients default to **Yes**, preserving the current saved-card guarantee. This is the requested field name; no cash deposit is collected at booking.

Staff with Client Management can change it on the client's Personal Details tab:

- **Yes**: usual verified card and consent for the €10 guarantee.
- **No**: appointment review/confirmation without requesting a card. Treatment is paid in the salon.

The person receiving the treatment determines the exemption. When booking for someone else, an existing attendee's setting is used; unknown attendees require the normal guarantee. The signed-in booker remains the guarantee payer for non-exempt proxy bookings, as before.

Each appointment records the guarantee decision at booking. Changing a client's flag later does not add/remove a guarantee on an existing appointment. Exempt appointments cannot be charged a card no-show fee; staff can record the no-show with comments and no card charge, even without waiver permission. Guaranteed appointments require Can Waive No Show Fees for a waiver.

## Suggested checks

- As Aoife, edit a treatment and verify the new catalogue values after refresh.
- Remove one of Leah's page permissions; refresh Leah's portal and confirm its tile/navigation disappear. Restore it after testing.
- Disable Leah's waiver and credit-note actions. She should still see the relevant pages, but not the forbidden action buttons.
- Set a test client to Requires Deposit No, create a new booking as that client, and confirm without a card. Check the confirmation email and no-show behavior.
- Set it back to Yes and verify that a new booking requires a card.
