import { voucherDate } from "./dateFormats";
import {
  useRef,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client, LocalStaffData, Voucher } from "./domain";
import { localClient, euro, expiryDate, voucherCode } from "./clientModel";
type Treatment = { id: number; name: string; price: number };
export default function VoucherPurchase({
  live,
  db,
  data,
  setData,
  treatments,
  client,
  onHome,
  onProfile,
}: {
  live: boolean;
  db: SupabaseClient | null;
  data: LocalStaffData;
  setData: Dispatch<SetStateAction<LocalStaffData>>;
  treatments: Treatment[];
  client: Client | null;
  onHome: () => void;
  onProfile: () => void;
}) {
  const own = live ? client : localClient(data);
  const [option, setOption] = useState("custom"),
    [customAmount, setCustomAmount] = useState(""),
    [treatmentId, setTreatmentId] = useState(""),
    [card, setCard] = useState(""),
    [holder, setHolder] = useState("Demo Cardholder"),
    [number, setNumber] = useState("4242 4242 4242 4242"),
    [expiry, setExpiry] = useState("12/30"),
    [cvc, setCvc] = useState("123"),
    [ack, setAck] = useState(false),
    [voucher, setVoucher] = useState<Voucher | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [emailOpen, setEmailOpen] = useState(false), [emailTo, setEmailTo] = useState("");
  const emailRequest = useRef(crypto.randomUUID());
  const request = useRef(crypto.randomUUID()),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const selected = treatments.find((t) => t.id === Number(treatmentId)),
    amount = option === "treatment" ? selected?.price || 0 : Number(customAmount);
  async function buy() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (option === "custom" && (!/^\d+(\.\d{1,2})?$/.test(customAmount) || amount < 5 || amount > 500))
        throw Error("Enter an amount between €5.00 and €500.00, with up to two decimal places.");
      if (!amount || !card || !ack)
        throw Error(
          "Choose a value, a demo card and confirm this is a demo purchase.",
        );
      if (
        card === "new_demo" &&
        (!holder.trim() ||
          number.replace(/\D/g, "").length < 12 ||
          !expiry.trim() ||
          !cvc.trim())
      )
        throw Error("Complete the example card fields.");
      let v: Voucher;
      if (live) {
        const r = await db!.rpc("purchase_demo_voucher", {
          p_option: option === "custom" ? customAmount : option,
          p_treatment_id: option === "treatment" ? Number(treatmentId) : null,
          p_for_self: true,
          p_recipient_name: "",
          p_recipient_email: "",
          p_card: card,
          p_ack: ack,
          p_request: request.current,
        });
        if (r.error) throw r.error;
        if (!alive.current) return;
        v = r.data;
      } else {
        if (!own) throw Error("Client profile unavailable.");
        v = {
          id: crypto.randomUUID(),
          code: voucherCode(data.vouchers || []),
          original_amount: amount,
          balance: amount,
          expires_on: expiryDate(),
          client_id: own.id,
          assigned_client_name: own.name,
          recipient_email: own.email.toLowerCase(),
          revision: 0,
          created_at: new Date().toISOString(),
          demo_purchase: true,
          purchased_by: "local-client",
          treatment_name: option === "treatment" ? selected!.name : null,
        };
        setData((d) => ({
          ...d,
          clients: d.clients.some((c) => c.id === own.id)
            ? d.clients
            : [...d.clients, own],
          vouchers: [...(d.vouchers || []), v],
          voucherTransactions: [
            ...(d.voucherTransactions || []),
            {
              id: crypto.randomUUID(),
              voucher_id: v.id,
              kind: "issued",
              amount: v.original_amount,
              to_client_id: v.client_id,
              actor_name: own.name,
              created_at: v.created_at,
            },
          ],
          activity: [
            ...d.activity,
            {
              id: crypto.randomUUID(),
              client_id: own.id,
              action: "demo_voucher_purchased",
              created_at: v.created_at,
              actor_name: own.name,
              details: {
                voucher_id: v.id,
                amount,
                payment_taken: false,
                card_option: card,
              },
            },
          ],
        }));
      }
      if (alive.current) {
        setVoucher(v);
        setNumber("");
        setCvc("");
        setHolder("");
        setExpiry("");
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!voucher || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const mail = emailTo.trim();
      if (!/^\S+@\S+\.\S+$/.test(mail)) throw Error("Enter a valid email address.");
      if (live) {
        const r = await db!.functions.invoke("send-voucher-email", {body: {
          voucher_id: voucher.id, email: mail, request_id: emailRequest.current, client_purchase: true,
        }});
        if (r.error) {
          let detail = r.error.message;
          try { detail = (await r.error.context.json()).error || detail; } catch {}
          throw Error(detail);
        }
        if (r.data?.error) throw Error(r.data.error);
        if (!r.data?.accepted) throw Error("Email was not accepted. Please retry.");
        if (!alive.current) return;
      } else
        setData((d) => ({
          ...d,
          activity: [
            ...d.activity,
            {
              id: crypto.randomUUID(),
              client_id: own?.id,
              action: "demo_voucher_email_prepared",
              created_at: new Date().toISOString(),
              actor_name: own?.name || "Client",
              details: {
                voucher_id: voucher.id,
                email_to: mail,
                email_sent: false,
              },
            },
          ],
        }));
      if (alive.current) {
        setEmailOpen(false);
        setMessage(live ? `Voucher email accepted for sending to damianjmcgrath@gmail.com (testing). Entered recipient: ${mail}` : `Demo email prepared for ${mail}. No email has been sent.`);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="voucher-purchase">
      <button className="back" disabled={busy} onClick={onHome}>
        ← Booking home
      </button>
      <h1>{voucher ? "Your voucher is confirmed." : "Buy a Voucher"}</h1>
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
      {voucher ? (
        <section className="panel voucher-confirmation">
          <p>This is a demo purchase. No payment was taken.</p>
          <div className="voucher-print-area">
            <div className="voucher-salon-heading">
              <img className="voucher-salon-logo" src={`${(import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL}images/salon-logo.png`} alt="Sculpted by Aoife Clare" />
              <p className="eyebrow voucher-salon-contact">Williams St., Mulladrillen, Ardee, Co. Louth A92 HW30</p>
              <p className="eyebrow voucher-salon-contact">087 1815137</p>
            </div>
            <h2>Gift Voucher</h2>
            <h3>{euro(voucher.original_amount)}</h3>
            {voucher.treatment_name && (
              <p>Value based on: {voucher.treatment_name}</p>
            )}
            <p>Give the voucher code to the person you want to use it. They can add it to their account or present it in the salon.</p>
            <p>Voucher code</p>
            <strong className="voucher-code">{voucher.code}</strong>
            <p>Valid through: {voucherDate(voucher.expires_on)}</p>
            <small>DEMO VOUCHER · No payment taken</small>
          </div>
          <div className="record-actions" style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",marginTop:24}}>
            <button className="primary" style={{height:52,marginTop:0,fontSize:13}} disabled={busy} onClick={() => window.print()}>Print voucher</button>
            <button className="secondary" style={{height:52,marginTop:0,fontSize:13}} disabled={busy} onClick={() => {
              setEmailTo(voucher.recipient_email || own?.email || "");
              emailRequest.current = crypto.randomUUID(); setEmailOpen(true); setMessage(""); setError("");
            }}>Email Voucher</button>
          </div>
          {emailOpen && <form className="voucher-email-form" onSubmit={e => void sendEmail(e)}>
            <label>Recipient email address<input type="email" required maxLength={254} autoFocus value={emailTo} disabled={busy} onChange={e => {setEmailTo(e.target.value); emailRequest.current=crypto.randomUUID();}} /></label>
            <p className="small">{live ? "Testing: emails are sent to damianjmcgrath@gmail.com regardless of the address entered." : "Email delivery is simulated in local demo mode."}</p>
            <div className="record-actions">
              <button className="primary" disabled={busy}>{busy ? "Sending…" : "Send Email"}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => {setEmailOpen(false);setError("");}}>Cancel</button>
            </div>
          </form>}
          <button className="back" onClick={onProfile}>
            View My Profile and vouchers →
          </button>
        </section>
      ) : (
        <form
          className="panel voucher-purchase-form"
          onSubmit={(e) => {
            e.preventDefault();
            void buy();
          }}
        >
          <fieldset disabled={busy}>
            <h2>Choose your voucher</h2>
            <fieldset className="voucher-amount-options">
              <legend>Voucher amount</legend>
              {[
                { value: "custom", label: "Custom amount" },
                { value: "treatment", label: "Full-treatment-price" },
              ].map((o) => (
                <label key={o.value}>
                  <input
                    type="radio"
                    name="voucher-value"
                    checked={option === o.value}
                    onChange={() => setOption(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
            {option === "custom" && (
              <div><label htmlFor="custom-voucher-amount">Voucher amount (€)</label>
                <input id="custom-voucher-amount" type="text" inputMode="decimal" required pattern="[0-9]+([.][0-9]{1,2})?" value={customAmount} aria-describedby="voucher-amount-help" onChange={(e) => { if (/^\d*(\.\d{0,2})?$/.test(e.target.value)) setCustomAmount(e.target.value); }} />
                <span id="voucher-amount-help" className="small">Minimum €5.00 · Maximum €500.00. Use up to two decimal places.</span>
              </div>
            )}
            {option === "treatment" && (
              <label>
                Treatment
                <select
                  required
                  value={treatmentId}
                  onChange={(e) => setTreatmentId(e.target.value)}
                >
                  <option value="">Select a treatment</option>
                  {treatments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {euro(t.price)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="voucher-total">
              Voucher value: <strong>{euro(amount)}</strong>
            </p>
            <label>
              Payment Method
              <select
                required
                value={card}
                onChange={(e) => {
                  setCard(e.target.value);
                  setAck(false);
                }}
              >
                <option value="">Select a card option</option>
                <option value="saved_demo">
                  Saved demo card · Visa •••• 4242
                </option>
                <option value="new_demo">Enter a new demo card</option>
              </select>
            </label>
            {card === "new_demo" && (
              <div className="staff-form-grid">
                <label>
                  Demo cardholder name
                  <input
                    required
                    value={holder}
                    onChange={(e) => setHolder(e.target.value)}
                  />
                </label>
                <label>
                  Example card number
                  <input
                    required
                    inputMode="numeric"
                    maxLength={24}
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                </label>
                <label>
                  Example expiry
                  <input
                    required
                    placeholder="MM/YY"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </label>
                <label>
                  Example security code
                  <input
                    required
                    inputMode="numeric"
                    maxLength={4}
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value)}
                  />
                </label>
              </div>
            )}
            <p className="small">
              Demo only. Use the example card details; no payment will be taken.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={ack}
                required
                onChange={(e) => setAck(e.target.checked)}
              />{" "}
              I understand this is a demo purchase.
            </label>
            <button
              className="primary"
              disabled={busy || !amount || !card || !ack}
            >
              Confirm demo purchase · {euro(amount)}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
