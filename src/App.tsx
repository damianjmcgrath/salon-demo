import { useEffect, useState, useRef } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import catalog from "./catalog.json";
import AuthPanel from "./AuthPanel";
import {
  roles,
  normalizeRole,
  roleHome,
  canAccess,
  roleLabels,
} from "./roles.js";
type Role = "client" | "staff" | "admin" | "accountant" | "it_support";
import { availableSlots } from "./availability.js";
type Treatment = (typeof catalog)[number];
type Staff = { id: number; name: string };
type Appointment = {
  user_id?: string;
  id: string;
  staff_id: number;
  start_minute: number;
  duration: number;
  client_name: string;
  treatment_name: string;
  price: number;
  status: string;
  payment_method?: string;
  appointment_date: string;
};
type Slot = { staff_id: number; start_minute: number };
const env = (import.meta as unknown as { env: Record<string, string> }).env;
const db =
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY
    ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
    : null;
const initialStaff: Staff[] = [
  { id: 1, name: "Aoife" },
  { id: 2, name: "Demo Therapist A" },
  { id: 3, name: "Demo Therapist B" },
];
const money = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    n,
  );
const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const demoDate = () => {
  let d = new Date();
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const sample: Appointment[] = [
  {
    id: "sample-1",
    staff_id: 1,
    start_minute: 570,
    duration: 60,
    client_name: "Emma Demo",
    treatment_name: "BIAB / BIAB Refill",
    price: 45,
    status: "booked",
    appointment_date: demoDate(),
  },
  {
    id: "sample-2",
    staff_id: 2,
    start_minute: 630,
    duration: 45,
    client_name: "Grace Demo",
    treatment_name: "Lash Lift",
    price: 48,
    status: "checked_in",
    appointment_date: demoDate(),
  },
  {
    id: "sample-3",
    staff_id: 3,
    start_minute: 600,
    duration: 15,
    client_name: "Sophie Demo",
    treatment_name: "Brow Wax & Tint",
    price: 20,
    status: "completed",
    payment_method: "cash",
    appointment_date: demoDate(),
  },
];
export default function App() {
  const [live, setLive] = useState(!!db),
    [view, setView] = useState("login"),
    [treatments, setTreatments] = useState<Treatment[]>(catalog),
    [staff, setStaff] = useState<Staff[]>(initialStaff),
    [session, setSession] = useState<Session | null>(null),
    [role, setRole] = useState<Role | null>(null);
  const [localRole, setLocalRole] = useState<Role | null>(null),
    [roleLoading, setRoleLoading] = useState(!!db),
    [myBookings, setMyBookings] = useState<Appointment[]>([]);
  const requestVersion = useRef(0);
  const authUser = useRef<string | null>(null);
  const activeRole = live ? role : localRole;
  const staffAccess = ["staff", "admin", "it_support"].includes(
    activeRole || "",
  );
  const reportAccess = ["admin", "accountant", "it_support"].includes(
    activeRole || "",
  );
  const [local, setLocal] = useState<Appointment[]>(() => {
      try {
        return (
          JSON.parse(localStorage.getItem("sculpted-demo-v1") || "null") ||
          sample
        );
      } catch {
        return sample;
      }
    }),
    [remote, setRemote] = useState<Appointment[]>([]);
  const [category, setCategory] = useState("All treatments"),
    [search, setSearch] = useState(""),
    [treatment, setTreatment] = useState<Treatment | null>(null),
    [staffChoice, setStaffChoice] = useState(0),
    [date, setDate] = useState(demoDate()),
    [slots, setSlots] = useState<Slot[]>([]),
    [slot, setSlot] = useState<Slot | null>(null),
    [step, setStep] = useState(1),
    [confirmation, setConfirmation] = useState<Appointment | null>(null);
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Appointment | null>(null);
  const appointments = live
    ? remote
    : activeRole === "accountant"
      ? local.filter((a) => a.status === "completed")
      : local;
  const breaks = staff.map((s) => ({
    staff_id: s.id,
    start_minute: 780,
    duration: 30,
  }));
  useEffect(() => {
    localStorage.setItem("sculpted-demo-v1", JSON.stringify(local));
  }, [local]);
  useEffect(() => {
    if (!db) return;
    db.auth.getSession().then(({ data, error }) => {
      authUser.current = data.session?.user.id || null;
      setSession(data.session);
      if (error) {
        setError(error.message);
        setRoleLoading(false);
      } else if (!data.session) setRoleLoading(false);
    });
    const { data } = db.auth.onAuthStateChange((event, nextSession) => {
      requestVersion.current++;
      if (authUser.current !== (nextSession?.user.id || null)) {
        setRole(null);
        setRemote([]);
        setMyBookings([]);
        setSelected(null);
        setConfirmation(null);
        setRoleLoading(!!nextSession);
        authUser.current = nextSession?.user.id || null;
      }
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setView("recovery");
      if (event === "SIGNED_OUT") {
        setRole(null);
        setRemote([]);
        setMyBookings([]);
        setSelected(null);
        setConfirmation(null);
        setName("");
        setPhone("");
        setStep(1);
        setView("login");
        setRoleLoading(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!live || !db) return;
    let cancelled = false;
    (async () => {
      setError("");
      const [ts, ss] = await Promise.all([
        db.from("treatments").select("*").order("id"),
        db.from("staff").select("id,name").order("id"),
      ]);
      if (cancelled) return;
      if (ts.error || ss.error) {
        setError(
          "Database setup is needed. Run the two SQL files in the README first.",
        );
        return;
      }
      setTreatments(ts.data);
      setStaff(ss.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [live]);
  async function refresh() {
    if (!live || !db || !session || roleLoading) return;
    const version = ++requestVersion.current;
    const result =
      activeRole === "accountant"
        ? await db.rpc("get_daily_report", { p_date: date })
        : staffAccess
          ? await db
              .from("appointments")
              .select("*")
              .eq("appointment_date", date)
              .order("start_minute")
          : null;
    if (result && version === requestVersion.current) {
      if (result.error) setError(result.error.message);
      else setRemote(result.data as Appointment[]);
    }
  }
  useEffect(() => {
    let cancelled = false;
    requestVersion.current++;
    setRole(null);
    setRemote([]);
    setMyBookings([]);
    setSelected(null);
    if (!live || !db || !session) {
      setRoleLoading(false);
      return;
    }
    setRoleLoading(true);
    db.from("staff_users")
      .select("role")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(
            "Unable to load your access permissions. Please retry signing in.",
          );
          setRoleLoading(false);
          return;
        }
        const next = data ? normalizeRole(data.role) : "client";
        if (!next) {
          setError(
            "This account has an unrecognised role. Contact the salon owner.",
          );
          setRoleLoading(false);
          return;
        }
        setRole(next as Role);
        setRoleLoading(false);
        setName(session.user.user_metadata.full_name || "");
        setPhone(session.user.user_metadata.mobile || "");
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, live]);
  useEffect(() => {
    if (roleLoading || !activeRole || view === "recovery") return;
    if (view === "login" || !canAccess(activeRole, view))
      setView(roleHome(activeRole));
  }, [activeRole, roleLoading, view]);
  useEffect(() => {
    void refresh();
  }, [live, session?.user.id, date, activeRole, roleLoading]);
  useEffect(() => {
    if (!live || !db || !session || activeRole !== "client") {
      setMyBookings([]);
      return;
    }
    let cancelled = false;
    db.from("appointments")
      .select("*")
      .eq("user_id", session.user.id)
      .order("appointment_date", { ascending: false })
      .order("start_minute")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setMyBookings(data || []);
      });
    return () => {
      cancelled = true;
    };
  }, [live, session?.user.id, activeRole, view, confirmation]);
  async function signOut() {
    setBusy(true);
    setError("");
    if (db && session) {
      const { error } = await db.auth.signOut({ scope: "local" });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    }
    requestVersion.current++;
    setSession(null);
    setRole(null);
    setLocalRole(null);
    setRemote([]);
    setMyBookings([]);
    setSelected(null);
    setConfirmation(null);
    setTreatment(null);
    setSlot(null);
    setName("");
    setPhone("");
    setStep(1);
    setRoleLoading(false);
    setView("login");
    setBusy(false);
  }
  useEffect(() => {
    let cancelled = false;
    setSlot(null);
    setSlots([]);
    if (!treatment) return;
    if (db && session) {
      db.rpc("get_available_slots", {
        p_treatment_id: treatment.id,
        p_date: date,
        p_staff_id: staffChoice || null,
      }).then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setSlots(data || []);
      });
    } else {
      const sunday = new Date(date + "T12:00:00").getDay() === 0;
      setSlots(
        sunday
          ? []
          : availableSlots(
              treatment.duration,
              staffChoice ? [staffChoice] : staff.map((s) => s.id),
              local.filter((a) => a.appointment_date === date),
              breaks,
            ),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [treatment, date, staffChoice, live, local, staff]);
  async function book() {
    if (!treatment || !slot) return;
    setBusy(true);
    setError("");
    try {
      let a: Appointment;
      if (live) {
        if (!session || !db) throw Error("Please sign in first.");
        const r = await db.rpc("book_appointment", {
          p_treatment_id: treatment.id,
          p_staff_id: slot.staff_id,
          p_date: date,
          p_start: slot.start_minute,
          p_client_name: name.trim(),
          p_phone: phone.trim(),
          p_demo_consent: consent,
        });
        if (r.error) throw r.error;
        a = r.data;
        await refresh();
      } else {
        if (!name.trim()) throw Error("Please enter a name.");
        const valid = availableSlots(
          treatment.duration,
          [slot.staff_id],
          local.filter((a) => a.appointment_date === date),
          breaks,
        ).some((s) => s.start_minute === slot.start_minute);
        if (!valid)
          throw Error("That time is no longer available. Choose another.");
        a = {
          id: crypto.randomUUID(),
          user_id: "local-client",
          staff_id: slot.staff_id,
          start_minute: slot.start_minute,
          duration: treatment.duration,
          client_name: name.trim(),
          treatment_name: treatment.name,
          price: treatment.price,
          status: "booked",
          appointment_date: date,
        };
        setLocal((prev) => [...prev, a]);
        if (!localRole) setLocalRole("client");
      }
      setConfirmation(a);
      setStep(4);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeStatus(status: string, payment = "") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      if (live && db) {
        const r = await db.rpc("update_appointment_status", {
          p_id: selected.id,
          p_status: status,
          p_payment: payment || null,
        });
        if (r.error) throw r.error;
        await refresh();
      } else
        setLocal((prev) =>
          prev.map((a) =>
            a.id === selected.id
              ? { ...a, status, payment_method: payment }
              : a,
          ),
        );
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const categories = [
    "All treatments",
    ...new Set(treatments.map((t) => t.category)),
  ];
  const filtered = treatments.filter(
    (t) =>
      (category === "All treatments" || t.category === category) &&
      t.name.toLowerCase().includes(search.toLowerCase()),
  );
  const dayAppointments = appointments.filter(
      (a) => a.appointment_date === date,
    ),
    completed = dayAppointments.filter((a) => a.status === "completed");
  return (
    <>
      <div className="demo-banner">
        PROOF OF CONCEPT · Fictional clients · No real payments{" "}
        <button
          onClick={() => {
            requestVersion.current++;
            setLive(!live);
            setRole(null);
            setLocalRole(null);
            setRemote([]);
            setMyBookings([]);
            setName("");
            setPhone("");
            setTreatment(null);
            setConfirmation(null);
            setStep(1);
            setSelected(null);
            setView("login");
            setError("");
            setTreatments(catalog);
            setStaff(initialStaff);
          }}
          disabled={!db}
        >
          {live ? "Supabase connected mode" : "Local demo mode"} ↗
        </button>
      </div>
      <header>
        <a className="brand" href="#" onClick={() => setView("book")}>
          SCULPTED<span>BY AOIFE CLAIRE</span>
        </a>
        <nav>
          {canAccess(activeRole, "book") && (
            <button
              className={view === "book" ? "active" : ""}
              onClick={() => setView("book")}
            >
              Book a treatment
            </button>
          )}
          {activeRole === "client" && (
            <button
              className={view === "my-bookings" ? "active" : ""}
              onClick={() => setView("my-bookings")}
            >
              My appointments
            </button>
          )}
          {staffAccess && (
            <button
              className={view === "diary" ? "active" : ""}
              onClick={() => setView("diary")}
            >
              Salon diary
            </button>
          )}
          {reportAccess && (
            <button
              className={view === "report" ? "active" : ""}
              onClick={() => setView("report")}
            >
              Reports
            </button>
          )}
          {["admin", "it_support"].includes(activeRole || "") && (
            <button
              className={view === "workspace" ? "active" : ""}
              onClick={() => setView("workspace")}
            >
              {activeRole === "it_support"
                ? "Support workspace"
                : "Administration"}
            </button>
          )}
          {activeRole && (
            <span className="role-badge">
              {roleLabels[activeRole]}
              {!live ? " · preview" : ""}
            </span>
          )}
          <button
            disabled={busy}
            onClick={() => {
              if (activeRole || session) void signOut();
              else setView("login");
            }}
          >
            {activeRole || session ? "Sign out / lock" : "Sign in"}
          </button>
        </nav>
      </header>
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <main>
        {roleLoading && live ? (
          <section className="panel login" role="status">
            <h2>Opening your workspace…</h2>
          </section>
        ) : view === "book" ? (
          <>
            <div className="intro">
              <p className="eyebrow">A LITTLE TIME FOR YOU</p>
              <h1>
                Your next appointment,
                <br />
                <em>beautifully simple.</em>
              </h1>
              <p>Find your treatment and a time that suits you.</p>
            </div>
            <div className="steps">
              {["Treatment", "Your time", "Confirm", "Booked"].map((s, i) => (
                <span key={s} className={step === i + 1 ? "current" : ""}>
                  {i + 1} {s}
                </span>
              ))}
            </div>
            {step === 1 ? (
              <div className="catalog-layout">
                <aside>
                  <h3>Explore treatments</h3>
                  {categories.map((c) => (
                    <button
                      key={c}
                      className={category === c ? "chosen" : ""}
                      onClick={() => setCategory(c)}
                    >
                      {c}
                      <span>
                        {c === "All treatments"
                          ? treatments.length
                          : treatments.filter((t) => t.category === c).length}
                      </span>
                    </button>
                  ))}
                </aside>
                <section>
                  <div className="section-top">
                    <h2>{category}</h2>
                    <input
                      aria-label="Search treatments"
                      placeholder="Search treatments…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <p className="small">
                    Prices from the salon’s booking catalogue. Durations are
                    provisional for this demo.
                  </p>
                  <div className="treatment-grid">
                    {filtered.map((t) => (
                      <button
                        className="treatment"
                        key={t.id}
                        onClick={() => {
                          setTreatment(t);
                          setStep(2);
                          setConsent(false);
                        }}
                      >
                        <span className="eyebrow">{t.category}</span>
                        <h3>{t.name}</h3>
                        <div>
                          <span>
                            {t.duration} min <small>· demo duration</small>
                          </span>
                          <strong>
                            {t.price_type === "From" ? "From " : ""}
                            {money(t.price)}
                          </strong>
                        </div>
                        <span className="choose">Choose treatment ↗</span>
                      </button>
                    ))}
                  </div>
                  {!filtered.length && <p>No treatments match your search.</p>}
                </section>
              </div>
            ) : step === 2 && treatment ? (
              <div className="booking-layout">
                <section className="panel">
                  <button className="back" onClick={() => setStep(1)}>
                    ← Treatments
                  </button>
                  <h2>Find your perfect time</h2>
                  <label>
                    Who would you like to see?
                    <select
                      value={staffChoice}
                      onChange={(e) => setStaffChoice(Number(e.target.value))}
                    >
                      <option value={0}>No preference — first available</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Appointment date
                    <input
                      type="date"
                      min={today()}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <p className="small">
                    Demo opening hours: Monday–Saturday, 09:00–17:00. Lunch:
                    13:00–13:30.
                  </p>
                  <div className="slots">
                    {[...new Set(slots.map((s) => s.start_minute))].map(
                      (start) => (
                        <button
                          key={start}
                          className={
                            slot?.start_minute === start ? "chosen" : ""
                          }
                          onClick={() =>
                            setSlot(
                              slots.find((s) => s.start_minute === start)!,
                            )
                          }
                        >
                          {time(start)}
                        </button>
                      ),
                    )}
                  </div>
                  {!slots.length && (
                    <p>
                      No available times. Try another date or staff preference.
                    </p>
                  )}
                  <button
                    className="primary"
                    disabled={!slot}
                    onClick={() => setStep(3)}
                  >
                    Continue →
                  </button>
                </section>
                <Summary
                  treatment={treatment}
                  slot={slot}
                  date={date}
                  staff={staff}
                />
              </div>
            ) : step === 3 && treatment ? (
              <div className="booking-layout">
                <section className="panel">
                  <button className="back" onClick={() => setStep(2)}>
                    ← Change time
                  </button>
                  <h2>Make it yours</h2>
                  <label>
                    Your full name
                    <input
                      required
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Mobile number
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </label>
                  {live && !session && db && (
                    <AuthPanel
                      db={db}
                      onComplete={() => {}}
                      onBrowse={() => setStep(1)}
                    />
                  )}
                  {live && session && (
                    <p className="small">Signed in as {session.user.email}</p>
                  )}
                  <div className="guarantee">
                    <h3>Booking guarantee</h3>
                    <p>DEMO ONLY · Visa •••• 4242</p>
                    <p>
                      No card details are collected and no charge will be taken.
                    </p>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      I understand this is a simulated booking.
                    </label>
                  </div>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !consent ||
                      !name.trim() ||
                      (live && (!session || !phone.trim()))
                    }
                    onClick={book}
                  >
                    {busy ? "Saving…" : "Confirm appointment"}
                  </button>
                </section>
                <Summary
                  treatment={treatment}
                  slot={slot}
                  date={date}
                  staff={staff}
                />
              </div>
            ) : confirmation ? (
              <section className="success panel">
                <div className="success-icon">✓</div>
                <p className="eyebrow">YOU’RE ALL BOOKED</p>
                <h2>See you soon, {confirmation.client_name.split(" ")[0]}.</h2>
                <p>{confirmation.treatment_name}</p>
                <h3>
                  {confirmation.appointment_date} ·{" "}
                  {time(confirmation.start_minute)}
                </h3>
                <p>
                  {staff.find((s) => s.id === confirmation.staff_id)?.name} ·{" "}
                  {money(confirmation.price)}
                </p>
                <p className="small">
                  Booking saved. This demo does not send confirmation emails.
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    setView("my-bookings");
                    setStep(1);
                  }}
                >
                  View my appointments
                </button>
                <button
                  className="back"
                  onClick={() => {
                    setStep(1);
                    setConfirmation(null);
                  }}
                >
                  Book another treatment
                </button>
              </section>
            ) : null}
          </>
        ) : view === "login" || view === "recovery" ? (
          live && db ? (
            <AuthPanel
              db={db}
              recovery={view === "recovery"}
              onComplete={() => {
                if (view === "recovery") setView("login");
              }}
              onBrowse={() => setView("book")}
            />
          ) : (
            <section className="panel login">
              <p className="eyebrow">LOCAL DEMO · ROLE PREVIEW</p>
              <h1>Explore each workspace.</h1>
              <p>
                No account is created in this preview. Choose a role to see its
                experience.
              </p>
              <div className="role-options">
                {roles.map((r) => (
                  <button
                    key={r}
                    className="secondary"
                    onClick={() => {
                      setLocalRole(r as Role);
                      setView(roleHome(r));
                    }}
                  >
                    {roleLabels[r as Role]}
                  </button>
                ))}
              </div>
              <p className="small">
                For real sign-in, switch to Supabase connected mode above.
              </p>
            </section>
          )
        ) : view === "my-bookings" && activeRole === "client" ? (
          <section className="panel client-workspace">
            <p className="eyebrow">YOUR SCULPTED ACCOUNT</p>
            <h1>Your appointments.</h1>
            <p>{live ? session?.user.email : "Fictional client preview"}</p>
            <button
              className="primary"
              onClick={() => {
                setStep(1);
                setView("book");
              }}
            >
              Book a treatment →
            </button>
            <div className="booking-history">
              {(live
                ? myBookings
                : local.filter((a) => a.user_id === "local-client")
              ).map((a) => (
                <article className="history-card" key={a.id}>
                  <div>
                    <h3>{a.treatment_name}</h3>
                    <p>
                      {a.appointment_date} · {time(a.start_minute)} ·{" "}
                      {staff.find((s) => s.id === a.staff_id)?.name}
                    </p>
                  </div>
                  <div>
                    <strong>{money(a.price)}</strong>
                    <p className="status">{a.status.replace("_", " ")}</p>
                  </div>
                </article>
              ))}
            </div>
            {!(
              live
                ? myBookings
                : local.filter((a) => a.user_id === "local-client")
            ).length && (
              <p>No appointments yet. Your bookings will appear here.</p>
            )}
            <p className="small">
              Cancellation and rescheduling will be added when the salon policy
              is confirmed.
            </p>
          </section>
        ) : view === "workspace" &&
          ["admin", "it_support"].includes(activeRole || "") ? (
          <section className="owner-workspace">
            <p className="eyebrow">
              {activeRole === "it_support"
                ? "IT SUPPORT · SEPARATE AUDIT IDENTITY"
                : "OWNER & ADMINISTRATION"}
            </p>
            <h1>
              {activeRole === "it_support"
                ? "Your support workspace."
                : "Your salon, in one place."}
            </h1>
            <p>
              {activeRole === "it_support"
                ? "You have the owner’s operational access. Actions remain attributed to your individual account."
                : "Manage the day and review the salon’s recorded takings."}
            </p>
            <div className="workspace-grid">
              <button
                className="panel workspace-card"
                onClick={() => setView("diary")}
              >
                <h2>Salon diary</h2>
                <p>Appointments, check-in and checkout.</p>
                <span>Open diary →</span>
              </button>
              <button
                className="panel workspace-card"
                onClick={() => setView("report")}
              >
                <h2>Reports</h2>
                <p>Completed treatments and payment methods.</p>
                <span>Open reports →</span>
              </button>
              <div className="panel">
                <h2>Accounts & permissions</h2>
                <p>Individual accounts with salon-assigned roles.</p>
                <p className="small">
                  Account provisioning is currently managed in Supabase. Client
                  registrations cannot choose a staff role.
                </p>
              </div>
              <div className="panel">
                <h2>Coming next</h2>
                <p>Staff, rotas, treatment administration and HR reporting.</p>
                <p className="small">
                  These administration tools are not yet available in this demo.
                </p>
              </div>
            </div>
          </section>
        ) : !canAccess(activeRole, view) ? (
          <section className="panel login">
            <h2>Sign in to continue.</h2>
            <p>Your account determines which salon features you can access.</p>
            <button className="primary" onClick={() => setView("login")}>
              Sign in
            </button>
          </section>
        ) : (
          <>
            <div className="section-top diary-heading">
              <div>
                <p className="eyebrow">YOUR SALON, AT A GLANCE</p>
                <h1>
                  {view === "diary"
                    ? "A beautifully organised day."
                    : "Daily overview."}
                </h1>
              </div>
              <div className="date-controls">
                <button onClick={() => setDate(demoDate())}>Today</button>
                <input
                  aria-label="Diary date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                {live && (
                  <button onClick={() => void refresh()}>Refresh</button>
                )}
              </div>
            </div>
            <div className="metrics">
              <div>
                <span>
                  {activeRole === "accountant"
                    ? "Completed records"
                    : "Appointments"}
                </span>
                <strong>
                  {
                    dayAppointments.filter((a) => a.status !== "cancelled")
                      .length
                  }
                </strong>
              </div>
              <div>
                <span>Completed</span>
                <strong>{completed.length}</strong>
              </div>
              <div>
                <span>Recorded takings</span>
                <strong>
                  {money(completed.reduce((s, a) => s + a.price, 0))}
                </strong>
              </div>
            </div>
            {view === "diary" ? (
              <>
                <div className="legend">
                  <span>● Booked</span>
                  <span>● Checked in</span>
                  <span>● Completed</span>
                  <span>▧ Break / unavailable</span>
                </div>
                <div className="diary-scroll">
                  <div className="diary">
                    <div className="time-column">
                      <div className="staff-heading">Dublin time</div>
                      <div className="time-body">
                        {Array.from({ length: 9 }, (_, i) => (
                          <span key={i} style={{ top: i * 96 }}>
                            {time(540 + i * 60)}
                          </span>
                        ))}
                      </div>
                    </div>
                    {staff.map((s) => (
                      <div className="staff-column" key={s.id}>
                        <div className="staff-heading">
                          <span className="avatar">{s.name[0]}</span>
                          {s.name}
                        </div>
                        <div className="diary-body">
                          {Array.from({ length: 16 }, (_, i) => (
                            <div
                              className="gridline"
                              key={i}
                              style={{ top: i * 48 }}
                            />
                          ))}
                          {new Date(date + "T12:00:00").getDay() === 0 ? (
                            <div className="closed">Salon closed</div>
                          ) : (
                            <div
                              className="break-block"
                              style={{ top: 384, height: 48 }}
                            >
                              Lunch · 13:00–13:30
                            </div>
                          )}
                          {dayAppointments
                            .filter(
                              (a) =>
                                a.staff_id === s.id && a.status !== "cancelled",
                            )
                            .map((a) => (
                              <button
                                key={a.id}
                                className={`appointment ${a.status}`}
                                style={{
                                  top: (a.start_minute - 540) * 1.6,
                                  height: Math.max(a.duration * 1.6, 24),
                                }}
                                onClick={() => setSelected(a)}
                              >
                                <strong>
                                  {time(a.start_minute)} · {a.client_name}
                                </strong>
                                <span>{a.treatment_name}</span>
                                <small>{a.status.replace("_", " ")}</small>
                              </button>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="small">
                  Fictional clients. Working hours, breaks, qualifications and
                  durations are demo assumptions.
                </p>
              </>
            ) : (
              <section className="panel">
                <h2>Completed treatments</h2>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Treatment</th>
                        <th>Payment</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completed.map((a) => (
                        <tr key={a.id}>
                          <td>{a.client_name}</td>
                          <td>{a.treatment_name}</td>
                          <td>{a.payment_method || "—"}</td>
                          <td>{money(a.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!completed.length && (
                  <p>No completed appointments for this day.</p>
                )}
                <p className="small">
                  Recorded payment methods only; no payment processing or
                  terminal reconciliation.
                </p>
              </section>
            )}
          </>
        )}
      </main>
      <footer>
        SCULPTED BY AOIFE CLAIRE <span>Salon system · Proof of concept</span>
      </footer>
      {selected && staffAccess && (
        <div className="modal-backdrop">
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Appointment details"
          >
            <button
              className="close"
              aria-label="Close appointment"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <p className="eyebrow">APPOINTMENT DETAILS</p>
            <h2>{selected.client_name}</h2>
            <h3>{selected.treatment_name}</h3>
            <p>
              {selected.appointment_date} · {time(selected.start_minute)}–
              {time(selected.start_minute + selected.duration)}
            </p>
            <p>
              {staff.find((s) => s.id === selected.staff_id)?.name} ·{" "}
              {money(selected.price)}
            </p>
            <span className="status">{selected.status.replace("_", " ")}</span>
            <hr />
            {selected.status === "booked" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void changeStatus("checked_in")}
              >
                Check client in
              </button>
            )}
            {selected.status === "checked_in" && (
              <>
                <h3>Complete & record payment</h3>
                <div className="payment-buttons">
                  {["card", "cash", "voucher", "credit"].map((p) => (
                    <button
                      disabled={busy}
                      key={p}
                      onClick={() => void changeStatus("completed", p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <p className="small">
                  Voucher and credit are labels in this first slice; balances
                  are not redeemed.
                </p>
              </>
            )}
            {selected.status === "booked" && (
              <button
                className="back"
                disabled={busy}
                onClick={() => void changeStatus("cancelled")}
              >
                Cancel appointment
              </button>
            )}
          </section>
        </div>
      )}
    </>
  );
}
function Summary({
  treatment,
  slot,
  date,
  staff,
}: {
  treatment: Treatment;
  slot: Slot | null;
  date: string;
  staff: Staff[];
}) {
  return (
    <aside className="summary">
      <p className="eyebrow">YOUR APPOINTMENT</p>
      <h2>{treatment.name}</h2>
      <p>{treatment.duration} minutes · provisional duration</p>
      <h3>
        {treatment.price_type === "From" ? "From " : ""}
        {money(treatment.price)}
      </h3>
      <hr />
      <p>{date}</p>
      {slot && (
        <>
          <h3>{time(slot.start_minute)}</h3>
          <p>With {staff.find((s) => s.id === slot.staff_id)?.name}</p>
        </>
      )}
      <p className="small">
        A little care. A little confidence.
        <br />A moment just for you.
      </p>
    </aside>
  );
}
