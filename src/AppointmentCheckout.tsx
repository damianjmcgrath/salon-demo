import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Appointment } from "./domain";
type Value = {
  id: string;
  code?: string;
  balance: number;
  expired?: boolean;
  reason?: string;
  assigned_client_name?: string;
  created_at?: string;
};
type Options = {
  vouchers: Value[];
  credit_notes: Value[];
  found_voucher?: Value | null;
};
const money = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    n,
  );
const cents = (n: number) => Math.round(Number(n) * 100);
const labels: Record<string, string> = {
  card: "Card",
  cash: "Cash",
  voucher: "Voucher",
  credit: "Credit Note",
};
export default function AppointmentCheckout({
  db,
  appointment,
  onSaved,
}: {
  db: SupabaseClient | null;
  appointment: Appointment;
  onSaved: (completed: Appointment) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [method, setMethod] = useState(""),
    [editing, setEditing] = useState(false);
  const [options, setOptions] = useState<Options>({
      vouchers: [],
      credit_notes: [],
    }),
    [value, setValue] = useState<Value | null>(null),
    [code, setCode] = useState("");
  const [remainderMethod, setRemainderMethod] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const section = useRef<HTMLElement>(null),
    saving = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (open)
      section.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest",
      });
  }, [open]);
  useEffect(() => {
    if (!open || !db) return;
    let active = true;
    setLoading(true);
    void db
      .rpc("get_checkout_options", { p_id: appointment.id })
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error) setError(error.message);
        else setOptions(data);
      });
    return () => {
      active = false;
    };
  }, [open, db, appointment.id]);
  const price = cents(appointment.price),
    used = value ? Math.min(cents(value.balance), price) : 0;
  const remainder = price - used,
    isValue = method === "voucher" || method === "credit";
  const ready =
    price === 0 ||
    (!!method &&
      (!isValue ||
        (!!value && used > 0 && (remainder === 0 || !!remainderMethod))));
  function choose(m: string) {
    setMethod(m);
    setEditing(false);
    setValue(null);
    setCode("");
    setRemainderMethod("");
    setError("");
  }
  async function findVoucher() {
    if (!db || busy || !code.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await db.rpc("get_checkout_options", {
        p_id: appointment.id,
        p_code: code.trim(),
      });
      if (r.error) throw r.error;
      if (alive.current) {
        setValue(r.data.found_voucher);
        setRemainderMethod("");
      }
    } catch (e) {
      if (alive.current) {
        setValue(null);
        setError((e as Error).message);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function confirm() {
    if (!db || !ready || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await db.rpc("checkout_appointment", {
        p_id: appointment.id,
        p_revision: appointment.revision ?? 0,
        p_method: price === 0 ? null : method,
        p_voucher_code: method === "voucher" ? value?.code : null,
        p_credit_note_id: method === "credit" ? value?.id : null,
        p_remainder_method: isValue && remainder > 0 ? remainderMethod : null,
        p_value_amount: isValue ? used / 100 : null,
      });
      if (r.error) throw r.error;
      if (alive.current) await onSaved(r.data);
    } catch (e) {
      if (alive.current)
        setError(
          (e as Error).message +
            " Review the appointment and available balance before trying again.",
        );
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (!open)
    return (
      <div className="checkout-start">
        <button
          className="primary appointment-action"
          disabled={busy || (price === 0 && !db)}
          onClick={() => (price === 0 ? void confirm() : setOpen(true))}
        >
          {busy ? "Saving…" : "Check Client Out"}
        </button>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <section
      ref={section}
      className="checkout-panel"
      aria-label="Client checkout"
    >
      <h3>Check Client Out</h3>
      <p>
        Treatment total: <strong>{money(price / 100)}</strong>
      </p>
      {!method || editing ? (
        <>
          <p>Select method of payment</p>
          <div className="payment-buttons">
            {Object.entries(labels).map(([m, label]) => (
              <button key={m} disabled={busy} onClick={() => choose(m)}>
                {label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p>
          Method of Payment: <strong>{labels[method]}</strong>{" "}
          <button
            className="back"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        </p>
      )}
      {isValue && !editing && (
        <>
          {loading ? (
            <p>Loading available balances…</p>
          ) : (
            <label>
              {method === "voucher"
                ? "Available vouchers"
                : "Available credit notes"}
              <select
                value={value?.id ?? ""}
                disabled={busy}
                onChange={(e) => {
                  const list =
                    method === "voucher"
                      ? options.vouchers
                      : options.credit_notes;
                  setValue(list.find((v) => v.id === e.target.value) ?? null);
                  setRemainderMethod("");
                  setError("");
                }}
              >
                <option value="">
                  Select {method === "voucher" ? "a voucher" : "a credit note"}
                </option>
                {(method === "voucher"
                  ? options.vouchers
                  : options.credit_notes
                )
                  .filter((v) => !v.expired && cents(v.balance) > 0)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code ?? v.reason ?? "Credit note"} ·{" "}
                      {money(Number(v.balance))} remaining
                    </option>
                  ))}
                {value &&
                  !(
                    method === "voucher"
                      ? options.vouchers
                      : options.credit_notes
                  ).some((v) => v.id === value.id) && (
                    <option value={value.id}>
                      {value.code} · {money(Number(value.balance))} remaining
                    </option>
                  )}
              </select>
            </label>
          )}
          {method === "voucher" && (
            <div>
              <label>
                Or enter voucher ID
                <input
                  value={code}
                  disabled={busy}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setValue(null);
                    setRemainderMethod("");
                  }}
                />
              </label>
              <button
                className="secondary"
                disabled={busy || !db || !code.trim()}
                onClick={() => void findVoucher()}
              >
                Find Voucher
              </button>
            </div>
          )}
          {value && (
            <>
              <p>
                {value.code ?? "Credit note"}
                {value.assigned_client_name
                  ? ` · Assigned to ${value.assigned_client_name}`
                  : ""}
              </p>
              <p>
                {money(used / 100)} will be used.{" "}
                {money((cents(value.balance) - used) / 100)} will remain.
              </p>
              {remainder > 0 && (
                <>
                  <p>
                    <strong>{money(remainder / 100)} remaining to pay</strong>
                  </p>
                  <div className="payment-buttons">
                    {["card", "cash"].map((m) => (
                      <button
                        key={m}
                        aria-pressed={remainderMethod === m}
                        disabled={busy}
                        onClick={() => setRemainderMethod(m)}
                      >
                        {labels[m]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      {ready && !editing && (
        <>
          <h4>Payment breakdown</h4>
          <table className="checkout-breakdown">
            <tbody>
              {isValue ? (
                <>
                  <tr>
                    <td>
                      {labels[method]} · {value?.code ?? "Credit note"}
                    </td>
                    <td>{money(used / 100)}</td>
                  </tr>
                  {remainder > 0 && (
                    <tr>
                      <td>{labels[remainderMethod]}</td>
                      <td>{money(remainder / 100)}</td>
                    </tr>
                  )}
                </>
              ) : (
                <tr>
                  <td>{labels[method]}</td>
                  <td>{money(price / 100)}</td>
                </tr>
              )}
              <tr>
                <th>Total</th>
                <th>{money(price / 100)}</th>
              </tr>
            </tbody>
          </table>
        </>
      )}
      {(method === "card" || remainderMethod === "card") && (
        <p className="small">
          Take the Card amount on the salon’s physical terminal before
          confirming. This button records the payment; it does not charge the
          saved guarantee card.
        </p>
      )}
      {!db && (
        <p role="alert">Connect to Supabase to record checkout payments.</p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="record-actions">
        {ready && !editing && !loading && (
        <button
          className="primary"
          disabled={!db || !ready || editing || busy || loading}
          onClick={() => void confirm()}
        >
          {busy ? "Saving…" : "Complete Appointment"}
        </button>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            choose("");
          }}
        >
          Cancel checkout
        </button>
      </div>
    </section>
  );
}

export function CheckoutHistory({
  db,
  appointment,
}: {
  db: SupabaseClient | null;
  appointment: Appointment;
}) {
  const [rows, setRows] = useState<
    { id: string; method: string; amount: number }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!db) return;
    let active = true;
    void db
      .from("appointment_payments")
      .select("id,method,amount")
      .eq("appointment_id", appointment.id)
      .order("recorded_at")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setRows(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [db, appointment.id]);
  return (
    <section>
      <h3>Recorded payment</h3>
      {error ? (
        <p role="alert">Unable to load payment breakdown: {error}</p>
      ) : rows.length ? (
        <table className="checkout-breakdown">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{labels[r.method] ?? r.method}</td>
                <td>{money(Number(r.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>
          {Number(appointment.price) === 0
            ? "No payment required"
            : (labels[appointment.payment_method ?? ""] ??
              appointment.payment_method ??
              "Not recorded")}{" "}
          · {money(Number(appointment.price))}
        </p>
      )}
    </section>
  );
}
