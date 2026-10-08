import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
export const staffReportNames = {
  clock: "Clock In Clock Out Report",
  payroll: "Payroll Report",
  hr: "HR Log",
};
type Kind = keyof typeof staffReportNames;
type Row = Record<string, string | number | null | boolean>;
const duration = (value: Row[string]) => {
  const n = Math.round(Number(value));
  return `${String(Math.floor(Math.abs(n) / 60)).padStart(2, "0")}:${String(Math.abs(n) % 60).padStart(2, "0")}`;
};
const money = (v: Row[string]) =>
  v == null
    ? "Not configured"
    : new Intl.NumberFormat("en-IE", {
        style: "currency",
        currency: "EUR",
      }).format(Number(v));
const clock = (v: Row[string]) =>
  v == null
    ? "—"
    : new Date(String(v)).toLocaleTimeString("en-IE", {
        timeZone: "Europe/Dublin",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
const difference = (v: Row[string]) =>
  v == null
    ? "—"
    : `${Number(v) > 0 ? "+" : Number(v) < 0 ? "−" : ""}${duration(v)}`;
const date = (v: Row[string]) =>
  new Date(`${v}T12:00:00Z`).toLocaleDateString("en-IE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
export default function StaffReports({
  kind,
  db,
  onBack,
}: {
  kind: Kind;
  db: SupabaseClient | null;
  onBack: () => void;
}) {
  const [staff, setStaff] = useState<
      { id: number; name: string; active: boolean }[]
    >([]),
    [selected, setSelected] = useState("");
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [from, setFrom] = useState(day),
    [to, setTo] = useState(day),
    [rows, setRows] = useState<Row[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [description, setDescription] = useState("");
  useEffect(() => {
    let active = true;
    if (db)
      void db.rpc("report_staff_options").then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setStaff(data || []);
      });
    return () => {
      active = false;
    };
  }, [db]);
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!db || busy) return;
    setError("");
    setRows(null);
    if (kind !== "hr" && (!from || !to || from > to)) {
      setError("Choose a valid date range.");
      return;
    }
    setBusy(true);
    try {
      const r = await db.rpc("get_staff_report", {
        p_kind: kind,
        p_staff: kind === "payroll" ? null : Number(selected),
        p_from: kind === "hr" ? null : from,
        p_to: kind === "hr" ? null : to,
      });
      if (r.error) throw r.error;
      setRows(r.data || []);
      setDescription(
        `${kind === "payroll" ? "All staff" : staff.find((s) => String(s.id) === selected)?.name || ""}${kind === "hr" ? " · All recorded history" : ` · ${date(from)} to ${date(to)}`}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const columns: [string, string, (v: Row[string]) => string][] =
    kind === "payroll"
      ? [
          ["name", "Staff Member", String],
          ["expected_minutes", "Expected Hours", duration],
          ["actual_minutes", "Actual Worked Hours", duration],
          ["hourly_rate", "Hourly Rate", money],
          ["total_pay", "Total Pay", money],
          ["open_sessions", "Unfinished Sessions", String],
        ]
      : [
          ["day", "Date", date],
          ["first_clock_in", "First Clock In", clock],
          [
            "expected_start",
            "Expected Shift Start",
            (v) => (v == null ? "—" : duration(v)),
          ],
          ["start_difference", "Start Difference", difference],
          ["last_clock_out", "Last Clock Out", clock],
          [
            "expected_end",
            "Expected Shift End",
            (v) => (v == null ? "—" : duration(v)),
          ],
          ["end_difference", "End Difference", difference],
          ["open_sessions", "Unfinished Sessions", String],
          ...(kind === "hr"
            ? [
                [
                  "notes",
                  "Staff Notes",
                  (v) => (v == null ? "—" : String(v)),
                ] as [string, string, (v: Row[string]) => string],
              ]
            : []),
        ];
  const total =
    rows?.reduce((sum, r) => sum + Number(r.total_pay || 0), 0) || 0;
  function exportCsv() {
    if (!rows) return;
    const records = [
      columns.map((c) => c[1]),
      ...rows.map((r) => columns.map(([key, , format]) => format(r[key]))),
    ];
    if (kind === "payroll")
      records.push([
        "Total",
        duration(rows.reduce((s, r) => s + Number(r.expected_minutes), 0)),
        duration(rows.reduce((s, r) => s + Number(r.actual_minutes), 0)),
        "",
        money(total),
        String(rows.reduce((s, r) => s + Number(r.open_sessions), 0)),
      ]);
    const content = records
      .map((r) => r.map((v) => `"${v.replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind}-report.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="panel reporting-page">
      <button className="back" onClick={onBack}>
        ← Reporting
      </button>
      <h1>{staffReportNames[kind]}</h1>
      <form className="report-filters" onSubmit={generate}>
        {kind !== "payroll" && (
          <label>
            Staff Member
            <select
              required
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Select staff member</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (archived)"}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== "hr" && (
          <>
            <label>
              From Date
              <input
                required
                type="date" lang="en-GB"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              To Date
              <input
                required
                type="date" lang="en-GB"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </>
        )}
        <button className="primary" disabled={busy || !db}>
          {busy ? "Generating…" : "Generate"}
        </button>
      </form>
      <p className="small">
        {kind === "payroll"
          ? "Actual hours sum all completed sessions, excluding clocked-out breaks. Unfinished sessions are excluded. Current profile rates apply to the whole range; salaried, commission and missing-rate pay are not calculated. Expected hours use saved daily shifts, with the weekly pattern as fallback."
          : "Times use Dublin time. Positive differences mean late arrival/departure; negative means early. The final session must be closed before a final clock-out is shown. Days without a scheduled shift have no expected times."}
        {kind === "hr" &&
          " Shows all dated notes (removed notes are marked), and differences strictly greater than 15 minutes in either direction."}
      </p>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {rows && (
        <>
          <div className="report-heading">
            <h2>{description}</h2>
            <button className="secondary" onClick={exportCsv}>
              Export to CSV
            </button>
          </div>
          {!rows.length ? (
            <p>No matching records.</p>
          ) : (
            <div className="report-table-scroll">
              <table className="activity-report-table">
                <caption>{staffReportNames[kind]}</caption>
                <thead>
                  <tr>
                    {columns.map(([key, label]) => (
                      <th key={key}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {columns.map(([key, , format]) => (
                        <td
                          key={key}
                          className={key === "notes" ? "hr-report-notes" : ""}
                        >
                          {format(r[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {kind === "payroll" && (
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      <td>
                        {duration(
                          rows.reduce(
                            (s, r) => s + Number(r.expected_minutes),
                            0,
                          ),
                        )}
                      </td>
                      <td>
                        {duration(
                          rows.reduce(
                            (s, r) => s + Number(r.actual_minutes),
                            0,
                          ),
                        )}
                      </td>
                      <td>—</td>
                      <td>{money(total)}</td>
                      <td>
                        {rows.reduce((s, r) => s + Number(r.open_sessions), 0)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
