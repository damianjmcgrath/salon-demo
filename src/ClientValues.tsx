import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
type Row = Record<string, any>;
const money = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    Number(n),
  );
const when = (v: string) =>
  new Date(v).toLocaleString("en-IE", { timeZone: "Europe/Dublin" });
const day = (v: string) =>
  new Date(`${v}T12:00:00Z`).toLocaleDateString("en-IE");
function Table({
  rows,
  columns,
  empty,
}: {
  rows: Row[];
  columns: [string, (r: Row) => string][];
  empty: string;
}) {
  return !rows.length ? (
    <p>{empty}</p>
  ) : (
    <div className="report-table-scroll">
      <table className="activity-report-table">
        <thead>
          <tr>
            {columns.map(([name]) => (
              <th key={name}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map(([name, format]) => (
                <td
                  key={name}
                  className={name === "Reason" ? "hr-report-notes" : undefined}
                >
                  {format(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function ClientValues({
  kind,
  db,
  clientId,
  onSaved,
}: {
  kind: "vouchers" | "credit";
  db: SupabaseClient | null;
  clientId: string;
  onSaved: () => void;
}) {
  const [data, setData] = useState<{
    vouchers: Row[];
    credit_notes: Row[];
    redemptions: Row[];
  }>({ vouchers: [], credit_notes: [], redemptions: [] });
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    if (!db) {
      setError("Connect to Supabase to view vouchers and credit notes.");
      setLoading(false);
      return;
    }
    void db
      .rpc("get_client_values", { p_client: clientId })
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error) setError(error.message);
        else setData(data);
      });
    return () => {
      active = false;
    };
  }, [db, clientId]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!db || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await db.rpc("create_client_credit_note", {
        p_client: clientId,
        p_amount: Number(amount),
        p_reason: reason,
      });
      if (r.error) throw r.error;
      setData((d) => ({
        ...d,
        credit_notes: [
          { ...r.data, balance: r.data.amount },
          ...d.credit_notes,
        ],
      }));
      setCreating(false);
      setAmount("");
      setReason("");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const vouchers: [string, (r: Row) => string][] = [
    ["Purchase Date/Time", (r) => when(r.created_at)],
    ["Purchased By", (r) => r.purchaser],
    ["Voucher Code", (r) => r.code],
    ["Voucher Amount", (r) => money(r.original_amount)],
    ["Remaining Amount", (r) => money(r.balance)],
    ["Expiry Date", (r) => day(r.expires_on)],
  ];
  const used: [string, (r: Row) => string][] = [
    ["Date/Time Used", (r) => when(r.used_at)],
    ["Amount Used", (r) => money(r.amount)],
    ["Treatment", (r) => r.treatment_name],
    ["Staff Member", (r) => r.staff_name],
  ];
  return (
    <section className="panel">
      <h2>{kind === "vouchers" ? "Vouchers" : "Credit Notes"}</h2>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : kind === "vouchers" ? (
        <>
          <h3>Active Vouchers</h3>
          <Table
            rows={data.vouchers.filter(
              (v) => !v.expired && Number(v.balance) > 0,
            )}
            columns={vouchers}
            empty="No active vouchers."
          />
          <h3>Used Vouchers</h3>
          <Table
            rows={data.redemptions.filter((r) => r.voucher_id)}
            columns={used}
            empty="No voucher redemptions recorded."
          />
          <h3>Expired Vouchers</h3>
          <Table
            rows={data.vouchers.filter((v) => v.expired)}
            columns={vouchers}
            empty="No expired vouchers."
          />
        </>
      ) : (
        <>
          {!creating && (
            <button
              className="primary"
              disabled={!db}
              onClick={() => setCreating(true)}
            >
              Create New Credit Note
            </button>
          )}
          {creating && (
            <form onSubmit={save}>
              <label>
                Amount (€)
                <input
                  required
                  type="number"
                  min="0.01"
                  max="999999.99"
                  step="0.01"
                  value={amount}
                  disabled={busy}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Reason
                <textarea
                  required
                  maxLength={5000}
                  disabled={busy}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="record-actions">
                <button className="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save Credit Note"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          <h3>Active Credit Notes</h3>
          <Table
            rows={data.credit_notes.filter((n) => Number(n.balance) > 0)}
            columns={[
              ["Date/Time Created", (r) => when(r.created_at)],
              ["Created By", (r) => r.staff_name],
              ["Credit Note Amount", (r) => money(r.amount)],
              ["Remaining Amount", (r) => money(r.balance)],
              ["Reason", (r) => r.reason],
            ]}
            empty="No active credit notes."
          />
          <h3>Used Credit Notes</h3>
          <Table
            rows={data.redemptions.filter((r) => r.credit_note_id)}
            columns={used}
            empty="No credit note redemptions recorded."
          />
        </>
      )}
    </section>
  );
}
