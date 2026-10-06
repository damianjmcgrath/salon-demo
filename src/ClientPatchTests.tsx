import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
type Treatment = { id: number; name: string; category: string };
type Entry = {
  id: string;
  staff_name: string;
  recorded_at: string;
  treatments_covered: Treatment[];
};
export default function ClientPatchTests({
  db,
  clientId,
  treatments,
  staff,
  onSaved,
}: {
  db: SupabaseClient | null;
  clientId: string;
  treatments: Treatment[];
  staff: { id: number; name: string; active?: boolean }[];
  onSaved: () => void;
}) {
  const [history, setHistory] = useState<Entry[]>([]),
    [record, setRecord] = useState(false),
    [selected, setSelected] = useState<number[]>([]),
    [performer, setPerformer] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setHistory([]);
    setLoading(true);
    if (!db) {
      setError("Connect to Supabase to record patch tests.");
      setLoading(false);
      return;
    }
    void db
      .from("client_patch_tests")
      .select("*")
      .eq("client_id", clientId)
      .order("recorded_at", { ascending: false })
      .then(({ data, error }) => {
        if (!current) return;
        setLoading(false);
        if (error) setError(error.message);
        else setHistory(data || []);
      });
    return () => {
      current = false;
    };
  }, [db, clientId]);
  const groups = [...new Set(treatments.map((t) => t.category))];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!db || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await db.rpc("record_client_patch_test", {
        p_client: clientId,
        p_staff: Number(performer),
        p_treatments: selected,
      });
      if (r.error) throw r.error;
      setHistory((h) => [r.data, ...h]);
      setSelected([]);
      setPerformer("");
      setRecord(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Patch Tests</h2>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {!record && (
        <button
          className="primary"
          disabled={!db || loading}
          onClick={() => setRecord(true)}
        >
          Record Patch Test
        </button>
      )}
      {record && (
        <form onSubmit={save}>
          <p>Select the treatments covered by this patch test.</p>
          {groups.map((category) => {
            const items = treatments.filter((t) => t.category === category);
            const all = items.every((t) => selected.includes(t.id));
            return (
              <fieldset className="patch-category" key={category}>
                <legend>{category}</legend>
                <label className="patch-check">
                  <input
                    type="checkbox"
                    checked={all}
                    disabled={busy}
                    onChange={() =>
                      setSelected((s) =>
                        all
                          ? s.filter((id) => !items.some((t) => t.id === id))
                          : [...new Set([...s, ...items.map((t) => t.id)])],
                      )
                    }
                  />
                  Select all in {category}
                </label>
                {items.map((t) => (
                  <label className="patch-check" key={t.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selected.includes(t.id)}
                      onChange={() =>
                        setSelected((s) =>
                          s.includes(t.id)
                            ? s.filter((id) => id !== t.id)
                            : [...s, t.id],
                        )
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </fieldset>
            );
          })}
          <label>
            Staff Member Who Performed the Patch Test
            <select
              required
              value={performer}
              disabled={busy}
              onChange={(e) => setPerformer(e.target.value)}
            >
              <option value="">Select staff member</option>
              {staff
                .filter((s) => s.active !== false)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <p>{selected.length} treatments selected</p>
          <div className="record-actions">
            <button
              className="primary"
              disabled={busy || !selected.length || !performer}
            >
              {busy ? "Saving…" : "Save Patch Test"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setRecord(false);
                setSelected([]);
                setPerformer("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <h2>Patch Test History</h2>
      {loading ? (
        <p>Loading patch tests…</p>
      ) : !history.length ? (
        <p>No patch tests recorded yet.</p>
      ) : (
        <div className="report-table-scroll">
          <table className="activity-report-table">
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>Staff Member</th>
                <th>Treatments Covered</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>
                    {new Date(h.recorded_at).toLocaleString("en-IE", {
                      timeZone: "Europe/Dublin",
                    })}
                  </td>
                  <td>{h.staff_name}</td>
                  <td className="hr-report-notes">
                    {h.treatments_covered.map((t) => t.name).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
