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
    [expiry, setExpiry] = useState(""),
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
  const alive = useRef(true);
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
  async function findVouchers(client?: Client) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let found: Voucher[];
      if (live && db) {
        const r = await db.rpc("search_vouchers", {
          p_code: client ? "" : code.trim(),
          p_client_id: client?.id || null,
        });
        if (r.error) throw r.error;
        found = r.data || [];
      } else {
        if (!client && !code.trim())
          throw Error("Enter a voucher ID or select a client.");
        const normalize = (s: string) =>
          s.toUpperCase().replace(/[^A-Z0-9]/g, "");
        found = (data.vouchers || []).filter((v) =>
          client
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
        const r = await db.rpc("create_voucher", {
          p_amount: value,
          p_expires_on: expiry,
          p_client_id: recipient?.id || null,
        });
        if (r.error) throw r.error;
        if (!alive.current) return;
        v = { ...r.data, balance: Number(r.data.original_amount) };
      } else {
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
          recipient_email: recipient?.email,
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
          <button
            className="panel workspace-card"
            onClick={() => {
              setRecipient(null);
              setAmount("");
              setExpiry("");
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
              setCode("");
              setVouchers([]);
              setScreen("find");
            }}
          >
            <h2>Re-Assign a Voucher</h2>
            <p>Find a voucher by ID or by client details.</p>
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
            <p>
              Assigned to: <strong>{recipient?.name || "Unassigned"}</strong>
            </p>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => clientSearch("create")}
            >
              {recipient
                ? "Choose a different client"
                : "Assign to an existing client"}
            </button>
            {recipient && (
              <button
                type="button"
                className="back"
                onClick={() => setRecipient(null)}
              >
                Leave unassigned
              </button>
            )}
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
              <strong>{voucher.assigned_client_name || "Unassigned"}</strong>
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
          <div className="record-actions">
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
          <p className="small">
            Voucher redemption at checkout will be added in the payment flow.
            This step creates and assigns the voucher; it does not record a sale
            payment.
          </p>
        </section>
      ) : null}
    </section>
  );
}
