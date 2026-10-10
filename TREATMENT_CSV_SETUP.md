# Treatment CSV download and bulk amendment

## Enable

Run `supabase/046_bulk_treatment_csv.sql` once in this project's Supabase SQL Editor, after migrations through 045. No secrets or Edge Function deployments are required. The GitHub Pages update adds the buttons automatically after deployment.

## Use

1. Open Treatment Management with a profile permitted to access it.
2. Download Treatments CSV. This exports all active treatments, regardless of the category filter.
3. Edit it in Excel and save as CSV UTF-8 (comma delimited). Keep Treatment IDs unchanged.
4. Choose Upload CSV to Bulk Amend Treatments, Browse for the file and click Upload.
5. Review the current/new values and click Confirm Changes, or Cancel to discard.

The uploaded CSV is not applied merely by selecting or uploading it. An invalid file has no confirmation action. The server applies the final confirmation in one transaction: if any row fails, the entire import is rolled back. If a treatment changes between preview and confirmation, reload and upload again.

## Columns, in order

Treatment ID, Category, Treatment Name, Treatment Description, Length in minutes, Price, Rebook Window, Booking guarantee required?, Patch test Required?

- IDs must match existing active treatments and appear only once. Omitted treatments are unchanged. This version cannot create or archive treatments.
- Names/categories: 1–200 characters. Descriptions: up to 5,000 characters; blank clears the description.
- Length: a whole number, 1–720 minutes.
- Price: 0–999999.99, at most two decimal places, without currency symbols or thousands separators.
- Rebook Window: 1 week, 2 weeks, 4 weeks, 2 months, 3 months, 6 months or 12 months. Blank clears the window.
- Guarantee and patch-test fields: Yes or No (case insensitive). Blank preserves the current setting, as shown in the preview. The actual Patch Test service cannot require a patch test itself.
- Limit: 2 MB / 2,000 treatment rows. BOM, CRLF, quoted commas, escaped quotes and multiline descriptions are supported. Headers must match exactly.

## Existing records

Renames update treatment names on existing appointments and Patch Test for <treatment> entries. Existing appointment prices, durations, payment/guarantee amounts and schedules stay unchanged. New bookings use the updated catalogue. Previously sent emails and original financial/audit snapshots retain their original text.

Imports record the staff user, timestamp, batch ID, and before/after values in audit_events. Access uses the existing Treatment Management permission and is also checked inside the database function.

The supplied Sculpted_Treatments_and_Prices(2).csv has 111 rows and passes the format checks against the bundled catalogue. Its blank guarantee and patch-test fields retain current values; its blank rebook windows clear those values. Live IDs/settings are checked again when uploading.
