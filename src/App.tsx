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
import {
  availableSlots,
  startInterval,
  periodSlots,
  attendedTreatmentIds,
} from "./availability.js";
type Treatment = (typeof catalog)[number];
import StaffWorkspace from "./StaffWorkspace";
import type {
  Staff,
  Appointment,
  Client,
  LocalStaffData,
  DiaryBreak,
} from "./domain";
import {
  demoClients,
  effectiveBreaks,
  shiftDate,
  validateBreak,
  validTransition,
} from "./staffModel.js";
const staffPortal =
  new URLSearchParams(window.location.search).get("portal") === "staff";
type Slot = { staff_id: number; start_minute: number };
const env = (import.meta as unknown as { env: Record<string, string> }).env;
const db =
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY
    ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          storageKey: staffPortal
            ? "sculpted-staff-session"
            : "sculpted-client-session",
          storage: staffPortal ? sessionStorage : localStorage,
        },
      })
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
  const [staffId, setStaffId] = useState<number | null>(null),
    [localStaffId, setLocalStaffId] = useState<number | null>(null);
  const [loginTile, setLoginTile] = useState<number | null>(null),
    [pin, setPin] = useState("");
  const [ownClient, setOwnClient] = useState<Client | null>(null);
  const [staffClient, setStaffClient] = useState<Client | null>(null),
    [amending, setAmending] = useState<Appointment | null>(null),
    [changeReason, setChangeReason] = useState("");
  const [initialStaffAppointment, setInitialStaffAppointment] =
    useState<Appointment | null>(null);
  const [staffData, setStaffData] = useState<LocalStaffData>(() => {
    try {
      return (
        JSON.parse(
          localStorage.getItem("sculpted-staff-data-v1") || "null",
        ) || { clients: demoClients, notes: [], activity: [], breaks: [] }
      );
    } catch {
      return { clients: demoClients, notes: [], activity: [], breaks: [] };
    }
  });
  const [remoteBreaks, setRemoteBreaks] = useState<DiaryBreak[]>([]),
    [breakDraft, setBreakDraft] = useState<DiaryBreak | null>(null),
    [breakStart, setBreakStart] = useState("13:00"),
    [breakEnd, setBreakEnd] = useState("13:30");
  const [statusAction, setStatusAction] = useState(""),
    [statusReason, setStatusReason] = useState("");
  const [requiresPasswordChange, setRequiresPasswordChange] = useState(false),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  const requestVersion = useRef(0);
  const identityVersion = useRef(0);
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
        ).map((a: Appointment) => ({
          ...a,
          client_id:
            a.client_id ||
            demoClients.find((c) => c.name === a.client_name)?.id,
          treatment_id:
            a.treatment_id ||
            catalog.find((t) => t.name === a.treatment_name)?.id,
          revision: a.revision || 0,
        }));
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
    [step, setStep] = useState(0),
    [confirmation, setConfirmation] = useState<Appointment | null>(null);
  const [forSelf, setForSelf] = useState(true);
  const [email, setEmail] = useState("");
  const [period, setPeriod] = useState("");
  const [card, setCard] = useState("");
  function startBooking() {
    setStep(0);
    setView("book");
    setTreatment(null);
    setSlot(null);
    setPeriod("");
    setCategory("All treatments");
    setConsent(false);
    setCard("");
  }
  function chooseRecipient(self: boolean) {
    setForSelf(self);
    setCategory("All treatments");
    setSearch("");
    setName(
      self
        ? ownClient?.name ||
            session?.user.user_metadata.full_name ||
            (live ? "" : "Demo Client")
        : "",
    );
    setPhone(
      self
        ? ownClient?.phone ||
            session?.user.user_metadata.mobile ||
            (live ? "" : "0800000000")
        : "",
    );
    setEmail(self ? session?.user.email || "client@example.com" : "");
    setStep(
      self &&
        (!live ||
          ((ownClient?.name || session?.user.user_metadata.full_name) &&
            (ownClient?.phone || session?.user.user_metadata.mobile)))
        ? 1
        : -1,
    );
  }
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
  const breaks: DiaryBreak[] = live
    ? remoteBreaks
    : effectiveBreaks(
        staff.map((s) => s.id),
        date,
        staffData.breaks,
      );
  const ownStaffId = live ? staffId : localStaffId;
  const actorName =
    staff.find((s) => s.id === ownStaffId)?.name ||
    roleLabels[activeRole || "client"];
  useEffect(() => {
    localStorage.setItem("sculpted-staff-data-v1", JSON.stringify(staffData));
  }, [staffData]);
  function auditLocal(
    action: string,
    appointment: Appointment | null,
    details: Record<string, any>,
  ) {
    setStaffData((d) => ({
      ...d,
      activity: [
        ...d.activity,
        {
          id: crypto.randomUUID(),
          client_id: appointment?.client_id,
          appointment_id: appointment?.id,
          action,
          details,
          actor_name: actorName,
          created_at: new Date().toISOString(),
        },
      ],
    }));
  }
  function staffHome() {
    setInitialStaffAppointment(null);
    setStaffClient(null);
    setAmending(null);
    setSelected(null);
    setView("staff-workspace");
  }
  function beginStaffBooking(client: Client, appointment?: Appointment) {
    setStaffClient(client);
    setAmending(appointment || null);
    setName(client.name);
    setEmail(client.email);
    setPhone(client.phone);
    setForSelf(true);
    setCategory("All treatments");
    setSearch("");
    setTreatment(null);
    setSlot(null);
    setPeriod("");
    setConsent(false);
    setCard("");
    setChangeReason("");
    setStep(1);
    setView("book");
    setSelected(null);
    if (appointment) {
      setStaffChoice(appointment.staff_id);
      setDate(appointment.appointment_date);
    }
  }
  async function amendFromDiary(a: Appointment) {
    setBusy(true);
    setError("");
    try {
      const r =
        live && db
          ? await db
              .from("clients")
              .select("*")
              .eq("id", a.client_id)
              .maybeSingle()
          : null;
      if (r?.error) throw r.error;
      const c = live
        ? r?.data
        : staffData.clients.find((c) => c.id === a.client_id);
      if (!c)
        throw Error(
          "This appointment needs a linked client record. Apply migration 005 first.",
        );
      beginStaffBooking(c, a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancelFromWorkspace(a: Appointment, reason: string) {
    if (live && db) {
      const r = await db.rpc("update_appointment_status", {
        p_id: a.id,
        p_status: "cancelled",
        p_revision: a.revision || 0,
        p_reason: reason,
      });
      if (r.error) throw r.error;
      await refresh();
    } else {
      setLocal((as) =>
        as.map((x) =>
          x.id === a.id
            ? { ...x, status: "cancelled", revision: (x.revision || 0) + 1 }
            : x,
        ),
      );
      auditLocal("status_changed", a, {
        before: a.status,
        after: "cancelled",
        reason,
        guarantee_charged: false,
      });
    }
  }
  function openBreak(b?: DiaryBreak) {
    const draft = b || {
      id: null,
      staff_id: ownStaffId || 0,
      kind: "break",
      start_minute: 840,
      duration: 15,
      revision: 0,
    };
    if (draft.staff_id !== ownStaffId) {
      setError("You can only change your own breaks.");
      return;
    }
    setBreakDraft(draft);
    setBreakStart(time(draft.start_minute));
    setBreakEnd(time(draft.start_minute + draft.duration));
    setError("");
  }
  async function saveBreak() {
    if (!breakDraft) return;
    const operation = identityVersion.current;
    setBusy(true);
    setError("");
    const minute = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const start = minute(breakStart),
      end = minute(breakEnd);
    try {
      if (live && db) {
        const r = await db.rpc("save_staff_break", {
          p_date: date,
          p_start: start,
          p_end: end,
          p_kind: breakDraft.kind,
          p_id: breakDraft.id,
          p_revision: breakDraft.revision,
        });
        if (r.error) throw r.error;
        if (operation !== identityVersion.current) return;
        await refresh();
      } else {
        validateBreak({
          staffId: ownStaffId,
          date,
          start,
          end,
          breakId: breakDraft.id,
          kind: breakDraft.kind,
          appointments: local,
          breaks,
        });
        const b = {
          ...breakDraft,
          id: breakDraft.id || crypto.randomUUID(),
          appointment_date: date,
          start_minute: start,
          duration: end - start,
          revision: breakDraft.revision + 1,
        };
        setStaffData((d) => ({
          ...d,
          breaks: [
            ...d.breaks.filter(
              (x) =>
                x.id !== b.id &&
                !(
                  b.kind === "lunch" &&
                  x.kind === "lunch" &&
                  x.staff_id === b.staff_id &&
                  x.appointment_date === date
                ),
            ),
            b,
          ],
        }));
        auditLocal("staff_break_saved", null, { before: breakDraft, after: b });
      }
      setBreakDraft(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    localStorage.setItem("sculpted-demo-v1", JSON.stringify(local));
  }, [local]);
  useEffect(() => {
    if (!db) return;
    db.auth.getSession().then(({ data, error }) => {
      authUser.current = data.session?.user.id || null;
      setSession(data.session);
      setRequiresPasswordChange(
        !!data.session?.user.app_metadata.requires_password_change,
      );
      if (error) {
        setError(error.message);
        setRoleLoading(false);
      } else if (!data.session) setRoleLoading(false);
    });
    const { data } = db.auth.onAuthStateChange((event, nextSession) => {
      requestVersion.current++;
      if (authUser.current !== (nextSession?.user.id || null)) {
        identityVersion.current++;
        setRole(null);
        setRemote([]);
        setMyBookings([]);
        setSelected(null);
        setOwnClient(null);
        setStaffId(null);
        setStaffClient(null);
        setAmending(null);
        setInitialStaffAppointment(null);
        setBreakDraft(null);
        setStatusAction("");
        setRemoteBreaks([]);
        setLoginTile(null);
        setPin("");
        setConfirmation(null);
        setStep(0);
        setPeriod("");
        setCard("");
        setConsent(false);
        setRoleLoading(!!nextSession);
        authUser.current = nextSession?.user.id || null;
      }
      setSession(nextSession);
      setRequiresPasswordChange(
        !!nextSession?.user.app_metadata.requires_password_change,
      );
      if (event === "PASSWORD_RECOVERY") setView("recovery");
      if (event === "SIGNED_OUT") {
        setRole(null);
        setRemote([]);
        setMyBookings([]);
        setSelected(null);
        setOwnClient(null);
        setStaffId(null);
        setStaffClient(null);
        setAmending(null);
        setInitialStaffAppointment(null);
        setBreakDraft(null);
        setStatusAction("");
        setRemoteBreaks([]);
        setLoginTile(null);
        setPin("");
        setConfirmation(null);
        setStep(0);
        setPeriod("");
        setCard("");
        setConsent(false);
        setName("");
        setPhone("");
        setStep(0);
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
    if (staffAccess) {
      const b = await db.rpc("get_diary_breaks", { p_date: date });
      if (version === requestVersion.current) {
        if (b.error) setError(b.error.message);
        else setRemoteBreaks(b.data || []);
      }
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
      .select("role,staff_id")
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
        setStaffId(data?.staff_id || null);
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
  useEffect(() => {
    if (!live || !db || !session || activeRole !== "client") {
      setOwnClient(null);
      return;
    }
    let cancelled = false;
    db.from("clients")
      .select("id,name,email,phone,auth_user_id,revision")
      .eq("auth_user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setOwnClient(data);
      });
    return () => {
      cancelled = true;
    };
  }, [live, session?.user.id, activeRole, view]);
  useEffect(() => {
    if (!staffAccess) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          void signOut();
        },
        5 * 60 * 1000,
      );
    };
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [staffAccess, session?.user.id, localStaffId]);
  async function signOut() {
    identityVersion.current++;
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
    setOwnClient(null);
    setLocalStaffId(null);
    setStaffId(null);
    setLoginTile(null);
    setPin("");
    setStaffClient(null);
    setAmending(null);
    setInitialStaffAppointment(null);
    setRemoteBreaks([]);
    setBreakDraft(null);
    setStatusAction("");
    setStatusReason("");
    setRequiresPasswordChange(false);
    setNewPassword("");
    setConfirmPassword("");
    setEmail("");
    setRemote([]);
    setMyBookings([]);
    setSelected(null);
    setConfirmation(null);
    setStep(0);
    setPeriod("");
    setCard("");
    setConsent(false);
    setTreatment(null);
    setSlot(null);
    setName("");
    setPhone("");
    setStep(0);
    setRoleLoading(false);
    setView("login");
    setBusy(false);
  }
  useEffect(() => {
    let cancelled = false;
    setSlot(null);
    setSlots([]);
    if (!treatment) return;
    if (live && db && session) {
      db.rpc(amending ? "get_booking_slots" : "get_available_slots", {
        p_treatment_id: treatment.id,
        p_date: date,
        p_staff_id: staffChoice || null,
        ...(amending ? { p_exclude_id: amending.id } : {}),
      }).then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else
          setSlots(
            (data || []).filter(
              (s: Slot) =>
                s.start_minute % startInterval(treatment.duration) === 0,
            ),
          );
      });
    } else {
      const sunday = new Date(date + "T12:00:00").getDay() === 0;
      setSlots(
        sunday
          ? []
          : availableSlots(
              treatment.duration,
              staffChoice ? [staffChoice] : staff.map((s) => s.id),
              local.filter(
                (a) => a.appointment_date === date && a.id !== amending?.id,
              ),
              breaks,
            ),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [
    treatment,
    date,
    staffChoice,
    live,
    local,
    staff,
    staffData.breaks,
    remoteBreaks,
    amending?.id,
  ]);
  async function book() {
    if (
      !treatment ||
      !slot ||
      (!amending && (!consent || !card)) ||
      (!staffClient && activeRole !== "client") ||
      requiresPasswordChange
    )
      return;
    const operation = identityVersion.current;
    setBusy(true);
    setError("");
    try {
      let a: Appointment;
      if (live) {
        if (!session || !db) throw Error("Please sign in first.");
        const r = amending
          ? await db.rpc("amend_appointment", {
              p_id: amending.id,
              p_treatment_id: treatment.id,
              p_staff_id: slot.staff_id,
              p_date: date,
              p_start: slot.start_minute,
              p_revision: amending.revision || 0,
              p_reason: changeReason,
            })
          : staffClient
            ? await db.rpc("staff_book_appointment", {
                p_client_id: staffClient.id,
                p_treatment_id: treatment.id,
                p_staff_id: slot.staff_id,
                p_date: date,
                p_start: slot.start_minute,
                p_demo_card: card,
                p_demo_consent: consent,
              })
            : await db.rpc("book_appointment", {
                p_treatment_id: treatment.id,
                p_staff_id: slot.staff_id,
                p_date: date,
                p_start: slot.start_minute,
                p_client_name: name.trim(),
                p_phone: phone.trim(),
                p_demo_consent: consent,
                p_booked_for_self: forSelf,
                p_attendee_email: email.trim(),
                p_demo_card: card,
              });
        if (r.error) throw r.error;
        if (operation !== identityVersion.current) return;
        a = r.data;
        await refresh();
      } else {
        if (!name.trim()) throw Error("Please enter a name.");
        const valid = availableSlots(
          treatment.duration,
          [slot.staff_id],
          local.filter(
            (a) => a.appointment_date === date && a.id !== amending?.id,
          ),
          breaks,
        ).some((s) => s.start_minute === slot.start_minute);
        if (!valid)
          throw Error("That time is no longer available. Choose another.");
        let recipient = staffClient;
        if (!recipient) {
          recipient = forSelf
            ? staffData.clients.find(
                (c) => c.auth_user_id === "local-client",
              ) || null
            : null;
          if (!recipient) {
            recipient = {
              id: crypto.randomUUID(),
              auth_user_id: forSelf ? "local-client" : null,
              name: name.trim(),
              email: email.trim(),
              phone: phone.trim(),
              revision: 0,
            };
            const c = recipient;
            setStaffData((d) => ({ ...d, clients: [...d.clients, c] }));
          }
        }
        a = {
          id: amending?.id || crypto.randomUUID(),
          client_id: recipient?.id || amending?.client_id,
          revision: amending ? (amending.revision || 0) + 1 : 0,
          user_id: amending
            ? amending.user_id
            : staffClient
              ? staffClient.auth_user_id
              : "local-client",
          treatment_id: treatment.id,
          booked_for_self: amending?.booked_for_self ?? forSelf,
          attendee_email: amending?.attendee_email || email.trim(),
          phone: amending?.phone || phone.trim(),
          staff_id: slot.staff_id,
          start_minute: slot.start_minute,
          duration: treatment.duration,
          client_name: amending?.client_name || name.trim(),
          treatment_name: treatment.name,
          price: treatment.price,
          status: amending?.status || "booked",
          appointment_date: date,
        };
        if (amending && !changeReason.trim())
          throw Error("Add a reason for the amendment.");
        if (amending && treatment.id === amending.treatment_id)
          a.price = amending.price;
        setLocal((prev) =>
          amending ? prev.map((x) => (x.id === a.id ? a : x)) : [...prev, a],
        );
        auditLocal(
          amending
            ? "appointment_amended"
            : staffClient
              ? "staff_booking_created"
              : "booking_created",
          a,
          { before: amending, after: a, reason: changeReason },
        );
        if (!localRole) setLocalRole("client");
      }
      if (operation !== identityVersion.current) return;
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
    const operation = identityVersion.current;
    setBusy(true);
    setError("");
    try {
      if (live && db) {
        const r = await db.rpc("update_appointment_status", {
          p_id: selected.id,
          p_status: status,
          p_payment: payment || null,
          p_revision: selected.revision || 0,
          p_reason: statusReason || null,
        });
        if (r.error) throw r.error;
        if (operation !== identityVersion.current) return;
        await refresh();
      } else {
        if (!validTransition(selected.status, status))
          throw Error("Invalid appointment transition.");
        if (["cancelled", "no_show"].includes(status) && !statusReason.trim())
          throw Error("Add a reason.");
        auditLocal("status_changed", selected, {
          before: selected.status,
          after: status,
          payment_method: payment,
          reason: statusReason,
          guarantee_charged: false,
        });
        setLocal((prev) =>
          prev.map((a) =>
            a.id === selected.id
              ? {
                  ...a,
                  status,
                  payment_method: payment,
                  revision: (a.revision || 0) + 1,
                }
              : a,
          ),
        );
      }
      setSelected(null);
      setStatusAction("");
      setStatusReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const previousIds = attendedTreatmentIds(
    live ? myBookings : local.filter((a) => a.user_id === "local-client"),
  );
  const visibleSlots: Slot[] = periodSlots(slots, period);
  const categories = [
    ...(forSelf && !staffClient ? ["Previous Bookings"] : []),
    "All treatments",
    ...new Set(treatments.map((t) => t.category)),
  ];
  const filtered = treatments.filter(
    (t) =>
      (category === "All treatments" ||
        (category === "Previous Bookings"
          ? previousIds.includes(t.id)
          : t.category === category)) &&
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
            identityVersion.current++;
            setLive(!live);
            setRole(null);
            setLocalRole(null);
            setOwnClient(null);
            setLocalStaffId(null);
            setStaffId(null);
            setLoginTile(null);
            setPin("");
            setStaffClient(null);
            setAmending(null);
            setInitialStaffAppointment(null);
            setRemoteBreaks([]);
            setBreakDraft(null);
            setRemote([]);
            setMyBookings([]);
            setName("");
            setPhone("");
            setTreatment(null);
            setConfirmation(null);
            setStep(0);
            setPeriod("");
            setCard("");
            setConsent(false);
            setStep(0);
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
        <a
          className="brand"
          href="#"
          onClick={() =>
            staffAccess
              ? staffHome()
              : activeRole === "client"
                ? startBooking()
                : setView("login")
          }
        >
          SCULPTED<span>BY AOIFE CLAIRE</span>
        </a>
        <nav>
          {activeRole === "client" && !staffPortal && (
            <button
              className={view === "book" ? "active" : ""}
              onClick={() =>
                staffAccess
                  ? staffHome()
                  : activeRole === "client"
                    ? startBooking()
                    : setView("login")
              }
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
              className={view === "staff-workspace" ? "active" : ""}
              onClick={staffHome}
            >
              Staff home
            </button>
          )}
          {staffAccess && (
            <button
              className={view === "diary" ? "active" : ""}
              onClick={() => {
                setDate(today());
                setView("diary");
              }}
            >
              Staff Diary
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
            {staffAccess
              ? "Switch profile / lock"
              : activeRole || session
                ? "Sign out / lock"
                : "Sign in"}
          </button>
        </nav>
      </header>
      {error && !selected && !breakDraft && (
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
        ) : requiresPasswordChange && session && db ? (
          <section className="panel login">
            <h1>Choose your own password.</h1>
            <p>
              Your login was created with a temporary password. Change it before
              continuing.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  if (newPassword !== confirmPassword)
                    throw Error("Passwords do not match.");
                  const r = await db.functions.invoke("create-client-account", {
                    body: { action: "set_password", password: newPassword },
                  });
                  if (r.error || r.data?.error)
                    throw Error(r.data?.error || r.error?.message);
                  const refreshed = await db.auth.refreshSession();
                  if (refreshed.error) throw refreshed.error;
                  setRequiresPasswordChange(false);
                  setNewPassword("");
                  setConfirmPassword("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                New password
                <input
                  required
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label>
                Confirm password
                <input
                  required
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Save new password
              </button>
            </form>
          </section>
        ) : staffPortal && activeRole === "client" ? (
          <section className="panel login">
            <h1>Staff account required.</h1>
            <p>
              This is the salon’s staff entry point. Your current account is a
              client account.
            </p>
            <button className="primary" onClick={() => void signOut()}>
              Switch account
            </button>
          </section>
        ) : view === "staff-workspace" && staffAccess ? (
          <StaffWorkspace
            key={`${live}-${session?.user.id || localStaffId}-${initialStaffAppointment?.id || "home"}`}
            db={db}
            live={live}
            data={staffData}
            setData={setStaffData}
            appointments={local}
            actor={actorName}
            initialAppointment={initialStaffAppointment}
            onDiary={() => {
              setDate(today());
              setView("diary");
            }}
            onBook={beginStaffBooking}
            onCancel={cancelFromWorkspace}
          />
        ) : view === "book" &&
          (activeRole === "client" || (staffAccess && staffClient)) ? (
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
              {["Treatment", "Your time", "Guarantee", "Booked"].map((s, i) => (
                <span key={s} className={step === i + 1 ? "current" : ""}>
                  {i + 1} {s}
                </span>
              ))}
            </div>
            {step === 0 ? (
              <section className="panel login">
                <h2>Who are you booking for?</h2>
                <div className="role-options">
                  <button
                    className="primary"
                    onClick={() => chooseRecipient(true)}
                  >
                    Book Appointment for Yourself
                  </button>
                  <button
                    className="secondary"
                    onClick={() => chooseRecipient(false)}
                  >
                    Book Appointment for Someone Else
                  </button>
                </div>
              </section>
            ) : step === -1 ? (
              <section className="panel login">
                <button
                  className="back"
                  onClick={() => (staffClient ? staffHome() : setStep(0))}
                >
                  ← Who are you booking for?
                </button>
                <h2>{forSelf ? "Your contact details" : "Their details"}</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setStep(1);
                  }}
                >
                  <label>
                    Full name
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Email address
                    <input
                      type="email"
                      required
                      value={email}
                      readOnly={forSelf}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label>
                    Phone number
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    type="submit"
                    disabled={!name.trim() || !phone.trim()}
                  >
                    Continue to treatments →
                  </button>
                </form>
              </section>
            ) : step === 1 ? (
              <div className="catalog-layout">
                <aside>
                  <button
                    className="back"
                    onClick={() => (staffClient ? staffHome() : setStep(0))}
                  >
                    ← Booking recipient
                  </button>
                  <h3>Explore treatments</h3>
                  {staffClient && (
                    <p className="small">
                      {amending ? "Amending" : "Booking for"} {staffClient.name}
                    </p>
                  )}
                  {categories.map((c) => (
                    <button
                      key={c}
                      className={category === c ? "chosen" : ""}
                      onClick={() => setCategory(c)}
                    >
                      {c}
                      <span>
                        {c === "Previous Bookings"
                          ? previousIds.length
                          : c === "All treatments"
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
                          setPeriod("");
                          setCard("");
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
                  {!filtered.length && (
                    <p>
                      {category === "Previous Bookings"
                        ? "No previously attended treatments yet."
                        : "No treatments match your search."}
                    </p>
                  )}
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
                  <fieldset className="period-choice">
                    <legend>Morning or afternoon?</legend>
                    {["morning", "afternoon"].map((p) => (
                      <button
                        key={p}
                        className={period === p ? "chosen" : "secondary"}
                        onClick={() => {
                          setPeriod(p);
                          setSlot(null);
                        }}
                      >
                        {p === "morning"
                          ? "Morning · 08:00–12:00"
                          : "Afternoon · from 12:00"}
                      </button>
                    ))}
                  </fieldset>
                  {!period && (
                    <p className="small">
                      Choose morning or afternoon to see available times.
                    </p>
                  )}
                  <div className="slots">
                    {[...new Set(visibleSlots.map((s) => s.start_minute))].map(
                      (start) => (
                        <button
                          key={start}
                          className={
                            slot?.start_minute === start ? "chosen" : ""
                          }
                          onClick={() =>
                            setSlot(
                              visibleSlots.find(
                                (s) => s.start_minute === start,
                              )!,
                            )
                          }
                        >
                          {time(start)}
                        </button>
                      ),
                    )}
                  </div>
                  {period && !visibleSlots.length && (
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
                  onContinue={() => setStep(3)}
                />
              </div>
            ) : step === 3 && treatment ? (
              <div className="booking-layout">
                <section className="panel">
                  <button className="back" onClick={() => setStep(2)}>
                    ← Change time
                  </button>
                  <h2>
                    {amending
                      ? "Review appointment changes"
                      : "Booking Guarantee"}
                  </h2>
                  {!amending && (
                    <p>
                      Guarantee your booking using your saved card details, or
                      supply new card details.
                    </p>
                  )}
                  <p>
                    Booking for <strong>{name}</strong> · {email}
                  </p>
                  {amending ? (
                    <label>
                      Reason for amendment
                      <textarea
                        required
                        value={changeReason}
                        onChange={(e) => setChangeReason(e.target.value)}
                      />
                    </label>
                  ) : (
                    <div className="guarantee">
                      <p>
                        No payment will be taken now. Payment will be taken in
                        the salon after your treatment. The booking guarantee
                        will only charge €10 for no-shows or late cancellations.
                      </p>
                      <p className="small">
                        Demo only: cards and charges are simulated. Do not enter
                        real card details. The late-cancellation deadline is
                        still to be confirmed by the salon.
                      </p>
                      <label>
                        Card for your guarantee
                        <select
                          value={card}
                          onChange={(e) => {
                            setCard(e.target.value);
                            setConsent(false);
                          }}
                        >
                          <option value="">Select a card option</option>
                          <option value="saved_demo">
                            Saved demo card · Visa •••• 4242
                          </option>
                          <option value="new_demo">
                            Supply a new demo card
                          </option>
                        </select>
                      </label>
                      {card === "new_demo" && (
                        <div>
                          <label>
                            Demo cardholder name
                            <input value={name} readOnly />
                          </label>
                          <label>
                            Example card number
                            <input value="4242 4242 4242 4242" readOnly />
                          </label>
                          <p className="small">
                            Example expiry 12/30 · example security code 123. A
                            real card form will use the payment provider’s
                            secure fields.
                          </p>
                        </div>
                      )}
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        I agree to the €10 no-show / late-cancellation guarantee
                        and understand this booking is simulated.
                      </label>
                    </div>
                  )}
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      (amending ? !changeReason.trim() : !consent || !card) ||
                      !name.trim() ||
                      (live && (!session || !phone.trim()))
                    }
                    onClick={book}
                  >
                    {busy
                      ? "Saving…"
                      : amending
                        ? "Save appointment changes"
                        : "Confirm appointment"}
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
                <p className="eyebrow">
                  {amending ? "APPOINTMENT UPDATED" : "YOU’RE ALL BOOKED"}
                </p>
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
                    if (staffClient) {
                      staffHome();
                      return;
                    }
                    setView("my-bookings");
                    setStep(1);
                  }}
                >
                  {staffClient ? "Back to staff home" : "View my appointments"}
                </button>
                <button
                  className="back"
                  onClick={() => {
                    if (staffClient) {
                      staffHome();
                      return;
                    }
                    setStep(1);
                    setConfirmation(null);
                    setStep(0);
                    setPeriod("");
                    setCard("");
                    setConsent(false);
                  }}
                >
                  {staffClient
                    ? "Book another appointment"
                    : "Book another treatment"}
                </button>
              </section>
            ) : null}
          </>
        ) : view === "login" || view === "recovery" ? (
          staffPortal && view !== "recovery" ? (
            <section className="staff-login">
              <p className="eyebrow">SCULPTED · STAFF PORTAL</p>
              <h1>Who’s working today?</h1>
              <p>
                Choose your profile.{" "}
                {live
                  ? "Use your individual account to sign in."
                  : "Local PIN preview only · demo PIN 1234"}
              </p>
              {loginTile === null ? (
                <div className="workspace-grid">
                  {staff.map((s) => (
                    <button
                      className="panel staff-tile"
                      key={s.id}
                      onClick={() => {
                        setLoginTile(s.id);
                        setPin("");
                        setError("");
                      }}
                    >
                      <span className="avatar">{s.name[0]}</span>
                      <h2>{s.name}</h2>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <button
                    className="back"
                    onClick={() => {
                      setLoginTile(null);
                      setPin("");
                    }}
                  >
                    ← Choose a different profile
                  </button>
                  <h2>{staff.find((s) => s.id === loginTile)?.name}</h2>
                  {live && db ? (
                    <AuthPanel db={db} staffMode onComplete={() => {}} />
                  ) : (
                    <form
                      className="panel login"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (pin !== "1234") {
                          setError(
                            "Use demo PIN 1234. This is not a real staff login.",
                          );
                          setPin("");
                          return;
                        }
                        setLocalStaffId(loginTile);
                        setLocalRole("staff");
                        setView("staff-workspace");
                        setPin("");
                        setDate(today());
                      }}
                    >
                      <label>
                        4-digit demo PIN
                        <input
                          type="password"
                          inputMode="numeric"
                          pattern="[0-9]{4}"
                          maxLength={4}
                          value={pin}
                          onChange={(e) =>
                            setPin(e.target.value.replace(/\D/g, ""))
                          }
                          required
                          autoComplete="off"
                        />
                      </label>
                      <button className="primary">Open demo workspace</button>
                      <p className="small">
                        This previews fast profile switching using fictional
                        local data. Connected mode requires full authentication;
                        a trusted-device PIN service is a later step.
                      </p>
                    </form>
                  )}
                </>
              )}
            </section>
          ) : live && db ? (
            <AuthPanel
              db={db}
              recovery={view === "recovery"}
              onComplete={() => {
                if (view === "recovery") setView("login");
              }}
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
                      if (r === "staff") setLocalStaffId(1);
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
                startBooking();
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
                onClick={() => {
                  setDate(today());
                  setView("diary");
                }}
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
                <button
                  aria-label="Previous day"
                  onClick={() => setDate(shiftDate(date, -1))}
                >
                  ←
                </button>
                <button onClick={() => setDate(today())}>Today</button>
                <button
                  aria-label="Next day"
                  onClick={() => setDate(shiftDate(date, 1))}
                >
                  →
                </button>
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
            <div className={`metrics ${reportAccess ? "" : "staff-metrics"}`}>
              <div>
                <span>
                  {activeRole === "accountant"
                    ? "Completed records"
                    : date === today()
                      ? "Appointments scheduled for today"
                      : "Appointments scheduled for this day"}
                </span>
                <strong>
                  {
                    dayAppointments.filter((a) => a.status !== "cancelled")
                      .length
                  }
                </strong>
              </div>
              <div>
                <span>
                  {date === today()
                    ? "Appointments completed so far today"
                    : "Appointments completed on this day"}
                </span>
                <strong>{completed.length}</strong>
              </div>
              {reportAccess && (
                <div>
                  <span>Recorded takings</span>
                  <strong>
                    {money(completed.reduce((s, a) => s + a.price, 0))}
                  </strong>
                </div>
              )}
            </div>
            {view === "diary" ? (
              <>
                <div className="legend">
                  <span>● Booked</span>
                  <span>● Checked in</span>
                  <span>● Completed</span>
                  <span className="no-show-label">● No-show</span>
                  <span>▧ Break / unavailable</span>
                  <button
                    className="secondary"
                    disabled={!ownStaffId}
                    onClick={() => openBreak()}
                  >
                    Add break time
                  </button>
                </div>
                <div className="diary-scroll">
                  <div
                    className="diary"
                    style={{
                      gridTemplateColumns: `85px repeat(${staff.length}, minmax(200px, 1fr))`,
                    }}
                  >
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
                            <>
                              {breaks
                                .filter((b) => b.staff_id === s.id)
                                .map((b, i) => (
                                  <button
                                    key={b.id || `lunch-${s.id}-${i}`}
                                    className="break-block"
                                    disabled={b.staff_id !== ownStaffId}
                                    onClick={() => openBreak(b)}
                                    style={{
                                      top: (b.start_minute - 540) * 1.6,
                                      height: Math.max(b.duration * 1.6, 24),
                                    }}
                                  >
                                    {b.kind === "lunch" ? "Lunch" : "Break"} ·{" "}
                                    {time(b.start_minute)}–
                                    {time(b.start_minute + b.duration)}
                                  </button>
                                ))}
                            </>
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
                                onClick={() => {
                                  setSelected(a);
                                  setStatusAction("");
                                  setStatusReason("");
                                }}
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
        SCULPTED BY AOIFE CLAIRE <a href="?portal=staff">Staff portal</a>{" "}
        <span>Salon system · Proof of concept</span>
      </footer>
      {breakDraft && staffAccess && (
        <div className="modal-backdrop">
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Personal break"
          >
            <button
              className="close"
              aria-label="Close break"
              onClick={() => setBreakDraft(null)}
            >
              ×
            </button>
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
            <h2>
              {breakDraft.kind === "lunch" ? "Your lunch" : "Add break time"}
            </h2>
            <p>
              {actorName} · {date}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveBreak();
              }}
            >
              <label>
                Start
                <input
                  required
                  type="time"
                  value={breakStart}
                  onChange={(e) => setBreakStart(e.target.value)}
                />
              </label>
              <label>
                End
                <input
                  required
                  type="time"
                  value={breakEnd}
                  onChange={(e) => setBreakEnd(e.target.value)}
                />
              </label>
              <p className="small">
                Changes affect this date only and are recorded. Breaks cannot
                overlap appointments or other breaks.
              </p>
              <button className="primary" disabled={busy}>
                Save break time
              </button>
            </form>
          </section>
        </div>
      )}
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
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
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
            <p>
              {selected.attendee_email || ""} · {selected.phone || ""}
            </p>
            <button
              className="back"
              onClick={() => {
                setInitialStaffAppointment(selected);
                setSelected(null);
                setView("staff-workspace");
              }}
            >
              Open client record →
            </button>
            <hr />
            {["booked", "checked_in"].includes(selected.status) && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void amendFromDiary(selected)}
              >
                Amend appointment
              </button>
            )}
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
            {["booked", "checked_in"].includes(selected.status) && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  setStatusAction("cancelled");
                  setStatusReason("");
                }}
              >
                Cancel appointment
              </button>
            )}
            {selected.status === "booked" && (
              <button
                className="danger"
                disabled={
                  busy ||
                  selected.appointment_date > today() ||
                  (selected.appointment_date === today() &&
                    selected.start_minute >
                      Number(
                        new Intl.DateTimeFormat("en-GB", {
                          timeZone: "Europe/Dublin",
                          hour: "2-digit",
                          hourCycle: "h23",
                        }).format(new Date()),
                      ) *
                        60 +
                        Number(
                          new Intl.DateTimeFormat("en-GB", {
                            timeZone: "Europe/Dublin",
                            minute: "2-digit",
                          }).format(new Date()),
                        ))
                }
                onClick={() => {
                  setStatusAction("no_show");
                  setStatusReason("");
                }}
              >
                Mark as no-show
              </button>
            )}
            {statusAction && (
              <div className="guarantee">
                <h3>
                  {statusAction === "no_show"
                    ? "Record a no-show"
                    : "Confirm cancellation"}
                </h3>
                <label>
                  Reason
                  <textarea
                    required
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                  />
                </label>
                <p className="small">
                  This action is audited. No guarantee charge will be taken in
                  this iteration.
                </p>
                <button
                  className="danger"
                  disabled={busy || !statusReason.trim()}
                  onClick={() => void changeStatus(statusAction)}
                >
                  Confirm{" "}
                  {statusAction === "no_show" ? "no-show" : "cancellation"}
                </button>
                <button className="back" onClick={() => setStatusAction("")}>
                  Keep appointment
                </button>
              </div>
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
  onContinue,
}: {
  treatment: Treatment;
  slot: Slot | null;
  date: string;
  staff: Staff[];
  onContinue?: () => void;
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
      {onContinue && (
        <button className="primary" disabled={!slot} onClick={onContinue}>
          Continue →
        </button>
      )}
      <p className="small">
        A little care. A little confidence.
        <br />A moment just for you.
      </p>
    </aside>
  );
}
