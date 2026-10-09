import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Appointment } from "./domain";
import { requestErrorMessage } from "./requestErrors";
export default function ClientAppointmentActions({
  db,
  appointment: a,
  onAmend,
  onChanged,
}: {
  db: SupabaseClient;
  appointment: Appointment;
  onAmend: (a: Appointment, locked: boolean) => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"amend" | "cancel" | null>(null),
    [policy, setPolicy] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(""),
    [cancelled, setCancelled] = useState(false);
  async function open(kind: "amend" | "cancel") {
    setBusy(true);
    setError("");
    try {
      const r = await db.rpc("client_appointment_policy", { p_id: a.id });
      if (r.error) throw r.error;
      if (!r.data.can_manage)
        throw Error(
          "This appointment can no longer be changed online. Please contact the salon.",
        );
      setPolicy(r.data);
      if (kind === "amend" && r.data.can_amend_anytime) onAmend(a, false);
      else setMode(kind);
    } catch (e) {
      setError(requestErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function charge() {
    setBusy(true);
    setError("");
    try {
      const r = await db.functions.invoke("booking-guarantee", {
        body: { action: "charge", appointment_id: a.id },
      });
      if (r.error) throw r.error;
      if (r.data?.error) throw Error(r.data.error);
      setResult("Appointment cancelled. Payment: " + r.data.state + ".");
    } catch (e) {
      setError(
        "Appointment cancelled. " +
          requestErrorMessage(e) +
          " You can retry the fee payment below.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function status() {
    setBusy(true);
    try {
      const r = await db.functions.invoke("booking-guarantee", {
        body: { action: "fee_status", appointment_id: a.id },
      });
      if (r.error) throw r.error;
      if (r.data?.error) throw Error(r.data.error);
      setResult("Appointment cancelled. Payment: " + r.data.state + ".");
      setError("");
    } catch (e) {
      setError(requestErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const r = await db.rpc("client_cancel_appointment", {
        p_id: a.id,
        p_revision: a.revision || 0,
      });
      if (r.error) throw r.error;
      setCancelled(true);
      setResult(
        r.data.fee_required
          ? "Appointment cancelled. Submitting cancellation payment…"
          : "Appointment cancelled without a fee.",
      );
      if (r.data.fee_required) await charge();
    } catch (e) {
      setError(requestErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {!mode && !cancelled && (
        <>
          <button disabled={busy} onClick={() => void open("amend")}>
            Amend Appointment
          </button>
          <button disabled={busy} onClick={() => void open("cancel")}>
            Cancel Appointment
          </button>
        </>
      )}
      {mode && !cancelled && (
        <section className="panel" aria-label="Change appointment">
          <p>
            {mode === "amend"
              ? "You can amend your appointment time for free if you are keeping the same date but just amending the time, or if your original booking is more than 3 days away. Click Continue to select a new appointment time, or alternatively you can contact the salon on"
              : policy.cancel_free
                ? "Are you sure you want to cancel this appointment? No cancellation fee will be charged. Contact the salon on"
                : "Cancelling the appointment will incur the agreed booking guarantee fee (50% of the treatment value for new bookings). Please Confirm to accept this and cancel your appointment, or alternatively, you can contact the salon on"}{" "}
            <a href="tel:0871815137">087 1815137</a> or Email:{" "}
            <a href="mailto:sculptedbyac@gmail.com">sculptedbyac@gmail.com</a>{" "}
            for further information.
          </p>
          {mode === "cancel" && !policy.cancel_free && (
            <p>Cancellation fee: €{(policy.fee_cents / 100).toFixed(2)}</p>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              mode === "amend"
                ? onAmend(a, policy.same_date_only)
                : void confirm()
            }
          >
            {mode === "amend"
              ? "Continue"
              : policy.cancel_free
                ? "Yes"
                : "Confirm"}
          </button>
          <button disabled={busy} onClick={() => setMode(null)}>
            {mode === "cancel" && policy.cancel_free ? "No" : "Cancel"}
          </button>
        </section>
      )}
      {cancelled && (
        <button onClick={onChanged} disabled={busy}>
          Back to appointments
        </button>
      )}
      {result && <p role="status">{result}</p>}
      {error && <p role="alert">{error}</p>}
      {cancelled && !policy.cancel_free && (
        <>
          <button disabled={busy} onClick={() => void status()}>
            Check payment status
          </button>
          {error && (
            <button disabled={busy} onClick={() => void charge()}>
              Retry fee payment
            </button>
          )}
        </>
      )}
    </div>
  );
}
