import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
export type ManagedTreatment = {
  id: number;
  name: string;
  category: string;
  description?: string;
  duration: number;
  price: number;
  patch_required: boolean;
  revision?: number;
  active?: boolean;
  guarantee_required?: boolean;
  rebook_window?: string | null;
};
export default function TreatmentManagement({
  db,
  onHome,
  onChanged,
}: {
  db: SupabaseClient | null;
  onHome: () => void;
  onChanged: () => void;
}) {
  const [treatments, setTreatments] = useState<ManagedTreatment[]>([]),
    [categoryFilter, setCategoryFilter] = useState(""),
    [draft, setDraft] = useState<ManagedTreatment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (!db) return;
    void db
      .from("treatments")
      .select("*")
      .eq("active", true)
      .order("category")
      .order("name")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setTreatments(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [db]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!db || !draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await db.rpc("save_treatment", {
        p_id: draft.id,
        p_name: draft.name,
        p_description: draft.description ?? "",
        p_duration: Number(draft.duration),
        p_price: Number(draft.price),
        p_patch_required: draft.patch_required,
        p_revision: draft.revision ?? 0,
        p_guarantee_required: draft.guarantee_required !== false,
        p_rebook_window: draft.rebook_window || null,
      });
      if (r.error) throw r.error;
      setTreatments((ts) => ts.map((t) => (t.id === draft.id ? r.data : t)));
      setDraft(null);
      setMessage(
        "Treatment saved. Existing bookings retain their recorded treatment details.",
      );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="management-page">
      <button className="back" onClick={onHome}>
        ← Staff Home
      </button>
      <h1>Treatment Management</h1>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!draft && <label style={{ maxWidth: 420, marginBottom: 20 }}>Treatment category
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {[...new Set(treatments.map(t => t.category))].map(category => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>}
      {!db && <p>Connect to Supabase to manage treatments.</p>}
      {draft ? (
        <form className="panel" onSubmit={(e) => void save(e)}>
          <h2>Edit Treatment · {draft.category}</h2>
          <label>
            Treatment name
            <input
              required
              maxLength={200}
              value={draft.name}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={5000}
              value={draft.description ?? ""}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <label>
            Length (minutes)
            <input
              required
              type="number"
              min={1}
              max={720}
              step={1}
              value={draft.duration}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, duration: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Price (€)
            <input
              required
              type="number"
              min={0}
              max={999999.99}
              step="0.01"
              value={draft.price}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, price: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Rebook Window
            <select value={draft.rebook_window || ""} disabled={busy} onChange={e => setDraft({...draft,rebook_window:e.target.value || null})}>
              <option value="">Not set</option>
              {["1 week","2 weeks","4 weeks","2 months","3 months","6 months","12 months"].map(window => <option key={window} value={window}>{window}</option>)}
            </select>
          </label>
          <label>
            Patch test required
            <select
              value={draft.patch_required ? "yes" : "no"}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, patch_required: e.target.value === "yes" })
              }
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Booking guarantee required
            <select
              value={draft.guarantee_required === false ? "no" : "yes"}
              disabled={busy}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  guarantee_required: e.target.value === "yes",
                })
              }
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <p className="small">
            No allows this service to be booked without card details, even when
            the client normally requires a booking guarantee.
          </p>
          <div className="record-actions">
            <button className="primary" disabled={busy}>
              Save Treatment
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        [...new Set(treatments.map((t) => t.category))].filter(category => !categoryFilter || category === categoryFilter).map((category) => (
          <section className="panel" key={category}>
            <h2>{category}</h2>
            <div className="management-list">
              {treatments
                .filter((t) => t.category === category)
                .map((t) => (
                  <button
                    className="treatment-management-row"
                    key={t.id}
                    onClick={() => {
                      setDraft({ ...t });
                      setError("");
                      setMessage("");
                    }}
                  >
                    <strong>{t.name}</strong>
                    <span>
                      {t.duration} mins · €{Number(t.price).toFixed(2)} · Patch
                      test: {t.patch_required ? "Yes" : "No"}
                    </span>
                    <strong style={{ color: "#292822", textDecoration: "underline", fontSize: 16 }}>Edit →</strong>
                  </button>
                ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
