import {
  useRef,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalStaffData, Client, Voucher } from "./domain";
import ClientSearch from "./ClientSearch";
import { searchClients } from "./staffModel.js";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const euro = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    n,
  );
const blankQuery = { name: "", email: "", phone: "" };
const defaultExpiry = () => { const d = new Date(today() + "T12:00:00Z"); const month = d.getUTCMonth(); d.setUTCFullYear(d.getUTCFullYear() + 5); if (d.getUTCMonth() !== month) d.setUTCDate(0); return d.toISOString().slice(0, 10); };
export default function VoucherManagement({
  live,
  db,
  data,
  setData,
  actor,
}: {
  live: boolean;
  db: SupabaseClient | null;
  data: LocalStaffData;
  setData: Dispatch<SetStateAction<LocalStaffData>>;
  actor: string;
}) {
  const [screen, setScreen] = useState("home"),
    [amount, setAmount] = useState(""),
    [expiry, setExpiry] = useState(defaultExpiry),
    [recipient, setRecipient] = useState<Client | null>(null),
    [voucher, setVoucher] = useState<Voucher | null>(null),
    [vouchers, setVouchers] = useState<Voucher[]>([]),
    [code, setCode] = useState(""),
    [query, setQuery] = useState(blankQuery),
    [clients, setClients] = useState<Client[]>([]),
    [searchPurpose, setSearchPurpose] = useState("create"),
    [searched, setSearched] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [purchaserName, setPurchaserName] = useState(""),
    [purchaserEmail, setPurchaserEmail] = useState("");
  const [recipientName, setRecipientName] = useState(""), [recipientEmail, setRecipientEmail] = useState("");
  const [emailOpen, setEmailOpen] = useState(false),
    [emailTo, setEmailTo] = useState("");
  const [emailRequest, setEmailRequest] = useState("");
  const alive = useRef(true);
  function openFind() {
    setCode("");
    setVouchers([]);
    setPurchaserName("");
    setPurchaserEmail("");
    setMessage("");
    setError("");
    setEmailOpen(false);
    setScreen("find");
  }
  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!voucher || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!live || !db)
        throw Error("Connect to Supabase to send voucher emails.");
      const r = await db.functions.invoke("send-voucher-email", {
        body: {
          voucher_id: voucher.id,
          email: emailTo.trim(),
          request_id: emailRequest,
        },
      });
      if (r.error) {
        let message = r.error.message;
        try {
          const body = await r.error.context.json();
          message = body.error || message;
        } catch {}
        throw Error(message);
      }
      if (r.data?.error) throw Error(r.data.error);
      if (!r.data?.accepted)
        throw Error("Email was not accepted. Please retry.");
      if (!alive.current) return;
      setMessage(
        "Voucher email accepted for sending to damianjmcgrath@gmail.com (testing). Entered recipient: " +
          emailTo.trim(),
      );
      setEmailOpen(false);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function clientSearch(purpose: string) {
    setSearchPurpose(purpose);
    setQuery(blankQuery);
    setClients([]);
    setSearched(false);
    setScreen("clients");
    setError("");
  }
  async function findClients() {
    setBusy(true);
    setError("");
    try {
      let found: Client[];
      if (live && db) {
        const r = await db.rpc("search_clients", {
          p_name: query.name,
          p_email: query.email,
          p_phone: query.phone,
        });
        if (r.error) throw r.error;
        found = r.data || [];
      } else found = searchClients(data.clients, query);
      if (!alive.current) return;
      setClients(found);
      setSearched(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function findVouchers(client?: Client, purchaser = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let found: Voucher[];
      if (live && db) {
        const r = await db.rpc("search_managed_vouchers", {
          p_code: client || purchaser ? "" : code.trim(),
          p_client_id: client?.id || null,
          p_purchaser_name: purchaser ? purchaserName.trim() : "",
          p_purchaser_email: purchaser ? purchaserEmail.trim() : "",
        });
        if (r.error) throw r.error;
        found = r.data || [];
      } else {
        if (!client && !purchaser && !code.trim())
          throw Error("Enter a voucher ID or select a client.");
        const normalize = (s: string) =>
          s.toUpperCase().replace(/[^A-Z0-9]/g, "");
        found = (data.vouchers || []).filter((v) =>
          purchaser
            ? !!(purchaserName.trim() || purchaserEmail.trim()) &&
              (!purchaserName.trim() ||
                v.purchaser_name
                  ?.toLowerCase()
                  .includes(purchaserName.trim().toLowerCase())) &&
              (!purchaserEmail.trim() ||
                v.purchaser_email
                  ?.toLowerCase()
                  .includes(purchaserEmail.trim().toLowerCase()))
            : client
              ? v.client_id === client.id ||
                v.recipient_email?.toLowerCase() === client.email.toLowerCase()
              : normalize(v.code) === normalize(code),
        );
      }
      if (!alive.current) return;
      setVouchers(found);
      setScreen("results");
      if (!found.length) setMessage("No matching vouchers.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function chooseClient(c: Client) {
    setRecipient(c);
    if (searchPurpose === "find") void findVouchers(c);
    else setScreen(searchPurpose === "create" ? "create" : "transfer");
  }
  const activity = (
    action: string,
    v: Voucher,
    details: Record<string, any>,
  ) => ({
    id: crypto.randomUUID(),
    client_id: v.client_id,
    action,
    details,
    actor_name: actor,
    created_at: new Date().toISOString(),
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const value = Number(amount);
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        value >= 1000000 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 0.00001
      )
        throw Error(
          "Enter a positive euro amount with up to two decimal places.",
        );
      if (!expiry || expiry < today())
        throw Error("Choose an expiry date that is not in the past.");
      let v: Voucher;
      if (live && db) {
        const r = await db.rpc("create_staff_recipient_voucher", {
          p_amount: value,
          p_expires_on: expiry,
          p_recipient_name: recipientName.trim() || null,
          p_recipient_email: recipientEmail.trim() || null,
          p_purchaser_name: purchaserName.trim() || null,
          p_purchaser_email: purchaserEmail.trim() || null,
        });
        if (r.error) throw r.error;
        if (!alive.current) return;
        v = { ...r.data, balance: Number(r.data.original_amount) };
      } else {
        const recipient = data.clients.find(c => recipientEmail.trim() && c.email.trim().toLowerCase() === recipientEmail.trim().toLowerCase()) || null;
        let generated = "";
        do {
          const raw = crypto
            .randomUUID()
            .replaceAll("-", "")
            .slice(0, 12)
            .toUpperCase();
          generated = `SC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
        } while ((data.vouchers || []).some((v) => v.code === generated));
        v = {
          id: crypto.randomUUID(),
          code: generated,
          original_amount: value,
          balance: value,
          expires_on: expiry,
          client_id: recipient?.id || null,
          assigned_client_name: recipient?.name || null,
          recipient_email: recipientEmail.trim().toLowerCase() || undefined,
          purchaser_name: purchaserName.trim() || null,
          purchaser_email: purchaserEmail.trim().toLowerCase() || null,
          revision: 0,
          created_at: new Date().toISOString(),
        };
        setData((d) => ({
          ...d,
          vouchers: [...(d.vouchers || []), v],
          voucherTransactions: [
            ...(d.voucherTransactions || []),
            {
              id: crypto.randomUUID(),
              voucher_id: v.id,
              kind: "issued",
              amount: value,
              to_client_id: v.client_id,
              actor_name: actor,
              created_at: v.created_at,
            },
          ],
          activity: [
            ...d.activity,
            activity("voucher_created", v, { after: v }),
          ],
        }));
      }
      setMessage(v.client_id ? "It looks like the recipient is an existing client, the voucher will be assigned to their profile" : "");
      setVoucher(v);
      setScreen("detail");
      setMessage(
        "Voucher created. Print it or copy the voucher ID onto a physical card.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function transfer() {
    if (!voucher || !recipient) return;
    setBusy(true);
    setError("");
    try {
      let v: Voucher;
      if (live && db) {
        const r = await db.rpc("reassign_voucher", {
          p_id: voucher.id,
          p_client_id: recipient.id,
          p_revision: voucher.revision,
        });
        if (r.error) throw r.error;
        if (!alive.current) return;
        v = {
          ...r.data,
          balance: voucher.balance ?? Number(r.data.original_amount),
        };
      } else {
        const current = (data.vouchers || []).find((v) => v.id === voucher.id);
        if (!current || current.revision !== voucher.revision)
          throw Error("Voucher changed. Search again before transferring.");
        if (current.expires_on < today())
          throw Error("An expired voucher cannot be transferred.");
        if (current.client_id === recipient.id)
          throw Error("Voucher is already assigned to this client.");
        v = {
          ...current,
          client_id: recipient.id,
          assigned_client_name: recipient.name,
          recipient_email: recipient.email,
          revision: current.revision + 1,
        };
        setData((d) => ({
          ...d,
          vouchers: (d.vouchers || []).map((x) => (x.id === v.id ? v : x)),
          voucherTransactions: [
            ...(d.voucherTransactions || []),
            {
              id: crypto.randomUUID(),
              voucher_id: v.id,
              kind: current.client_id ? "reassigned" : "assigned",
              amount: 0,
              from_client_id: current.client_id,
              to_client_id: v.client_id,
              actor_name: actor,
              created_at: new Date().toISOString(),
            },
          ],
          activity: [
            ...d.activity,
            activity("voucher_reassigned", v, {
              before: current,
              after: v,
              previous_client_id: current.client_id,
            }),
          ],
        }));
      }
      setVoucher(v);
      setScreen("detail");
      setMessage(
        "Voucher assignment updated. You can re-print it with the new client name.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="voucher-management">
      <h1>Voucher Management</h1>
      {screen !== "home" && (
        <button
          className="back"
          disabled={busy}
          onClick={() => {
            setScreen("home");
            setError("");
            setMessage("");
          }}
        >
          ← Voucher options
        </button>
      )}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {screen === "home" ? (
        <div className="workspace-grid">
          <button className="panel workspace-card" onClick={openFind}>
            <h2>Find a Voucher</h2>
            <p>Find, email, print or reassign a voucher.</p>
            <span>Open →</span>
          </button>
          <button
            className="panel workspace-card"
            onClick={() => {
              setRecipient(null);
              setAmount("");
              setExpiry(defaultExpiry());
              setRecipientName(""); setRecipientEmail("");
              setPurchaserName("");
              setPurchaserEmail("");
              setEmailOpen(false);
              setScreen("create");
            }}
          >
            <h2>Create a New Voucher</h2>
            <p>Choose an amount, expiry and optional client.</p>
            <span>Open →</span>
          </button>
          <button
            className="panel workspace-card"
            onClick={() => {
              openFind();
            }}
          >
            <h2>Re-Assign a Voucher</h2>
            <p>Find a voucher by ID, client or purchaser details.</p>
            <span>Open →</span>
          </button>
        </div>
      ) : screen === "create" ? (
        <section className="panel">
          <h2>Create a New Voucher</h2>
          <form onSubmit={(e) => void create(e)}>
            <label>
              Voucher amount (€)
              <input
                type="number"
                min="0.01"
                max="999999.99"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Expiry date
              <input
                type="date"
                min={today()}
                required
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </label>
            <label>
              Purchaser name (optional)
              <input
                value={purchaserName}
                maxLength={200}
                onChange={(e) => setPurchaserName(e.target.value)}
              />
            </label>
            <label>
              Purchaser email (optional)
              <input
                type="email"
                value={purchaserEmail}
                maxLength={254}
                onChange={(e) => setPurchaserEmail(e.target.value)}
              />
            </label>
            <label>Recipient Name<input value={recipientName} maxLength={200} onChange={e => setRecipientName(e.target.value)} /></label>
            <label>Recipient Email Address<input type="email" value={recipientEmail} maxLength={254} onChange={e => setRecipientEmail(e.target.value)} /></label>
            <button className="primary" disabled={busy}>
              Create voucher
            </button>
          </form>
        </section>
      ) : screen === "clients" ? (
        <ClientSearch
          query={query}
          onQuery={setQuery}
          results={clients}
          busy={busy}
          searched={searched}
          onSearch={() => void findClients()}
          onSelect={chooseClient}
        />
      ) : screen === "find" ? (
        <section className="panel">
          <h2>Find a voucher</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void findVouchers();
            }}
          >
            <label>
              Voucher ID
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="SC-1234-ABCD-5678"
              />
            </label>
            <button className="primary" disabled={busy}>
              Search voucher ID
            </button>
          </form>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => clientSearch("find")}
          >
            Search by client details
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setPurchaserName("");
              setPurchaserEmail("");
              setScreen("purchaser");
              setError("");
            }}
          >
            Search by Purchaser
          </button>
        </section>
      ) : screen === "purchaser" ? (
        <section className="panel">
          <h2>Search by Purchaser</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void findVouchers(undefined, true);
            }}
          >
            <label>
              Purchaser name
              <input
                value={purchaserName}
                onChange={(e) => setPurchaserName(e.target.value)}
              />
            </label>
            <label>
              Purchaser email
              <input
                value={purchaserEmail}
                onChange={(e) => setPurchaserEmail(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={
                busy || !(purchaserName.trim() || purchaserEmail.trim())
              }
            >
              Search purchaser
            </button>
          </form>
        </section>
      ) : screen === "results" ? (
        <section className="panel">
          <h2>Matching vouchers</h2>
          {vouchers.map((v) => (
            <button
              className="history-card voucher-result"
              key={v.id}
              onClick={() => {
                setVoucher(v);
                setScreen("detail");
                setMessage("");
                setEmailOpen(false);
              }}
            >
              <strong>{v.code}</strong>
              <span>
                {v.assigned_client_name || "Unassigned"} ·{" "}
                {euro(Number(v.balance ?? v.original_amount))} · Expires{" "}
                {v.expires_on}
              </span>
              <span>Select →</span>
            </button>
          ))}
        </section>
      ) : screen === "transfer" && voucher && recipient ? (
        <section className="panel">
          <h2>Confirm voucher transfer</h2>
          <p>
            {voucher.code} ·{" "}
            {euro(Number(voucher.balance ?? voucher.original_amount))}
          </p>
          <p>From: {voucher.assigned_client_name || "Unassigned"}</p>
          <p>
            To: <strong>{recipient.name}</strong>
          </p>
          <p>
            The voucher ID, expiry and value stay the same. The client name
            changes and the transfer is recorded.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void transfer()}
          >
            {voucher.client_id ? "Transfer voucher" : "Assign voucher"}
          </button>
        </section>
      ) : voucher ? (
        <section className="panel">
          <div className="voucher-print-area">
            <p className="eyebrow">SCULPTED BY AOIFE CLAIRE</p>
            <h2>Gift Voucher</h2>
            <h3>{euro(Number(voucher.original_amount))}</h3>
            <p>Voucher ID</p>
            <strong className="voucher-code">{voucher.code}</strong>
            <p>
              Assigned to:{" "}
              <strong>{voucher.assigned_client_name || ""}</strong>
            </p>
            <p>Valid through: {voucher.expires_on}</p>
            <p>
              Remaining value:{" "}
              {euro(Number(voucher.balance ?? voucher.original_amount))}
            </p>
            {voucher.expires_on < today() && (
              <strong className="no-show-label">Expired</strong>
            )}
          </div>
          <div className="record-actions voucher-detail-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setEmailTo(
                  voucher.recipient_email ||
                    data.clients.find((c) => c.id === voucher.client_id)
                      ?.email ||
                    "",
                );
                setEmailRequest(crypto.randomUUID());
                setEmailOpen(true);
                setMessage("");
                setError("");
              }}
            >
              Email voucher
            </button>
            <button className="primary" onClick={() => window.print()}>
              Print voucher
            </button>
            <button
              className="secondary"
              disabled={busy || voucher.expires_on < today()}
              onClick={() => {
                setRecipient(null);
                clientSearch("transfer");
              }}
            >
              {voucher.client_id ? "Reassign" : "Assign to client"}
            </button>
          </div>
          {emailOpen && (
            <form
              className="voucher-email-form"
              onSubmit={(e) => void sendEmail(e)}
            >
              <label>
                Email address
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={emailTo}
                  disabled={busy}
                  onChange={(e) => {
                    setEmailTo(e.target.value);
                    setEmailRequest(crypto.randomUUID());
                  }}
                />
              </label>
              <p className="small">
                Testing: this email will be sent to damianjmcgrath@gmail.com
                regardless of the address entered.
              </p>
              <div className="record-actions">
                <button className="primary" disabled={busy}>
                  {busy ? "Sending…" : "Send"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setEmailOpen(false)}
                >
                  Cancel email
                </button>
              </div>
            </form>
          )}
          <p className="small">
            This screen manages vouchers; it does not record a sale payment.
          </p>
        </section>
      ) : null}
    </section>
  );
}
