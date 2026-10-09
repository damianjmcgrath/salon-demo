# Voucher purchases and code transfers

1. In Supabase SQL Editor, run `supabase/039_voucher_claims.sql` once after migration 038. This also installs the current custom-amount validation, fixing the older "Choose a voucher amount" error for numerical values.
2. Redeploy the existing `send-voucher-email` function with its updated `email.ts`. Keep its existing `index.ts`, settings and secrets unchanged.
3. Once GitHub Pages deploys, refresh the website.

Client purchases no longer ask for recipient details. The voucher belongs to the purchaser until another signed-in client claims its code under My Vouchers → Add a Voucher, or staff enter its code at checkout. Claims transfer the remaining balance, preserve purchaser details, and record the previous and new client. Re-entering a code already assigned to the same client does not create a duplicate transfer.

Active vouchers have Print Voucher and Email Voucher actions. Emails still route to damianjmcgrath@gmail.com during testing. Only the current owner may email a voucher. Transferred vouchers replace the expired section; prior redemptions remain in the account that paid with them. Voucher payments still support a Card/Cash remainder.

Test: buy €45.99; verify it appears under the purchaser's My Vouchers; sign in as a different client and add its code; verify the voucher moves and the previous owner's Transferred Vouchers shows the recipient. Test email and print, then try a different voucher code at staff checkout and confirm a split payment. Expired and fully redeemed vouchers cannot be claimed.

Voucher purchases continue to use the existing demo payment flow. This update does not enable live Revolut voucher purchases.
