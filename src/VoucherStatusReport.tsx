import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
type Use = {
  used_at: string;
  treatment_name: string;
  appointment_date: string;
  start_minute: number;
};
type Voucher = {
  id: string;
  code: string;
  purchased_at: string;
  purchased_by: string;
  purchased_for: string;
  original_amount: number;
  redeemed_amount: number;
  balance: number;
  uses: Use[];
};
const money = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    n,
  );
const timestamp = (s: string) =>
  new Date(s)
    .toLocaleString("en-GB", {
      timeZone: "Europe/Dublin",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
    .replace(",", "");
const appointmentTime = (u: Use) =>
  `${u.appointment_date.slice(8, 10)}/${u.appointment_date.slice(5, 7)}/${u.appointment_date.slice(2, 4)} ${String(Math.floor(u.start_minute / 60)).padStart(2, "0")}:${String(u.start_minute % 60).padStart(2, "0")}`;
const headings = [
  "Voucher ID",
  "Date Purchased",
  "Purchased By",
  "Purchased For",
  "Date Used",
  "Part or Full Used",
  "Used For",
  "Appointment Date Time",
];
const cells = (v: Voucher) => [
  v.code,
  timestamp(v.purchased_at),
  v.purchased_by,
  v.purchased_for,
  v.uses.length ? v.uses.map((u) => timestamp(u.used_at)).join("\n") : "-",
  Number(v.redeemed_amount) > 0
    ? Number(v.balance) > 0
      ? "Part"
      : "Full"
    : "-",
  v.uses.length ? v.uses.map((u) => u.treatment_name).join("\n") : "-",
  v.uses.length ? v.uses.map(appointmentTime).join("\n") : "-",
];
const safeCsv = (value: string) =>
  '"' +
  (/^[=+@\-\t\r]/.test(value) && value !== "-"
    ? "'" + value
    : value
  ).replaceAll('"', '""') +
  '"';
export default function VoucherStatusReport({
  db,
  onBack,
}: {
  db: SupabaseClient | null;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<Voucher[]>([]),
    [filter, setFilter] = useState("all"),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    if (!db) {
      setError("Connect to Supabase to view this report.");
      setBusy(false);
      return;
    }
    void db.rpc("get_voucher_status_report").then(({ data, error }) => {
      if (!current) return;
      setBusy(false);
      if (error) setError(error.message);
      else setRows(data ?? []);
    });
    return () => {
      current = false;
    };
  }, [db]);
  const shown = rows.filter(
    (v) =>
      filter === "all" ||
      (filter === "used"
        ? Number(v.redeemed_amount) > 0
        : Number(v.balance) > 0),
  );
  const total = (key: "original_amount" | "redeemed_amount" | "balance") =>
    rows.reduce((sum, v) => sum + Number(v[key]), 0);
  function exportCsv() {
    const csv = [headings, ...shown.map(cells)]
      .map((row) => row.map(safeCsv).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `voucher-status-${filter}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="panel reporting-page">
      <button className="back" onClick={onBack}>
        ← Reporting
      </button>
      <h1>Voucher Status</h1>
      {error ? (
        <p role="alert" className="auth-error">
          {error}
        </p>
      ) : busy ? (
        <p>Loading vouchers…</p>
      ) : (
        <>
          <div className="voucher-report-totals">
            <p>
              Number of Vouchers Sold: <strong>{rows.length}</strong>
            </p>
            <p>
              Total Value of Vouchers:{" "}
              <strong>{money(total("original_amount"))}</strong>
            </p>
            <p>
              Value of Vouchers Redeemed:{" "}
              <strong>{money(total("redeemed_amount"))}</strong>
            </p>
            <p>
              Value of Vouchers waiting to be redeemed:{" "}
              <strong>{money(total("balance"))}</strong>
            </p>
          </div>
          <div className="date-controls">
            <label>
              Voucher filter
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All Vouchers</option>
                <option value="used">Used Vouchers</option>
                <option value="open">Open Vouchers</option>
              </select>
            </label>
            <button className="secondary" onClick={exportCsv}>
              Export to CSV
            </button>
          </div>
          <p className="small">
            Totals cover all vouchers. Part-used vouchers appear in both Used
            and Open views. Open includes any voucher with a remaining balance,
            including expired vouchers. Multiple uses are listed in matching
            order within each row. Purchaser names are shown where recorded.
          </p>
          <div className="report-table-scroll">
            <table className="activity-report-table">
              <thead>
                <tr>
                  {headings.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.length ? (
                  shown.map((v) => (
                    <tr key={v.id}>
                      {cells(v).map((value, i) => (
                        <td key={i} style={{ whiteSpace: "pre-line" }}>
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={headings.length}>No vouchers in this view.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
