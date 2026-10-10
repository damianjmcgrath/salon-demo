-- One-off testing reset, not a migration. Run in Supabase SQL Editor.
-- Clears every appointment (including completed/cancelled), voucher and credit
-- note, plus dependent payments, redemptions, discounts and email requests.
-- Keeps staff, clients, logins, treatments, permissions, shifts, breaks,
-- clock history, patch tests, notes, communications and saved guarantee cards.
-- Historical audit details are retained, detached from deleted appointments.
begin;
create temporary table reset_counts on commit drop as
select (select count(*) from public.appointments) appointments_removed,
       (select count(*) from public.vouchers) vouchers_removed,
       (select count(*) from public.client_credit_notes) credit_notes_removed;

delete from public.booking_email_queue;
delete from public.appointment_reminder_requests;
delete from public.voucher_email_requests;
delete from public.prepaid_cancellation_adjustments;
delete from public.appointment_payments;
delete from public.client_value_redemptions;
delete from public.appointment_discounts;
delete from public.no_show_fees;
update public.audit_events set appointment_id=null where appointment_id is not null;
delete from public.appointments;
delete from public.demo_voucher_orders;
delete from public.voucher_transactions;
delete from public.vouchers;
delete from public.client_credit_notes;
insert into public.audit_events(action,details)
select 'testing_bookings_and_values_reset',to_jsonb(r) from reset_counts r;
commit;

-- All three should show 0; staff and client counts remain unchanged.
select (select count(*) from public.appointments) appointments_remaining,
       (select count(*) from public.vouchers) vouchers_remaining,
       (select count(*) from public.client_credit_notes) credit_notes_remaining,
       (select count(*) from public.staff) staff_retained,
       (select count(*) from public.clients) clients_retained;
