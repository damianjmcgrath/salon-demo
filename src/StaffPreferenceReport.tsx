import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestErrorMessage } from "./requestErrors";
export default function StaffPreferenceReport({
  db,
  onBack,
}: {
  db: SupabaseClient | null;
  onBack: () => void;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [data, setData] = useState<any>({ staff: [], rows: [] }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(start = from, end = to) {
    setBusy(true);
    setError("");
    try {
      if (!db) throw Error("Connect to the salon to generate this report.");
      if (!start !== !end || start > end)
        throw Error(
          "Choose both dates in the correct order, or leave both blank.",
        );
      const r = await db.rpc("get_staff_preference_report", {
        p_from: start || null,
        p_to: end || null,
      });
      if (r.error) throw r.error;
      setData(r.data);
    } catch (e) {
      setError(requestErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load("", "");
  }, [db]);
  const headings = [
    "Treatment Name",
    ...data.staff.map((s: any) => s.name + " specifically chosen"),
    "No preference",
    "Not recorded",
    "Total Bookings",
  ];
  const values = (r: any) => [
    r.treatment_name,
    ...data.staff.map((s: any) => Number(r.selected[s.id] || 0)),
    Number(r.no_preference),
    Number(r.unknown),
    Number(r.total),
  ];
  function csv() {
    const body = [headings, ...data.rows.map(values)]
      .map((r) =>
        r
          .map((v: any) => '"' + String(v).replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "staff-preference-report.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="panel">
      <button className="back" onClick={onBack}>
        ← Reporting
      </button>
      <h1>Staff Preference Report</h1>
      <form
        className="report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          From Date
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To Date
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          Generate
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setFrom("");
            setTo("");
            void load("", "");
          }}
        >
          All Dates
        </button>
      </form>
      <p className="small">
        Dates refer to appointment dates. Includes all appointments ever booked,
        including cancellations. Historical bookings without recorded
        preferences appear as Not recorded.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy ? (
        <p>Loading report…</p>
      ) : (
        <>
          <button onClick={csv}>Export to CSV</button>
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
                {data.rows.map((r: any) => (
                  <tr key={r.treatment_id + "-" + r.treatment_name}>
                    {values(r).map((v: any, i: number) => (
                      <td key={i}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && <p>No booked treatments in this date range.</p>}
        </>
      )}
    </section>
  );
}
