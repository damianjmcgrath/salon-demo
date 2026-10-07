import VoucherStatusReport from "./VoucherStatusReport";
import RevolutSandbox from "./RevolutSandbox";
import { useRef, useState } from "react";
import StaffReports, { staffReportNames } from "./StaffReports";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = {
  period_start: string;
  appointments_scheduled: number;
  appointments_completed: number;
  card_payments: number;
  card_terminal_fee: number;
  retained_card_payments: number;
  cash_payments: number;
  vouchers_used: number;
  credit_notes_used: number;
  total_payments: number;
};
const columns = [
  ["appointments_scheduled", "Appointments Scheduled"],
  ["appointments_completed", "Appointments Completed"],
  ["card_payments", "Card Payments Taken"],
  ["card_terminal_fee", "Card Terminal Fee"],
  ["retained_card_payments", "Retained Card Payments"],
  ["cash_payments", "Cash Payments Taken"],
  ["vouchers_used", "Vouchers Used"],
  ["credit_notes_used", "Credit Notes Used"],
  ["total_payments", "Total Payments"],
] as const;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const money = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    n,
  );
export default function Reporting({
  db,
  onHome,
  allowSandbox = false,
}: {
  db: SupabaseClient | null;
  onHome: () => void;
  allowSandbox?: boolean;
}) {
  const [sandbox, setSandbox] = useState(false);
  const [vouchers, setVouchers] = useState(false);
  const [staffReport, setStaffReport] = useState<
    keyof typeof staffReportNames | null
  >(null);
  const [period, setPeriod] = useState<"day" | "month" | null>(null);
  const [from, setFrom] = useState(today()),
    [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [generated, setGenerated] = useState({ from: "", to: "" });
  const version = useRef(0);
  function open(next: "day" | "month" | null) {
    version.current++;
    setPeriod(next);
    setFrom(next === "month" ? today().slice(0, 7) : today());
    setTo(next === "month" ? today().slice(0, 7) : today());
    setRows(null);
    setError("");
    setBusy(false);
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setRows(null);
    if (!from || !to || from > to) {
      setError("Choose a From date before or equal to the To date.");
      return;
    }
    if (!db) {
      setError("Connect to Supabase to generate this report.");
      return;
    }
    const current = ++version.current;
    setBusy(true);
    const end =
      period === "month"
        ? new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0))
            .toISOString()
            .slice(0, 10)
        : to;
    try {
      const result = await db.rpc("get_activity_report", {
        p_from: period === "month" ? `${from}-01` : from,
        p_to: end,
        p_period: period,
      });
      if (current !== version.current) return;
      if (result.error) throw result.error;
      setRows(
        (result.data || []).map(
          (r: Row) =>
            Object.fromEntries(
              Object.entries(r).map(([k, v]) => [
                k,
                k === "period_start" ? v : Number(v),
              ]),
            ) as Row,
        ),
      );
      setGenerated({ from, to });
    } catch (e) {
      if (current === version.current) setError((e as Error).message);
    } finally {
      if (current === version.current) setBusy(false);
    }
  }
  const totals = Object.fromEntries(
    columns.map(([key]) => [
      key,
      (rows || []).reduce((sum, r) => sum + r[key], 0),
    ]),
  ) as Record<(typeof columns)[number][0], number>;
  const label = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(
      "en-IE",
      period === "month"
        ? { month: "long", year: "numeric" }
        : { day: "2-digit", month: "2-digit", year: "numeric" },
    );
  function exportCsv() {
    if (!rows) return;
    const csv = [
      [period === "month" ? "Month" : "Date", ...columns.map((c) => c[1])],
      ...rows.map((r) => [
        label(r.period_start),
        ...columns.map(([k], i) => (i < 2 ? String(r[k]) : r[k].toFixed(2))),
      ]),
      [
        "Total",
        ...columns.map(([k], i) =>
          i < 2 ? String(totals[k]) : totals[k].toFixed(2),
        ),
      ],
    ]
      .map((r) =>
        r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${period === "month" ? "monthly" : "daily"}-activity-${generated.from}-to-${generated.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (vouchers)
    return <VoucherStatusReport db={db} onBack={() => setVouchers(false)} />;
  if (sandbox && allowSandbox)
    return <RevolutSandbox db={db} onBack={() => setSandbox(false)} />;
  if (staffReport)
    return (
      <StaffReports
        kind={staffReport}
        db={db}
        onBack={() => setStaffReport(null)}
      />
    );
  return (
    <section className="panel reporting-page">
      <button className="back" onClick={() => (period ? open(null) : onHome())}>
        {period ? "← Reporting" : "← Home"}
      </button>
      <h1>
        {period
          ? `${period === "day" ? "Daily" : "Monthly"} Activity Report`
          : "Reporting"}
      </h1>
      {!period ? (
        <>
          <h2>Active Reports</h2>
          {allowSandbox && (
            <p>
              <button onClick={() => setSandbox(true)}>
                Revolut Sandbox Test
              </button>
            </p>
          )}
          <div className="workspace-grid">
            <button
              className="panel workspace-card"
              onClick={() => setVouchers(true)}
            >
              <h2>Voucher Status</h2>
              <p>Voucher purchases, redemptions and remaining balances.</p>
              <span>Open →</span>
            </button>
            {(
              Object.entries(staffReportNames) as [
                keyof typeof staffReportNames,
                string,
              ][]
            ).map(([key, name]) => (
              <button
                className="panel workspace-card"
                key={key}
                onClick={() => setStaffReport(key)}
              >
                <h2>{name}</h2>
                <p>
                  {key === "payroll"
                    ? "Expected hours, worked hours and hourly pay."
                    : key === "hr"
                      ? "Staff notes and attendance exceptions."
                      : "First arrival and final departure against scheduled shifts."}
                </p>
                <span>Open →</span>
              </button>
            ))}
            {(["day", "month"] as const).map((p) => (
              <button
                key={p}
                className="panel workspace-card"
                onClick={() => open(p)}
              >
                <h2>{p === "day" ? "Daily" : "Monthly"} Activity Report</h2>
                <p>
                  Appointments and recorded payments by{" "}
                  {p === "day" ? "date" : "month"}.
                </p>
                <span>Open →</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <form className="report-filters" onSubmit={generate}>
            <label>
              From {period === "month" ? "Month" : "Date"}
              <input
                required
                type={period === "month" ? "month" : "date"}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              To {period === "month" ? "Month" : "Date"}
              <input
                required
                type={period === "month" ? "month" : "date"}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Generating…" : "Generate"}
            </button>
          </form>
          <p className="small">
            Scheduled counts exclude cancelled appointments. Completed counts
            use appointment dates. Payments use the date completion was recorded
            in Dublin time. Amounts are recorded treatment prices; card fees are
            calculated at 1.5% and rounded to cents for each row.
          </p>
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          {rows && (
            <>
              <div className="report-heading">
                <h2>
                  {generated.from} to {generated.to}
                </h2>
                <button className="secondary" onClick={exportCsv}>
                  Export to CSV
                </button>
              </div>
              <div className="report-table-scroll">
                <table className="activity-report-table">
                  <caption>
                    {period === "day" ? "Daily" : "Monthly"} Activity Report —
                    amounts in euros
                  </caption>
                  <thead>
                    <tr>
                      <th>{period === "month" ? "Month" : "Date"}</th>
                      {columns.map(([k, title]) => (
                        <th key={k}>{title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.period_start}>
                        <th scope="row">{label(r.period_start)}</th>
                        {columns.map(([k], i) => (
                          <td key={k}>{i < 2 ? r[k] : money(r[k])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Total</th>
                      {columns.map(([k], i) => (
                        <td key={k}>{i < 2 ? totals[k] : money(totals[k])}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
