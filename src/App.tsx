import { useEffect, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import catalog from "./catalog.json";
import { availableSlots } from "./availability.js";
type Treatment = (typeof catalog)[number];
type Staff = { id: number; name: string };
type Appointment = {
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
  const [live, setLive] = useState(false),
    [view, setView] = useState("book"),
    [treatments, setTreatments] = useState<Treatment[]>(catalog),
    [staff, setStaff] = useState<Staff[]>(initialStaff),
    [session, setSession] = useState<Session | null>(null),
    [staffAccess, setStaffAccess] = useState(false);
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
    [email, setEmail] = useState(""),
    [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [signUp, setSignUp] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Appointment | null>(null);
  const appointments = live ? remote : local;
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
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = db.auth.onAuthStateChange((_e, s) => setSession(s));
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
    if (!live || !db) return;
    const { data, error } = await db
      .from("appointments")
      .select("*")
      .eq("appointment_date", date)
      .order("start_minute");
    if (error) setError(error.message);
    else setRemote(data as Appointment[]);
  }
  useEffect(() => {
    setStaffAccess(false);
    if (!live || !db || !session) return;
    db.from("staff_users")
      .select("user_id")
      .eq("user_id", session.user.id)
      .then(({ data }) => setStaffAccess(!!data?.length));
  }, [session, live]);
  useEffect(() => {
    void refresh();
  }, [live, session, date]);
  useEffect(() => {
    let cancelled = false;
    setSlot(null);
    setSlots([]);
    if (!treatment) return;
    if (live && db) {
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
  async function authenticate(createAccount = signUp) {
    if (!db) return;
    setBusy(true);
    setError("");
    try {
      const r = createAccount
        ? await db.auth.signUp({
            email,
            password,
            options: { data: { full_name: name, mobile: phone } },
          })
        : await db.auth.signInWithPassword({ email, password });
      if (r.error) throw r.error;
      if (createAccount && !r.data.session)
        setError(
          "Account created. Check your email to confirm it, then sign in.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
            setLive(!live);
            setTreatment(null);
            setConfirmation(null);
            setStep(1);
            setSelected(null);
            setView("book");
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
          <button
            className={view === "book" ? "active" : ""}
            onClick={() => setView("book")}
          >
            Book a treatment
          </button>
          <button
            className={view === "diary" ? "active" : ""}
            onClick={() => setView("diary")}
          >
            Salon diary
          </button>
          <button
            className={view === "report" ? "active" : ""}
            onClick={() => setView("report")}
          >
            Daily overview
          </button>
          {live && (
            <button
              onClick={() => {
                if (session) void db?.auth.signOut();
                else setView("login");
              }}
            >
              {session ? "Sign out" : "Sign in"}
            </button>
          )}
        </nav>
      </header>
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <main>
        {view === "book" ? (
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
                  {live && !session && (
                    <>
                      <label>
                        Email
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </label>
                      <label>
                        Password
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={signUp}
                          onChange={(e) => setSignUp(e.target.checked)}
                        />
                        Create a new account
                      </label>
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          !email ||
                          !password ||
                          (signUp && (!name.trim() || !phone.trim()))
                        }
                        onClick={() => void authenticate()}
                      >
                        {signUp ? "Create account" : "Sign in"}
                      </button>
                    </>
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
                    setView("diary");
                    setStep(1);
                  }}
                >
                  View in salon diary
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
        ) : view === "login" ? (
          <section className="panel login">
            <p className="eyebrow">SALON ACCESS</p>
            <h1>Welcome back.</h1>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setSignUp(false);
                void authenticate(false);
              }}
            >
              Sign in
            </button>
            {session && (
              <button onClick={() => setView("diary")}>Open diary →</button>
            )}
          </section>
        ) : live && !staffAccess ? (
          <section className="panel">
            <h2>Staff access required</h2>
            <p>
              Sign in with an account assigned to the salon staff list. Customer
              accounts cannot access the salon diary or reports.
            </p>
            <button className="primary" onClick={() => setView("login")}>
              Staff sign in
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
                <span>Appointments</span>
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
      {selected && (
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
