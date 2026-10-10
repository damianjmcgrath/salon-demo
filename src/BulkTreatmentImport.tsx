import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ManagedTreatment } from "./TreatmentManagement";
import { treatmentHeaders, validateTreatmentCsv } from "./treatment-csv.mjs";

const display = (v: unknown) => typeof v === "boolean" ? v ? "Yes" : "No" : v === "" || v == null ? "Not set" : String(v);
type Preview = ReturnType<typeof validateTreatmentCsv>;
export default function BulkTreatmentImport({ db, onClose, onImported }: {
  db: SupabaseClient; onClose: () => void;
  onImported: (treatments: ManagedTreatment[], changed: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false),
    [error, setError] = useState(""), [preview, setPreview] = useState<Preview | null>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  async function upload() {
    if (!file || busy) return;
    setBusy(true); setError(""); setPreview(null);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Choose a CSV file smaller than 2 MB.");
      const text = await file.text();
      const current = await db.from("treatments").select("*").eq("active", true).order("id");
      if (current.error) throw current.error;
      setPreview(validateTreatmentCsv(text, current.data ?? []));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!preview || preview.errors.length || !preview.changes.length || busy) return;
    setBusy(true); setError("");
    try {
      const response = await db.rpc("bulk_update_treatments", { p_rows: preview.updates });
      if (response.error) throw response.error;
      onImported(response.data.treatments, response.data.changed);
    } catch (e) { setError((e as Error).message + " No treatment changes were applied."); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><section className="panel modal treatment-import-modal" ref={dialog} tabIndex={-1}
    role="dialog" aria-modal="true" aria-labelledby="treatment-import-title" onKeyDown={e => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href]');
        if (!controls?.length) { e.preventDefault(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}>
    <h2 id="treatment-import-title">Upload CSV to Bulk Amend Treatments</h2>
    <p>You can upload a CSV file in the required format to update the treatments included in this file. You can use this to bulk amend treatment names, prices, rebook windows, or other data. Any changes to treatment names will also change historical appointment names and existing staff diary entries. Price and duration changes apply to new bookings; existing bookings keep their recorded prices and durations.</p>
    <p>The CSV must only contain the following fields, in this exact order:</p>
    <ol>{treatmentHeaders.map(h => <li key={h}>{h}</li>)}</ol>
    <p>It must be a comma-separated CSV file. Keep existing Treatment IDs unchanged. Treatments omitted from the file are left unchanged; new treatments cannot be created through this import.</p>
    <p>Rebook Window: 1 week, 2 weeks, 4 weeks, 2 months, 3 months, 6 months or 12 months. Blank means not set. Guarantee and patch-test fields: Yes or No; blank keeps the current setting. Prices must be numerical, without € symbols.</p>
    <label>Select CSV file (Browse)<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(""); }} /></label>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {preview && (preview.errors.length ? <div role="alert"><h3>Nothing will be imported</h3><ul>{preview.errors.map((s, i) => <li key={i}>{s}</li>)}</ul></div> : <div aria-live="polite">
      <h3>Preview changes</h3>
      <p>{preview.updates.length} treatments checked. {new Set(preview.changes.map(c => c.id)).size} treatments have changes. Nothing has been saved yet.</p>
      {preview.changes.length ? <div className="report-table-scroll"><table className="activity-report-table"><thead><tr><th>Treatment ID</th><th>Treatment</th><th>Field</th><th>Current value</th><th>New value</th></tr></thead><tbody>{preview.changes.map((c, i) => <tr key={i}><td>{c.id}</td><td>{c.treatment}</td><td>{c.field}</td><td>{display(c.before)}</td><td>{display(c.after)}</td></tr>)}</tbody></table></div> : <p>No changes were found.</p>}
    </div>)}
    <div className="record-actions">
      {preview && !preview.errors.length ? <button className="primary" disabled={busy || !preview.changes.length} onClick={() => void confirm()}>{busy ? "Applying changes…" : "Confirm Changes"}</button>
        : <button className="primary" disabled={!file || busy} onClick={() => void upload()}>{busy ? "Validating…" : "Upload"}</button>}
      <button className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
    </div>
  </section></div>;
}
