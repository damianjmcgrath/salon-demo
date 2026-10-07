import { defaultPermissions, type Permissions } from "./permissions";
import ClientSearch from "./ClientSearch";
import ClientPatchTests from "./ClientPatchTests";
import ClientCommunications from "./ClientCommunications";
import ClientValues from "./ClientValues";
import VoucherManagement from "./VoucherManagement";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Appointment,
  Client,
  LocalStaffData,
  Note,
  Activity,
} from "./domain";
import { searchClients, openAppointments } from "./staffModel.js";
const time = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export default function StaffWorkspace({
  db,
  live,
  data,
  setData,
  appointments,
  actor,
  onDiary,
  onBook,
  onCancel,
  initialAppointment,
  initialPatchRecord = false,
  role,
  initialScreen = "home",
  treatments,
  staff,
  onReporting,
  onStaffAdmin,
  onTreatments,
  onPermissions,
  permissions,
}: {
  role: string;
  permissions?: Permissions;
  onTreatments?: () => void;
  onPermissions?: () => void;
  initialScreen?: string;
  treatments: { id: number; name: string; category: string }[];
  staff: { id: number; name: string; active?: boolean }[];
  onReporting: () => void;
  onStaffAdmin: () => void;
  db: SupabaseClient | null;
  live: boolean;
  data: LocalStaffData;
  setData: Dispatch<SetStateAction<LocalStaffData>>;
  appointments: Appointment[];
  actor: string;
  onDiary: () => void;
  onBook: (client: Client, appointment?: Appointment) => void;
  onCancel: (appointment: Appointment, reason: string) => Promise<void>;
  initialAppointment?: Appointment | null;
  initialPatchRecord?: boolean;
}) {
  const grants = permissions ?? defaultPermissions(role);
  const [requiresDeposit, setRequiresDeposit] = useState(true);
  const [screen, setScreen] = useState(initialScreen),
    [intent, setIntent] = useState("profile"),
    [query, setQuery] = useState({ name: "", email: "", phone: "" }),
    [results, setResults] = useState<Client[]>([]),
    [client, setClient] = useState<Client | null>(null),
    [draft, setDraft] = useState({ name: "", email: "", phone: "" }),
    [password, setPassword] = useState(""),
    [notes, setNotes] = useState<Note[]>([]),
    [note, setNote] = useState(""),
    [history, setHistory] = useState<Appointment[]>([]),
    [activity, setActivity] = useState<Activity[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [cancel, setCancel] = useState<Appointment | null>(null),
    [reason, setReason] = useState("");
  const [clientTab, setClientTab] = useState("Personal Details");
  const [patchPrompt, setPatchPrompt] = useState(initialPatchRecord);
  const generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  const addActivity = (
    action: string,
    c: Client,
    details: Record<string, any> = {},
    appointment_id?: string,
  ) => ({
    id: crypto.randomUUID(),
    client_id: c.id,
    appointment_id,
    action,
    created_at: new Date().toISOString(),
    actor_name: actor,
    details,
  });
  async function loadClient(c: Client, nextIntent = intent) {
    const version = ++generation.current;
    setClient(c);
    setRequiresDeposit(c.requires_deposit !== false);
    setClientTab("Personal Details");
    setDraft({ name: c.name, email: c.email, phone: c.phone });
    setScreen("record");
    setError("");
    setMessage("");
    setCancel(null);
    setIntent(nextIntent);
    setHistory([]);
    setNotes([]);
    setActivity([]);
    if (live && db) {
      setBusy(true);
      const [a, n, e] = await Promise.all([
        db
          .from("appointments")
          .select("*")
          .eq("client_id", c.id)
          .order("appointment_date", { ascending: false })
          .order("start_minute"),
        db
          .from("client_notes")
          .select("*")
          .eq("client_id", c.id)
          .order("created_at", { ascending: false }),
        db.rpc("get_client_activity", { p_client_id: c.id }),
      ]);
      if (!mounted.current || version !== generation.current) return;
      setBusy(false);
      if (a.error || n.error || e.error) {
        setError((a.error || n.error || e.error)!.message);
        return;
      }
      setHistory(a.data || []);
      setNotes(n.data || []);
      setActivity(e.data || []);
    } else {
      setHistory(
        appointments
          .filter((a) => a.client_id === c.id)
          .sort((a, b) => b.appointment_date.localeCompare(a.appointment_date)),
      );
      setNotes(data.notes.filter((n) => n.client_id === c.id));
      setActivity(
        data.activity
          .filter((a) => a.client_id === c.id)
          .slice()
          .reverse(),
      );
    }
  }
  useEffect(() => {
    if (!initialAppointment) return;
    let stopped = false;
    (async () => {
      const c =
        live && db
          ? (
              await db
                .from("clients")
                .select("*")
                .eq("id", initialAppointment.client_id)
                .maybeSingle()
            ).data
          : data.clients.find((c) => c.id === initialAppointment.client_id);
      if (stopped) return;
      if (c) {
        await loadClient(c, "profile");
        if (!stopped && initialPatchRecord) setClientTab("Patch Tests");
      } else
        setError(
          "This appointment has no linked client record. Apply migration 005 first.",
        );
    })();
    return () => {
      stopped = true;
    };
  }, [initialAppointment?.id]);
  function beginSearch(nextIntent: string) {
    generation.current++;
    setIntent(nextIntent);
    setQuery({ name: "", email: "", phone: "" });
    setResults([]);
    setClient(null);
    setScreen("search");
    setError("");
    setMessage("");
  }
  function beginCreate(nextIntent: string) {
    setIntent(nextIntent);
    setDraft({ name: "", email: "", phone: "" });
    setPassword("");
    setScreen("create");
    setError("");
    setMessage("");
  }
  async function search() {
    setBusy(true);
    setError("");
    try {
      if (live && db) {
        const r = await db.rpc("search_clients", {
          p_name: query.name,
          p_email: query.email,
          p_phone: query.phone,
        });
        if (r.error) throw r.error;
        if (!mounted.current) return;
        setResults(r.data || []);
      } else setResults(searchClients(data.clients, query));
      setMessage("Search completed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let c: Client;
      if (live && db) {
        const r = await db.rpc("create_client", {
          p_name: draft.name,
          p_email: draft.email,
          p_phone: draft.phone,
        });
        if (r.error) throw r.error;
        if (!mounted.current) return;
        c = r.data;
      } else {
        c = {
          id: crypto.randomUUID(),
          ...draft,
          name: draft.name.trim(),
          email: draft.email.trim().toLowerCase(),
          phone: draft.phone.trim(),
          revision: 0,
        };
        setData((d) => ({
          ...d,
          clients: [...d.clients, c],
          activity: [
            ...d.activity,
            addActivity("client_created", c, { after: c }),
          ],
        }));
      }
      // Persist the client record before provisioning. A failed provisioning never creates a duplicate client.
      setClient(c);
      setDraft({ name: c.name, email: c.email, phone: c.phone });
      setScreen("record");
      setIntent("profile");
      setHistory([]);
      setNotes([]);
      setActivity([]);
      if (password && live && db) {
        const { data: r, error } = await db.functions.invoke(
          "create-client-account",
          { body: { client_id: c.id, temporary_password: password } },
        );
        setPassword("");
        if (error || r?.error) {
          setMessage(
            "Client record saved. Login account was not created; use Create login account below to retry.",
          );
          throw Error(
            r?.error ||
              "Account function unavailable. Deploy create-client-account before provisioning logins.",
          );
        }
        c = r.client;
        setClient(c);
      } else if (password) {
        setPassword("");
        setMessage(
          "Client saved locally. Temporary passwords do not create real accounts in local preview.",
        );
      }
      if (!mounted.current) return;
      if (intent === "book") onBook(c);
      else await loadClient(c, "profile");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  async function saveClient(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      let c: Client;
      if (live && db) {
        const r = await db.rpc("update_client_details", {
          p_id: client.id,
          p_name: draft.name,
          p_email: draft.email,
          p_phone: draft.phone,
          p_revision: client.revision,
          p_requires_deposit: requiresDeposit,
        });
        if (r.error) throw r.error;
        if (!mounted.current) return;
        c = r.data;
      } else {
        c = {
          ...client,
          ...draft,
          requires_deposit: requiresDeposit,
          revision: client.revision + 1,
        };
        setData((d) => ({
          ...d,
          clients: d.clients.map((x) => (x.id === c.id ? c : x)),
          activity: [
            ...d.activity,
            addActivity("client_updated", c, { before: client, after: c }),
          ],
        }));
      }
      setClient(c);
      setMessage(
        "Client details saved. Sign-in email is managed separately through account verification.",
      );
      if (live) await loadClient(c, "profile");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveNote() {
    if (!client || !note.trim()) return;
    setBusy(true);
    setError("");
    try {
      let n: Note;
      if (live && db) {
        const r = await db.rpc("add_client_note", {
          p_client_id: client.id,
          p_body: note.trim(),
        });
        if (r.error) throw r.error;
        n = r.data;
      } else {
        n = {
          id: crypto.randomUUID(),
          client_id: client.id,
          body: note.trim(),
          author_name: actor,
          created_at: new Date().toISOString(),
        };
        setData((d) => ({
          ...d,
          notes: [n, ...d.notes],
          activity: [
            ...d.activity,
            addActivity("client_note_added", client, { note_id: n.id }),
          ],
        }));
      }
      setNotes((ns) => [n, ...ns]);
      setNote("");
      if (live) await loadClient(client, "profile");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancelBooking() {
    if (!cancel || !client || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onCancel(cancel, reason.trim());
      setHistory((as) =>
        as.map((a) => (a.id === cancel.id ? { ...a, status: "cancelled" } : a)),
      );
      setCancel(null);
      setReason("");
      setMessage(
        "Appointment cancelled. Its time is available for future bookings.",
      );
      if (live) await loadClient(client, intent);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function provision() {
    if (!client || !password || !db || !live) return;
    setBusy(true);
    setError("");
    try {
      const r = await db.functions.invoke("create-client-account", {
        body: { client_id: client.id, temporary_password: password },
      });
      if (r.error || r.data?.error)
        throw Error(r.data?.error || r.error?.message);
      if (!mounted.current) return;
      setClient(r.data.client);
      setMessage(
        "Login created. Client must change the temporary password at first sign-in. No email was sent.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!client || live) return;
    setHistory(appointments.filter((a) => a.client_id === client.id));
    setNotes(data.notes.filter((n) => n.client_id === client.id));
    setActivity(
      data.activity
        .filter((a) => a.client_id === client.id)
        .slice()
        .reverse(),
    );
  }, [data, appointments, client?.id, live]);
  const visibleHistory: Appointment[] =
    intent === "amend" || intent === "cancel"
      ? openAppointments(history, client?.id)
      : history;
  const appointmentSelection = intent === "amend" || intent === "cancel";
  const clockParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const clockPart = (key: string) =>
    clockParts.find((p) => p.type === key)?.value || "";
  const currentDay = `${clockPart("year")}-${clockPart("month")}-${clockPart("day")}`;
  const currentMinute =
    Number(clockPart("hour")) * 60 + Number(clockPart("minute"));
  const isUpcoming = (a: Appointment) =>
    ["booked", "checked_in"].includes(a.status) &&
    (a.appointment_date > currentDay ||
      (a.appointment_date === currentDay &&
        a.start_minute + a.duration > currentMinute));
  const appointmentGroups = appointmentSelection
    ? [
        {
          heading:
            intent === "amend"
              ? "Select an appointment to amend"
              : "Select an appointment to cancel",
          bookings: visibleHistory,
          empty: "No open appointments for this client.",
        },
      ]
    : [true, false].map((upcoming) => ({
        heading: upcoming ? "Upcoming Appointments" : "Previous Appointments",
        bookings: visibleHistory
          .filter((a) => isUpcoming(a) === upcoming)
          .sort(
            (a, b) =>
              (a.appointment_date.localeCompare(b.appointment_date) ||
                a.start_minute - b.start_minute) * (upcoming ? 1 : -1),
          ),
        empty: upcoming
          ? "No upcoming appointments for this client."
          : "No previous appointments for this client.",
      }));
  function select(c: Client) {
    if (intent === "book") onBook(c);
    else void loadClient(c);
  }
  const tile = (title: string, description: string, action: () => void) => {
    const key: Record<string, string> = {
      "Appointment Management": "view.appointments",
      "Client Management": "view.clients",
      "Staff Diary": "view.diary",
      "Voucher Management": "view.vouchers",
      "Staff Management": "view.staff",
      Reporting: "view.reporting",
      "Treatment Management": "view.treatments",
      "Permission Management": "view.permissions",
    };
    if (key[title] && !grants[key[title]]) return null;
    return (
      <button className="panel workspace-card" onClick={action}>
        <h2>{title}</h2>
        <p>{description}</p>
        <span>Open →</span>
      </button>
    );
  };
  const screenKey: Record<string, string> = {
    appointments: "view.appointments",
    clients: "view.clients",
    vouchers: "view.vouchers",
  };
  if (
    (screenKey[screen] && !grants[screenKey[screen]]) ||
    (screen === "record" && intent === "profile" && !grants["view.clients"])
  )
    return (
      <section className="panel">
        <h2>Permission required</h2>
        <button className="back" onClick={() => setScreen("home")}>
          ← Staff Home
        </button>
      </section>
    );
  return (
    <section className="staff-workspace">
      <p className="eyebrow">STAFF PORTAL · {actor}</p>
      {screen !== "home" && (
        <button
          className="back"
          onClick={() => {
            generation.current++;
            setScreen("home");
            setError("");
            setMessage("");
          }}
        >
          ← Staff home
        </button>
      )}
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
      {screen === "home" ? (
        <>
          <h1>Your salon workspace.</h1>
          <div className="workspace-grid">
            {tile(
              "Appointment Management",
              "Book, amend and cancel appointments.",
              () => setScreen("appointments"),
            )}
            {tile(
              "Client Management",
              "Client details, notes and booking history.",
              () => setScreen("clients"),
            )}
            {tile(
              "Staff Diary",
              "Today’s schedule, check-in and personal breaks.",
              onDiary,
            )}
            {tile(
              "Voucher Management",
              "Create, assign, transfer and print vouchers.",
              () => setScreen("vouchers"),
            )}
            {tile(
              "Staff Management",
              "Staff profiles, shifts, clock history and qualifications.",
              onStaffAdmin,
            )}
            {tile(
              "Reporting",
              "View activity reports and export to CSV.",
              onReporting,
            )}
            {tile(
              "Treatment Management",
              "Edit treatment details, prices and patch test requirements.",
              onTreatments ?? (() => {}),
            )}
            {tile(
              "Permission Management",
              "Choose which pages and actions staff can access.",
              onPermissions ?? (() => {}),
            )}
          </div>
        </>
      ) : screen === "vouchers" ? (
        <VoucherManagement
          db={db}
          live={live}
          data={data}
          setData={setData}
          actor={actor}
        />
      ) : screen === "appointments" ? (
        <>
          <h1>Appointment Management</h1>
          <div className="workspace-grid">
            {tile(
              "Book a New Appointment for an Existing Client",
              "Search and select the client.",
              () => beginSearch("book"),
            )}
            {tile(
              "Book a New Appointment for a New Client",
              "Create a client, then make their booking.",
              () => beginCreate("book"),
            )}
            {tile(
              "Amend an Appointment",
              "Find a client and choose an open booking.",
              () => beginSearch("amend"),
            )}
            {tile(
              "Cancel an Appointment",
              "Find a client and choose an open booking.",
              () => beginSearch("cancel"),
            )}
          </div>
        </>
      ) : screen === "clients" ? (
        <>
          <h1>Client Management</h1>
          <div className="workspace-grid">
            {tile(
              "Search for a Client",
              "Details, notes, booking history and future appointments.",
              () => beginSearch("profile"),
            )}
            {tile(
              "Create a New Client",
              "Create a client record and optionally a login.",
              () => beginCreate("profile"),
            )}
          </div>
        </>
      ) : screen === "search" ? (
        <ClientSearch
          query={query}
          onQuery={setQuery}
          results={results}
          busy={busy}
          searched={!!message}
          onSearch={() => void search()}
          onSelect={select}
        />
      ) : screen === "create" ? (
        <section className="panel">
          <h1>Create a New Client</h1>
          <form onSubmit={(e) => void create(e)}>
            {(["name", "email", "phone"] as const).map((k) => (
              <label key={k}>
                {k === "name"
                  ? "Full name"
                  : k === "email"
                    ? "Email address"
                    : "Phone number"}
                <input
                  type={
                    k === "email" ? "email" : k === "phone" ? "tel" : "text"
                  }
                  required
                  value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                />
              </label>
            ))}
            <label>
              Temporary password (optional)
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p className="small">
              Leave blank to create a client record without a login. For
              fictional demo accounts only: optional passwords are passed to a
              secure server function, never saved with client details. The
              client must change the password at first sign-in. No account email
              is sent.
            </p>
            <button className="primary" disabled={busy}>
              {busy
                ? "Saving…"
                : intent === "book"
                  ? "Create client & choose treatment"
                  : "Create client"}
            </button>
          </form>
        </section>
      ) : client ? (
        <>
          <div className="section-top">
            <h1>{client.name}</h1>
            <button
              className="primary"
              disabled={busy}
              onClick={() => onBook(client)}
            >
              Book an appointment →
            </button>
          </div>
          {busy && <p role="status">Loading / saving…</p>}
          {intent === "profile" && (
            <nav className="admin-tabs" aria-label="Client record sections">
              {[
                "Personal Details",
                "Notes",
                "Communications",
                "Patch Tests",
                "Vouchers",
                "Credit Notes",
                "Appointments",
                "Change History",
              ].map((tab) => (
                <button
                  key={tab}
                  className={clientTab === tab ? "active" : ""}
                  aria-current={clientTab === tab ? "page" : undefined}
                  onClick={() => setClientTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </nav>
          )}
          {intent === "profile" && (
            <>
              {clientTab === "Personal Details" && (
                <section className="panel">
                  <h2>Personal details</h2>
                  <form onSubmit={(e) => void saveClient(e)}>
                    {(["name", "email", "phone"] as const).map((k) => (
                      <label key={k}>
                        {k === "name"
                          ? "Name"
                          : k === "email"
                            ? "Contact email"
                            : "Phone"}
                        <input
                          type={
                            k === "email"
                              ? "email"
                              : k === "phone"
                                ? "tel"
                                : "text"
                          }
                          required
                          value={draft[k]}
                          onChange={(e) =>
                            setDraft({ ...draft, [k]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Requires Deposit
                      <select
                        value={requiresDeposit ? "yes" : "no"}
                        disabled={busy}
                        onChange={(e) =>
                          setRequiresDeposit(e.target.value === "yes")
                        }
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </label>
                    <p className="small">
                      Yes requires a saved card for the €10 booking guarantee.
                      No allows future bookings without card details; no payment
                      is taken at booking.
                    </p>
                    <button className="primary" disabled={busy}>
                      Save details
                    </button>
                  </form>
                  <p className="small">
                    Contact changes are audited. Existing appointments keep
                    their original booking details. Changing contact email does
                    not change the verified sign-in email.
                  </p>
                  {!client.auth_user_id && live && (
                    <>
                      <h3>Create login account</h3>
                      <label>
                        Temporary password
                        <input
                          type="password"
                          minLength={12}
                          autoComplete="new-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </label>
                      <button
                        className="secondary"
                        disabled={busy || password.length < 12}
                        onClick={() => void provision()}
                      >
                        Create login account
                      </button>
                    </>
                  )}
                </section>
              )}
              {clientTab === "Notes" && (
                <section className="panel">
                  <h2>Client notes</h2>
                  <label>
                    Add a note
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={busy || !note.trim()}
                    onClick={() => void saveNote()}
                  >
                    Save note
                  </button>
                  {notes.map((n) => (
                    <article className="client-note" key={n.id}>
                      <p>{n.body}</p>
                      <small>
                        {n.author_name} ·{" "}
                        {new Date(n.created_at).toLocaleString("en-IE")}
                      </small>
                    </article>
                  ))}
                </section>
              )}
              {(clientTab === "Vouchers" || clientTab === "Credit Notes") && (
                <ClientValues
                  key={`${client.id}-${clientTab}`}
                  db={db}
                  clientId={client.id}
                  kind={clientTab === "Vouchers" ? "vouchers" : "credit"}
                  canCreate={!!grants["perform.credit_notes"]}
                  onSaved={() => {
                    if (db)
                      void db
                        .rpc("get_client_activity", { p_client_id: client.id })
                        .then(({ data }) => {
                          if (data) setActivity(data);
                        });
                  }}
                />
              )}
              {clientTab === "Communications" && (
                <ClientCommunications key={client.id} db={db} clientId={client.id} onSaved={() => {
                  if (db) void db.rpc("get_client_activity", { p_client_id: client.id }).then(({ data }) => { if (data) setActivity(data); });
                }} />
              )}
              {clientTab === "Patch Tests" && (
                <ClientPatchTests
                  key={client.id}
                  db={db}
                  clientId={client.id}
                  initiallyRecord={
                    patchPrompt && client.id === initialAppointment?.client_id
                  }
                  initialTreatmentId={
                    patchPrompt && client.id === initialAppointment?.client_id
                      ? (initialAppointment?.patch_for_treatment_id ??
                        undefined)
                      : undefined
                  }
                  initialStaffId={
                    patchPrompt && client.id === initialAppointment?.client_id
                      ? initialAppointment?.staff_id
                      : undefined
                  }
                  treatments={treatments}
                  staff={staff}
                  onSaved={() => {
                    setPatchPrompt(false);
                    if (db)
                      void db
                        .rpc("get_client_activity", { p_client_id: client.id })
                        .then(({ data }) => {
                          if (data) setActivity(data);
                        });
                  }}
                />
              )}
            </>
          )}
          {(intent !== "profile" || clientTab === "Appointments") && (
            <section className="panel">
              {appointmentGroups.map((group) => (
                <section
                  className={
                    appointmentSelection ? undefined : "appointment-section"
                  }
                  key={group.heading}
                >
                  <h2>
                    {group.heading}
                    {!appointmentSelection && (
                      <span>{group.bookings.length}</span>
                    )}
                  </h2>
                  {group.bookings.map((a) => (
                    <article className="history-card" key={a.id}>
                      <div>
                        <h3>{a.treatment_name}</h3>
                        <p>
                          {a.appointment_date} · {time(a.start_minute)} ·{" "}
                          {a.client_name}
                        </p>
                        <span className={`status ${a.status}`}>
                          {a.status.replace("_", " ")}
                        </span>
                      </div>
                      {["booked", "checked_in"].includes(a.status) && (
                        <div className="record-actions">
                          {intent !== "cancel" && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() => onBook(client, a)}
                            >
                              Amend
                            </button>
                          )}
                          {intent !== "amend" && (
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() => {
                                setCancel(a);
                                setReason("");
                              }}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                  {!group.bookings.length && <p>{group.empty}</p>}
                </section>
              ))}
            </section>
          )}
          {(intent !== "profile" || clientTab === "Change History") && (
            <section className="panel">
              <h2>Change history</h2>
              {activity.map((a) => (
                <article className="activity-entry" key={a.id}>
                  <strong>{a.action.replaceAll("_", " ")}</strong>
                  <p>
                    {a.actor_name} ·{" "}
                    {new Date(a.created_at).toLocaleString("en-IE")}
                  </p>
                  {a.details?.reason && <p>Reason: {a.details.reason}</p>}
                  {a.details?.before && a.details?.after && (
                    <details>
                      <summary>Before / after details</summary>
                      <pre>
                        {JSON.stringify(
                          { before: a.details.before, after: a.details.after },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  )}
                </article>
              ))}
              {!activity.length && <p>No recorded changes yet.</p>}
            </section>
          )}
        </>
      ) : null}
      {cancel && (
        <div className="modal-backdrop">
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Cancel appointment"
          >
            <h2>Cancel this appointment?</h2>
            <p>
              {cancel.treatment_name} · {cancel.appointment_date} ·{" "}
              {time(cancel.start_minute)}
            </p>
            <label>
              Reason
              <textarea
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="small">
              The record is retained, its slot is released and the cancellation
              is audited. No guarantee charge is made in this iteration.
            </p>
            <button
              className="danger"
              disabled={busy || !reason.trim()}
              onClick={() => void cancelBooking()}
            >
              Cancel appointment
            </button>
            <button
              className="back"
              disabled={busy}
              onClick={() => setCancel(null)}
            >
              Keep appointment
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
