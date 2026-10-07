import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  viewPermissions,
  actionPermissions,
  type Permissions,
} from "./permissions";
type Member = {
  id: number;
  name: string;
  role: string;
  revision: number;
  permissions: Permissions;
};
export default function PermissionManagement({
  db,
  onHome,
  onChanged,
}: {
  db: SupabaseClient | null;
  onHome: () => void;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [id, setId] = useState(0),
    [grants, setGrants] = useState<Permissions>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (!db) return;
    void db.rpc("list_staff_permissions").then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      else {
        setMembers(data);
        if (data.length) {
          setId(data[0].id);
          setGrants(data[0].permissions);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [db]);
  const member = members.find((s) => s.id === id);
  async function save() {
    if (!db || !member || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await db.rpc("save_staff_permissions", {
        p_staff: id,
        p_grants: grants,
        p_revision: member.revision,
      });
      if (r.error) throw r.error;
      setMembers((ms) =>
        ms.map((s) =>
          s.id === id
            ? { ...s, permissions: grants, revision: s.revision + 1 }
            : s,
        ),
      );
      setMessage(
        "Permissions saved. Changes apply on the next screen refresh or sign-in.",
      );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel management-page">
      <button className="back" onClick={onHome}>
        ← Staff Home
      </button>
      <h1>Permission Management</h1>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <label>
        Staff member
        <select
          value={id}
          disabled={busy}
          onChange={(e) => {
            const selected = members.find(
              (s) => s.id === Number(e.target.value),
            );
            setId(Number(e.target.value));
            setGrants(selected?.permissions ?? {});
            setMessage("");
            setError("");
          }}
        >
          {members.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.role}
            </option>
          ))}
        </select>
      </label>
      {!db && <p>Connect to Supabase to manage permissions.</p>}
      {member && (
        <>
          {[
            ["Can View", viewPermissions],
            ["Can Perform", actionPermissions],
          ].map(([heading, list]) => (
            <fieldset key={heading as string} className="permission-section">
              <legend>{heading as string}</legend>
              {(list as typeof viewPermissions | typeof actionPermissions).map(
                ([key, label]) => (
                  <label className="check" key={key}>
                    <input
                      type="checkbox"
                      checked={!!grants[key]}
                      disabled={
                        busy ||
                        (member.role === "admin" && key === "view.permissions")
                      }
                      onChange={(e) =>
                        setGrants({ ...grants, [key]: e.target.checked })
                      }
                    />
                    {label}
                    {member.role === "admin" && key === "view.permissions"
                      ? " (required for Admin)"
                      : ""}
                  </label>
                ),
              )}
            </fieldset>
          ))}
          <p className="small">
            Can Offer Discounts is saved for future use; discount checkout is
            not available yet.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save Permissions"}
          </button>
        </>
      )}
    </section>
  );
}
