import { voucherDate } from "./dateFormats";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client, LocalStaffData, Voucher } from "./domain";
import { localClient, assignedVouchers, euro } from "./clientModel";
export default function ClientProfile({
  live,
  db,
  data,
  setData,
  onSaved,
  onHome,
  onBuy,
}: {
  live: boolean;
  db: SupabaseClient | null;
  data: LocalStaffData;
  setData: Dispatch<SetStateAction<LocalStaffData>>;
  onSaved: (c: Client) => void;
  onHome: () => void;
  onBuy: () => void;
}) {
  const [profile, setProfile] = useState<Client>(localClient(data)),
    [vouchers, setVouchers] = useState<Voucher[]>([]),
    [busy, setBusy] = useState(live),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    if (!live) {
      setVouchers(assignedVouchers(data, localClient(data).email));
      return;
    }
    void (async () => {
      const [p, v] = await Promise.all([
        db!.rpc("get_my_profile"),
        db!.rpc("get_my_vouchers"),
      ]);
      if (stopped) return;
      setBusy(false);
      if (p.error || v.error) {
        setError((p.error || v.error)!.message);
        return;
      }
      setProfile(p.data);
      setVouchers(v.data || []);
      onSaved(p.data);
    })().catch((e) => {
      if (!stopped) {
        setBusy(false);
        setError(e.message);
      }
    });
    return () => {
      stopped = true;
    };
  }, [live, db, data.vouchers]);
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!profile.name.trim() || !profile.phone.trim())
        throw Error("Name and phone number are required.");
      let saved: Client;
      if (live) {
        const r = await db!.rpc("update_my_profile", {
          p_name: profile.name,
          p_phone: profile.phone,
          p_email_marketing: !!profile.marketing_email,
          p_sms_marketing: !!profile.marketing_sms,
          p_whatsapp_marketing: !!profile.marketing_whatsapp,
          p_revision: profile.revision,
        });
        if (r.error) throw r.error;
        if (!alive.current) return;
        saved = r.data;
      } else {
        const previous = localClient(data);
        if (previous.revision !== profile.revision)
          throw Error("Your profile changed. Reload before saving.");
        saved = { ...profile, revision: profile.revision + 1 };
        setData((d) => ({
          ...d,
          clients: [...d.clients.filter((c) => c.id !== saved.id), saved],
          activity: [
            ...d.activity,
            {
              id: crypto.randomUUID(),
              client_id: saved.id,
              action: "client_self_profile_updated",
              created_at: new Date().toISOString(),
              actor_name: saved.name,
              details: { before: previous, after: saved },
            },
          ],
        }));
      }
      if (!alive.current) return;
      setProfile(saved);
      onSaved(saved);
      setMessage("Your profile has been saved.");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="client-profile">
      <button className="back" onClick={onHome}>
        ← Booking home
      </button>
      <h1>My Profile</h1>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="auth-message">
          {message}
        </p>
      )}
      <div className="profile-layout">
        <section className="panel">
          <h2>Your details</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Name
                <input
                  required
                  value={profile.name}
                  onChange={(e) =>
                    setProfile({ ...profile, name: e.target.value })
                  }
                />
              </label>
              <label>
                Phone number
                <input
                  type="tel"
                  required
                  value={profile.phone}
                  onChange={(e) =>
                    setProfile({ ...profile, phone: e.target.value })
                  }
                />
              </label>
              <label>
                Email address
                <input type="email" readOnly value={profile.email} />
              </label>
              <fieldset className="marketing-options">
                <legend>Marketing preferences</legend>
                <p>
                  Choose how you’d like to receive offers and salon news. These
                  choices do not change appointment confirmations.
                </p>
                {(["email", "sms", "whatsapp"] as const).map((channel) => (
                  <label className="check" key={channel}>
                    <input
                      type="checkbox"
                      checked={!!profile[`marketing_${channel}`]}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          [`marketing_${channel}`]: e.target.checked,
                        })
                      }
                    />
                    {channel === "email"
                      ? "Email"
                      : channel === "sms"
                        ? "SMS"
                        : "WhatsApp"}
                  </label>
                ))}
              </fieldset>
              <button className="primary">Save my profile</button>
            </fieldset>
          </form>
        </section>
        <section className="panel">
          <h2>My Vouchers</h2>
          <p>Vouchers assigned to {profile.email}.</p>
          {!vouchers.length && <p>You don’t have any assigned vouchers yet.</p>}
          {vouchers.map((v) => (
            <article className="profile-voucher" key={v.id}>
              <strong>{v.code}</strong>
              <h3>{euro(Number(v.balance ?? v.original_amount))} remaining</h3>
              <p>
                Assigned to: {v.assigned_client_name}
                <br />
                Expires: {voucherDate(v.expires_on)}
              </p>
              {v.demo_purchase && <small>Demo voucher</small>}
              {v.expires_on < new Date().toISOString().slice(0, 10) && (
                <strong> · Expired</strong>
              )}
            </article>
          ))}
          <button className="secondary" onClick={onBuy}>
            Buy a Voucher
          </button>
        </section>
      </div>
    </section>
  );
}
