import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
type Entry = { id: string; communication_type: string; note: string; staff_name: string; recorded_at: string };
const types = ["Phone Call", "Email", "WhatsApp", "In Person"];
function timestamp(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}
export default function ClientCommunications({ db, clientId, onSaved }: { db: SupabaseClient | null; clientId: string; onSaved: () => void }) {
  const [history, setHistory] = useState<Entry[]>([]);
  const [adding, setAdding] = useState(false), [type, setType] = useState(types[0]), [note, setNote] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setHistory([]); setLoading(true); setError("");
    if (!db) { setLoading(false); setError("Connect to Supabase to record communications."); return; }
    void db.from("client_communications").select("*").eq("client_id", clientId).order("recorded_at", { ascending: false }).then(({ data, error }) => {
      if (!current) return;
      setLoading(false);
      if (error) setError(error.message); else setHistory(data || []);
    });
    return () => { current = false; };
  }, [db, clientId]);
  function cancel() { setAdding(false); setNote(""); setType(types[0]); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!db || busy || !note.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await db.rpc("record_client_communication", { p_client: clientId, p_type: type, p_note: note.trim() });
      if (result.error) throw result.error;
      setHistory(h => [result.data, ...h]); cancel(); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel">
    <h2>Communications</h2>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {!adding ? <button className="primary" disabled={!db} onClick={() => setAdding(true)}>Add Communication</button> :
      <form onSubmit={save}>
        <label>Communication Type<select value={type} disabled={busy} onChange={e => setType(e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Communication Notes<textarea required maxLength={5000} rows={5} value={note} disabled={busy} onChange={e => setNote(e.target.value)} autoFocus /></label>
        <div className="record-actions"><button className="primary" disabled={busy || !note.trim()}>{busy ? "Saving…" : "Save"}</button><button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button></div>
      </form>}
    <h2>Communication History</h2>
    {loading ? <p>Loading communications…</p> : !history.length ? <p>No communications recorded yet.</p> :
      <div className="report-table-scroll"><table className="activity-report-table"><thead><tr><th>Communication Type</th><th>Communication Note</th><th>Done By</th><th>Date/Time</th></tr></thead>
        <tbody>{history.map(h => <tr key={h.id}><td>{h.communication_type}</td><td style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{h.note}</td><td>{h.staff_name}</td><td>{timestamp(h.recorded_at)}</td></tr>)}</tbody>
      </table></div>}
  </section>;
}
