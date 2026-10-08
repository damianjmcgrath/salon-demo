import { displayDate } from "./dateFormats";
import BookingValueOptions, { type BookingValueChoice } from "./BookingValueOptions";
import {diaryEntryLayout} from "./diaryLayout.js";
import {useCalendarEntries} from "./CalendarEntries";
import { lastBookedLabel } from "./bookingRecency.js";
import AppointmentReminder from "./AppointmentReminder";
import PermissionManagement from "./PermissionManagement";
import TreatmentManagement from "./TreatmentManagement";
import { defaultPermissions, type Permissions } from "./permissions";
import MyVouchers from "./MyVouchers";
import ClientProfile from "./ClientProfile";
import BookingGuarantee from "./BookingGuarantee";
import AppointmentCheckout, { CheckoutHistory } from "./AppointmentCheckout";
import VoucherPurchase from "./VoucherPurchase";
import { localClient } from "./clientModel";
import StaffAdministration from "./StaffAdministration";
import { seedStaffRecords, localShift } from "./staffAdminModel";
import ClockControls from "./ClockControls";
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
type Role = "client" | "staff" | "admin" | "accountant";
import {
  availableSlots,
  startInterval,
  periodSlots,
  attendedTreatmentIds,
} from "./availability.js";
type Treatment = (typeof catalog)[number] & {
  description?: string;
  revision?: number;
  active?: boolean;
  guarantee_required?: boolean;
};
import StaffWorkspace from "./StaffWorkspace";
import Reporting from "./Reporting";
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
const accountantPortal =
  new URLSearchParams(window.location.search).get("portal") === "accountant";
const privatePortal = staffPortal || accountantPortal;
type Slot = { staff_id: number; start_minute: number };
const env = (import.meta as unknown as { env: Record<string, string> }).env;
const db =
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY
    ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          storageKey: accountantPortal
            ? "sculpted-accountant-session"
            : staffPortal
              ? "sculpted-staff-session"
              : "sculpted-client-session",
          storage: privatePortal ? sessionStorage : localStorage,
        },
      })
    : null;
const offlineTest = env.MODE === "test";
const initialStaff: Staff[] = [
  { id: 1, name: "Aoife" },
  { id: 2, name: "Leah" },
];
const fallbackProfiles = [
  { id: 1, name: "Aoife", role: "admin" as Role, staffId: 1 },
  { id: 2, name: "Leah", role: "staff" as Role, staffId: 2 },
  { id: 3, name: "Jacqui", role: "accountant" as Role, staffId: null },
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
    staff_id: 2,
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
  const [live] = useState(!offlineTest),
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileDiaryStaff, setMobileDiaryStaff] = useState<number | null>(null);
  const [loginTile, setLoginTile] = useState<number | null>(null),
    [pin, setPin] = useState("");
  const [ownClient, setOwnClient] = useState<Client | null>(null);
  const [staffClient, setStaffClient] = useState<Client | null>(null),
    [amending, setAmending] = useState<Appointment | null>(null),
    [changeReason, setChangeReason] = useState("");
  const [initialPatchRecord, setInitialPatchRecord] = useState(false);
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
  const [portalProfiles, setPortalProfiles] = useState<
    {
      id: number;
      name: string;
      role: Role;
      staffId: number | null;
      photo_url?: string | null;
      profile_key?: string;
    }[]
  >(fallbackProfiles);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [staffSkills, setStaffSkills] = useState<
    { staff_id: number; treatment_id: number }[]
  >([]);
  const records =
    staffData.staffRecords || seedStaffRecords(treatments.map((t) => t.id));
  const profiles = live
    ? portalProfiles
    : [
        ...records
          .filter((r) => r.active !== false)
          .map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role as Role,
            staffId: r.id,
            photo_url: r.photo_url,
            profile_key: r.profile_key,
          })),
        {
          id: -1,
          name: "Jacqui",
          role: "accountant" as Role,
          staffId: null,
          photo_url: null,
          profile_key: "jacqui",
        },
      ];
  useEffect(() => {
    if (!live)
      setStaff(
        records
          .filter((r) => r.active !== false)
          .map((r) => ({ id: r.id, name: r.name, photo_url: r.photo_url })),
      );
  }, [live, staffData.staffRecords]);
  const [bookingHistoryLoaded, setBookingHistoryLoaded] = useState(!live);
  const defaultPrevious = useRef(false);
  const [remoteBreaks, setRemoteBreaks] = useState<DiaryBreak[]>([]),
    [breakDraft, setBreakDraft] = useState<DiaryBreak | null>(null),
    [breakStart, setBreakStart] = useState("13:00"),
    [breakEnd, setBreakEnd] = useState("13:30");
  const [statusAction, setStatusAction] = useState(""),
    [statusReason, setStatusReason] = useState("");
  const confirmationSection = useRef<HTMLElement>(null);
  const statusSection = useRef<HTMLDivElement>(null);
  const statusComments = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!statusAction) return;
    statusComments.current?.focus({ preventScroll: true });
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    statusSection.current?.scrollIntoView?.({
      behavior: reducedMotion ? "instant" : "smooth",
      block: "start",
    });
  }, [statusAction]);

  const [requiresPasswordChange, setRequiresPasswordChange] = useState(false),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  const requestVersion = useRef(0);
  const identityVersion = useRef(0);
  const authUser = useRef<string | null>(null);
  const activeRole = live ? role : localRole;
  const staffAccess = ["staff", "admin"].includes(activeRole || "");
  const [permissionGrants, setPermissionGrants] = useState<Permissions>({});
  const [permissionVersion, setPermissionVersion] = useState(0);
  const permissions = live
    ? permissionGrants
    : defaultPermissions(activeRole || "");
  const allowed = (key: string) => !!permissions[key];
  useEffect(() => {
    setPermissionGrants({});
  }, [session?.user.id, activeRole]);
  useEffect(() => {
    let active = true;
    if (live && db && session && activeRole && activeRole !== "client") {
      const load = () =>
        db!.rpc("get_my_permissions").then(({ data, error }) => {
          if (!active) return;
          if (error) {
            setPermissionGrants({});
            setError(error.message);
          } else setPermissionGrants(data ?? {});
        });
      void load();
      const onFocus = () => {
        void load();
      };
      window.addEventListener("focus", onFocus);
      const timer = window.setInterval(onFocus, 30000);
      return () => {
        active = false;
        window.removeEventListener("focus", onFocus);
        window.clearInterval(timer);
      };
    }
    return () => {
      active = false;
    };
  }, [live, session?.user.id, activeRole, permissionVersion]);

  const [sandboxNoShowTesting, setSandboxNoShowTesting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSandboxNoShowTesting(false);
    if (live && db && staffAccess)
      void db.rpc("sandbox_no_show_testing_enabled").then(({ data }) => {
        if (!cancelled) setSandboxNoShowTesting(data === true);
      });
    return () => {
      cancelled = true;
    };
  }, [live, staffAccess, session?.user.id]);
  const reportAccess = allowed("view.reporting");
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
  type PatchPlan = {
    requested_treatment_id: number;
    requested_treatment_name: string;
    patch_needed: boolean;
    patch_for_treatment_id: number | null;
    earliest_treatment_at: string | null;
    treatment: Treatment;
  };
  const [patchPlan, setPatchPlan] = useState<PatchPlan | null>(null);
  const [patchChecking, setPatchChecking] = useState(false);
  const patchSelection = useRef(0);

  const [prepayment, setPrepayment] = useState<BookingValueChoice | null>(null);
  const [guaranteeNeeded, setGuaranteeNeeded] = useState<boolean | null>(null);
  const [guaranteeError, setGuaranteeError] = useState("");

  const [email, setEmail] = useState("");
  const [period, setPeriod] = useState("");
  const [card, setCard] = useState("");
  function startBooking() {
    setStep(0);
    setView("book");
    setTreatment(null);
    setPatchPlan(null);
    patchSelection.current++;
    setPatchChecking(false);
    setSlot(null);
    setPeriod("");
    setCategory("All treatments");
    setConsent(false);
    setCard("");
  }
  function chooseRecipient(self: boolean) {
    patchSelection.current++;
    setPatchPlan(null);
    setPatchChecking(false);
    setTreatment(null);
    setSlot(null);
    setPeriod("");
    setCard("");
    setConsent(false);
    setError("");
    setForSelf(self);
    defaultPrevious.current = self;
    setCategory(
      self &&
        attendedTreatmentIds(
          live ? myBookings : local.filter((a) => a.user_id === "local-client"),
        ).length
        ? "Previous Bookings"
        : "All treatments",
    );
    setSearch("");
    const profile = live ? ownClient : localClient(staffData);
    setName(
      self
        ? profile?.name ||
            session?.user.user_metadata.full_name ||
            (live ? "" : "Demo Client")
        : "",
    );
    setPhone(
      self
        ? profile?.phone ||
            session?.user.user_metadata.mobile ||
            (live ? "" : "0800000000")
        : "",
    );
    setEmail(self ? session?.user.email || "client@example.com" : "");
    setStep(
      self &&
        (!live ||
          ((profile?.name || session?.user.user_metadata.full_name) &&
            (profile?.phone || session?.user.user_metadata.mobile)))
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
  const [feeInfo, setFeeInfo] = useState<{
    state: string;
    comments?: string;
    error?: string;
    provider_state?: string | null;
    status_error?: string | null;
  } | null>(null);
  const [feeChecking, setFeeChecking] = useState(false);
  const [feeCheckMessage, setFeeCheckMessage] = useState("");
  async function feeCall(action: string, id: string) {
    if (!db) throw new Error("Supabase connection required.");
    const { data, error } = await db.functions.invoke("booking-guarantee", {
      body: { action, appointment_id: id },
    });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    if (data.error) throw new Error(data.error);
    return data;
  }
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setFeeInfo(null);
    setFeeChecking(false);
    setFeeCheckMessage("");
    if (live && selected?.status === "no_show") {
      const id = selected.id;
      let checks = 0;
      async function check() {
        if (cancelled) return;
        setFeeChecking(true);
        try {
          const data = await feeCall("fee_status", id);
          if (cancelled) return;
          setFeeInfo(data);
          checks++;
          if (["pending", "processing"].includes(data.state) && checks < 8) {
            setFeeCheckMessage(
              "Waiting for Revolut to confirm the payment. Checking automatically…",
            );
            timer = setTimeout(() => void check(), 2000);
          } else {
            setFeeChecking(false);
            setFeeCheckMessage(
              ["pending", "processing"].includes(data.state)
                ? "Payment is still awaiting confirmation. It has not been recorded as paid. You can check again or inspect it in Revolut Merchant."
                : "",
            );
          }
        } catch (e) {
          if (cancelled) return;
          setFeeChecking(false);
          setFeeCheckMessage(
            "Unable to check the payment: " + (e as Error).message,
          );
        }
      }
      void check();
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selected?.id, selected?.status, live]);
  async function recordNoShow(applyFee: boolean) {
    if (!selected || busy || !statusReason.trim()) return;
    if (!live) {
      await changeStatus("no_show");
      return;
    }
    const appointment = selected;
    const operation = identityVersion.current;
    setBusy(true);
    setError("");
    try {
      if (!db) throw new Error("Supabase connection required.");
      const { error } = await db.rpc("record_no_show_decision", {
        p_id: appointment.id,
        p_revision: appointment.revision || 0,
        p_apply_fee: applyFee,
        p_comments: statusReason,
      });
      if (error) throw error;
      if (operation !== identityVersion.current) return;
      setStatusAction("");
      setStatusReason("");
      setFeeInfo({ state: applyFee ? "pending" : "waived" });
      try {
        const result = await feeCall(
          applyFee ? "charge" : "fee_status",
          appointment.id,
        );
        if (operation !== identityVersion.current) return;
        setFeeInfo(result);
      } catch (e) {
        if (operation !== identityVersion.current) return;
        setFeeInfo({
          state: applyFee ? "pending" : "waived",
          error:
            "No-show recorded. Payment result unavailable; check its status. " +
            (e as Error).message,
        });
      }
      setSelected({
        ...appointment,
        status: "no_show",
        revision: (appointment.revision || 0) + 1,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const breaks: DiaryBreak[] = live
    ? remoteBreaks
    : effectiveBreaks(
        staff.map((s) => s.id),
        date,
        staffData.breaks,
      );
  const ownStaffId = live ? staffId : localStaffId;
  useEffect(() => {setMobileDiaryStaff(null);}, [ownStaffId]);
  const calendar = useCalendarEntries(live && allowed("view.diary") ? db : null,date,staff,ownStaffId,activeRole === "admin");
  const mobileDiaryId = staff.some(s=>s.id===mobileDiaryStaff) ? mobileDiaryStaff : staff.some(s=>s.id===ownStaffId) ? ownStaffId : staff[0]?.id;
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
  const [workspaceScreen, setWorkspaceScreen] = useState("home");
  const [workspaceNavigation, setWorkspaceNavigation] = useState(0);
  function staffHome(screen = "home") {
    setInitialPatchRecord(false);
    setWorkspaceScreen(screen);
    setWorkspaceNavigation((n) => n + 1);
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
    setPatchPlan(null);
    patchSelection.current++;
    setPatchChecking(false);
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
      staff_id:
        (activeRole === "admin" && !allowed("perform.own_breaks")
          ? staff.find((s) => s.id !== ownStaffId)?.id
          : ownStaffId) ||
        (activeRole === "admin" ? staff[0]?.id : 0) ||
        0,
      kind: "break",
      start_minute: 840,
      duration: 15,
      revision: 0,
    };
    if (activeRole !== "admin" && draft.staff_id !== ownStaffId) {
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
        const r = await db.rpc(
          activeRole === "admin"
            ? "admin_save_staff_break"
            : "save_staff_break",
          {
            ...(activeRole === "admin"
              ? { p_staff_id: breakDraft.staff_id }
              : {}),
            p_date: date,
            p_start: start,
            p_end: end,
            p_kind: breakDraft.kind,
            p_id: breakDraft.id,
            p_revision: breakDraft.revision,
          },
        );
        if (r.error) throw r.error;
        if (operation !== identityVersion.current) return;
        await refresh();
      } else {
        validateBreak({
          staffId: breakDraft.staff_id,
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
      const [ts, ss, ps, sk] = await Promise.all([
        db.from("treatments").select("*").order("id"),
        db.from("staff").select("*").eq("active", true).order("id"),
        db
          .from("portal_profiles")
          .select("*")
          .eq("active", true)
          .order("display_name"),
        db.from("staff_treatments").select("*"),
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
      if (!ps.error)
        setPortalProfiles(
          (ps.data || []).map((p) => ({
            id: p.staff_id ?? -1,
            name: p.display_name,
            role: p.role,
            staffId: p.staff_id,
            profile_key: p.profile_key,
            photo_url: p.photo_url,
          })),
        );
      if (!sk.error) setStaffSkills(sk.data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [live, catalogVersion, session?.user.id]);
  async function refresh() {
    if (!live || !db || !session || roleLoading) return;
    const version = ++requestVersion.current;
    const result =
      activeRole === "accountant"
        ? await db.rpc("get_daily_report", { p_date: date })
        : staffAccess &&
            (allowed("view.diary") ||
              allowed("view.appointments") ||
              allowed("view.clients"))
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
    if (staffAccess && allowed("view.diary")) {
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
      .select("*")
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
        const next = data
          ? data.active === false
            ? null
            : normalizeRole(data.role)
          : "client";
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
    if (live && activeRole !== "client" && Object.keys(permissionGrants).length === 0) return;
    if (view === "login" || !canAccess(activeRole, view, permissions))
      setView(staffAccess && allowed("view.diary") ? "diary" : roleHome(activeRole));
  }, [activeRole, roleLoading, view, permissions, live, permissionGrants]);
  useEffect(() => {
    void refresh();
  }, [live, session?.user.id, date, activeRole, roleLoading, permissionGrants]);
  useEffect(() => {
    if (!live || !db || !session || activeRole !== "client") {
      setMyBookings([]);
      return;
    }
    let cancelled = false;
    setBookingHistoryLoaded(false);
    db.rpc("get_my_appointments").then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(error.message);
      else {
        setMyBookings(
          (data || []).map((a: Appointment) =>
            a.user_id !== session.user.id ? { ...a, booked_for_self: true } : a,
          ),
        );
        setBookingHistoryLoaded(true);
      }
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
  const pinLoginInFlight = useRef(false);
  async function loginWithPin(enteredPin = pin) {
    if (!db || pinLoginInFlight.current || !/^[0-9]{4}$/.test(enteredPin))
      return;
    pinLoginInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const selected = profiles.find((p) => p.id === loginTile);
      if (!selected?.profile_key)
        throw Error("Reload the profiles and try again.");
      const r = await db.functions.invoke("staff-pin-login", {
        body: { profile: selected.profile_key, pin: enteredPin },
      });
      if (r.error)
        throw Error(
          "PIN login unavailable or incorrect PIN. Check that the PIN function is deployed and enabled.",
        );
      if (r.data?.error) throw Error(r.data.error);
      const login = await db.auth.setSession(r.data.session);
      if (login.error) throw login.error;
      setPin("");
    } catch (e) {
      setError((e as Error).message);
      setPin("");
    } finally {
      pinLoginInFlight.current = false;
      setBusy(false);
    }
  }
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
    setPatchPlan(null);
    patchSelection.current++;
    setPatchChecking(false);
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
      db.rpc(
        patchPlan && activeRole === "client"
          ? forSelf
            ? "get_self_booking_slots"
            : "get_proxy_booking_slots"
          : amending
            ? "get_booking_slots"
            : "get_available_slots",
        {
          ...(patchPlan && activeRole === "client"
            ? {
                p_requested_treatment: patchPlan.requested_treatment_id,
                ...(!forSelf ? { p_attendee_email: email.trim() } : {}),
              }
            : { p_treatment_id: treatment.id }),
          p_date: date,
          p_staff_id: staffChoice || null,
          ...(amending ? { p_exclude_id: amending.id } : {}),
        },
      ).then(({ data, error }) => {
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
        sunday &&
          !(staffData.dayShifts || []).some(
            (s) => s.shift_date === date && s.start_minute !== null,
          )
          ? []
          : availableSlots(
              treatment.duration,
              staff
                .filter(
                  (s) =>
                    (!staffChoice || s.id === staffChoice) &&
                    records
                      .find((r) => r.id === s.id)
                      ?.treatment_ids?.includes(treatment.id),
                )
                .map((s) => s.id),
              local.filter(
                (a) => a.appointment_date === date && a.id !== amending?.id,
              ),
              breaks,
              undefined,
              staff.map((s) =>
                localShift(records, staffData.dayShifts || [], s.id, date),
              ),
            ).filter((slot) => {
              const shift = localShift(
                records,
                staffData.dayShifts || [],
                slot.staff_id,
                date,
              );
              return (
                shift.start_minute !== null &&
                slot.start_minute >= shift.start_minute &&
                slot.start_minute + treatment.duration <= shift.end_minute!
              );
            }),
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
    staffData.staffRecords,
    staffData.dayShifts,
    remoteBreaks,
    amending?.id,
    patchPlan,
    email,
    forSelf,
    activeRole,
  ]);
  useEffect(() => {
    let active = true;
    setGuaranteeNeeded(null);
    setPrepayment(null);
    setGuaranteeError("");
    if (step !== 3 || amending) return;
    if (!live) {
      setGuaranteeNeeded(true);
      return;
    }
    if (!db || !session) return;
    void db
      .rpc("booking_requires_guarantee", {
        p_attendee_email: forSelf ? null : email.trim(),
        p_client_id: staffClient?.id ?? null,
        p_treatment_id: treatment?.id ?? null,
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setGuaranteeError(error.message);
        else setGuaranteeNeeded(data === true);
      });
    return () => {
      active = false;
    };
  }, [
    step,
    amending?.id,
    live,
    session?.user.id,
    staffClient?.id,
    treatment?.id,
    forSelf,
    email,
  ]);
  async function chooseTreatment(t: Treatment, self = forSelf) {
    const selection = ++patchSelection.current;
    const identity = identityVersion.current;
    setPatchPlan(null);
    setSlot(null);
    setPeriod("");
    setCard("");
    setConsent(false);
    setStaffChoice(0);
    setError("");
    if (live && db && activeRole === "client") {
      setPatchChecking(true);
      try {
        const r = await db.rpc(
          self ? "get_self_booking_plan" : "get_proxy_booking_plan",
          {
            p_requested_treatment: t.id,
            ...(!self ? { p_attendee_email: email.trim() } : {}),
          },
        );
        if (r.error) throw r.error;
        if (
          selection !== patchSelection.current ||
          identity !== identityVersion.current
        )
          return;
        const plan = r.data as PatchPlan;
        setPatchPlan(plan);
        setTreatment(plan.treatment);
        if (plan.earliest_treatment_at) {
          const earliestDay = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Dublin",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(plan.earliest_treatment_at));
          if (earliestDay > today()) setDate(earliestDay);
        }
        setStep(2);
      } catch (e) {
        if (
          selection === patchSelection.current &&
          identity === identityVersion.current
        )
          setError((e as Error).message);
      } finally {
        if (
          selection === patchSelection.current &&
          identity === identityVersion.current
        )
          setPatchChecking(false);
      }
    } else {
      setTreatment(
        amending?.patch_for_treatment_id && amending.treatment_id === t.id
          ? { ...t, name: amending.treatment_name }
          : t,
      );
      setStep(2);
    }
  }
  const eligibleStaff = staff.filter(
    (s) =>
      !treatment ||
      (live
        ? staffSkills.some(
            (k) => k.staff_id === s.id && k.treatment_id === treatment.id,
          ) &&
          (!patchPlan?.patch_needed ||
            staffSkills.some(
              (k) =>
                k.staff_id === s.id &&
                k.treatment_id === patchPlan.requested_treatment_id,
            ))
        : records
            .find((r) => r.id === s.id)
            ?.treatment_ids?.includes(treatment.id)),
  );
  async function book() {
    if (
      !treatment ||
      !slot ||
      (!amending &&
        (guaranteeNeeded === null ||
          (prepayment ? !prepayment.id : guaranteeNeeded && (!consent || !card)))) ||
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
          : await db.rpc(prepayment ? "book_with_value" : "book_guaranteed_appointment", {
              ...(prepayment ? {p_value_method: prepayment.method, p_value_id: prepayment.id} : {}),
              p_treatment_id: treatment.id,
              p_staff_id: slot.staff_id,
              p_date: date,
              p_start: slot.start_minute,
              p_client_name: name.trim(),
              p_phone: phone.trim(),
              p_consent: consent,
              p_booked_for_self: forSelf,
              p_attendee_email: email.trim(),
              p_guarantee_id: guaranteeNeeded ? card : null,
              p_client_id: staffClient?.id || null,
              p_patch_for_treatment_id:
                patchPlan?.patch_for_treatment_id ?? null,
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
          undefined,
          [localShift(records, staffData.dayShifts || [], slot.staff_id, date)],
        ).some((s) => s.start_minute === slot.start_minute);
        if (
          !valid ||
          !records
            .find((r) => r.id === slot.staff_id && r.active !== false)
            ?.treatment_ids?.includes(treatment.id)
        )
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
  async function cancelCheckIn() {
    if (!selected || busy) return;
    const appointment = selected, operation = identityVersion.current;
    setBusy(true); setError("");
    try {
      if (live && db) {
        const result = await db.rpc("cancel_appointment_check_in", { p_id: appointment.id, p_revision: appointment.revision || 0 });
        if (result.error) throw result.error;
        if (operation !== identityVersion.current) return;
        await refresh();
        if (operation !== identityVersion.current) return;
        setSelected(result.data);
      } else {
        const restored = { ...appointment, status: "booked", checked_in_at: null, revision: (appointment.revision || 0) + 1 };
        auditLocal("appointment_check_in_cancelled", appointment, { before: "checked_in", after: "booked" });
        setLocal(prev => prev.map(a => a.id === appointment.id ? restored : a));
        setSelected(restored);
      }
      setStatusAction(""); setStatusReason("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
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
  useEffect(() => {
    if (
      defaultPrevious.current &&
      forSelf &&
      !staffClient &&
      step === 1 &&
      (!live || bookingHistoryLoaded)
    ) {
      setCategory(previousIds.length ? "Previous Bookings" : "All treatments");
      defaultPrevious.current = false;
    }
  }, [step, forSelf, staffClient, live, bookingHistoryLoaded, myBookings]);
  useEffect(() => {
    if (view !== "book" || step !== 4 || !confirmation) return;
    const frame = window.setTimeout(() => {
      confirmationSection.current?.scrollIntoView?.({ behavior: "instant", block: "start" });
    });
    return () => window.clearTimeout(frame);
  }, [view, step, confirmation]);
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
  const diaryStart = Math.min(
    480,
    ...dayAppointments.map((a) => Math.floor(a.start_minute / 60) * 60),
    ...calendar.entries.map(e=>Math.floor(e.start_minute/60)*60),
  );
  const diaryEnd = Math.max(
    1080,
    ...calendar.entries.map(e=>Math.ceil((e.start_minute+e.duration)/60)*60),
    ...dayAppointments.map(
      (a) => Math.ceil((a.start_minute + a.duration) / 60) * 60,
    ),
  );
  const diaryHeight = (diaryEnd - diaryStart) * 1.6;
  const diaryLanes = Object.assign({},...staff.map(s=>diaryEntryLayout([...dayAppointments.filter(a=>a.status!=="cancelled"&&a.staff_id===s.id),...calendar.entries.filter(e=>e.staff_id===s.id)].map(e=>({...e,id:`${e.staff_id}-${e.id}`})))));
  const laneStyle = (e: {staff_id:number;id?:string}) => {const lane=diaryLanes[`${e.staff_id}-${e.id}`];return lane ? {left:`calc(${lane.lane*lane.width}% + 4px)`,right:`calc(${100-(lane.lane+1)*lane.width}% + 4px)`} : {};};
  return (
    <>
      {calendar.dialog}
      <header className={activeRole === "client" || staffAccess || activeRole === "accountant" ? "client-header" : ""}>
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
          <img
            className="salon-logo"
            src={`${env.BASE_URL}images/salon-logo.png`}
            alt="Sculpted by Aoife Claire"
          />
        </a>
        {(activeRole === "client" || staffAccess || activeRole === "accountant") && (
          <button
            className="account-menu-toggle"
            aria-label={accountMenuOpen ? "Close" : "Menu"}
            aria-expanded={accountMenuOpen}
            aria-controls="account-navigation"
            onClick={() => setAccountMenuOpen(!accountMenuOpen)}
          >
            <span aria-hidden="true">{accountMenuOpen ? "✕" : "☰"}</span>{" "}
            {accountMenuOpen ? "Close" : "Menu"}
          </button>
        )}
        <nav
          id="account-navigation"
          className={accountMenuOpen ? "menu-open" : ""}
          onClick={() => setAccountMenuOpen(false)}
        >
          {activeRole === "client" && !privatePortal && (
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
          {activeRole === "client" && (
            <button
              className={view === "my-profile" ? "active" : ""}
              onClick={() => setView("my-profile")}
            >
              My Profile
            </button>
          )}
          {activeRole === "client" && <button className={view === "my-vouchers" ? "active" : ""} onClick={() => setView("my-vouchers")}>My Vouchers</button>}
          {staffAccess && (
            <button
              className={
                view === "staff-workspace" && workspaceScreen === "home"
                  ? "active"
                  : ""
              }
              onClick={() => staffHome()}
            >
              Staff Home
            </button>
          )}
          {staffAccess &&
            (["Appointments", "Clients"] as const)
              .filter((label) =>
                allowed(
                  label === "Appointments"
                    ? "view.appointments"
                    : "view.clients",
                ),
              )
              .map((label) => (
                <button
                  key={label}
                  className={
                    view === "staff-workspace" &&
                    workspaceScreen === label.toLowerCase()
                      ? "active"
                      : ""
                  }
                  onClick={() => staffHome(label.toLowerCase())}
                >
                  {label}
                </button>
              ))}
          {staffAccess && allowed("view.diary") && (
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
          {staffAccess && allowed("view.vouchers") && (
            <button
              className={
                view === "staff-workspace" && workspaceScreen === "vouchers"
                  ? "active"
                  : ""
              }
              onClick={() => staffHome("vouchers")}
            >
              Vouchers
            </button>
          )}
          {staffAccess && allowed("view.staff") && (
            <button
              className={view === "staff-admin" ? "active" : ""}
              onClick={() => setView("staff-admin")}
            >
              Staff Management
            </button>
          )}
          {staffAccess && allowed("view.treatments") && (
            <button onClick={() => setView("treatment-management")}>
              Treatment Management
            </button>
          )}
          {staffAccess && allowed("view.permissions") && (
            <button onClick={() => setView("permission-management")}>
              Permission Management
            </button>
          )}
          {reportAccess && (
            <button
              className={view === "reporting-placeholder" ? "active" : ""}
              onClick={() => setView("reporting-placeholder")}
            >
              Reports
            </button>
          )}
          <div className={activeRole === "client" || staffAccess ? "client-sign-in" : ""}>
            {staffAccess && <span>Signed in as {actorName.trim().split(/\s+/)[0]}</span>}
            {activeRole === "client" && (
              <span>
                Signed in as{" "}
                {(live
                  ? ownClient?.name ||
                    session?.user.user_metadata.full_name ||
                    session?.user.email
                  : localClient(staffData).name
                )
                  ?.trim()
                  .split(/\s+/)[0] || "you"}
              </span>
            )}
            <button
              className={staffAccess ? "logout-link" : ""}
              disabled={busy}
              onClick={() => {
                if (activeRole || session) void signOut();
                else setView("login");
              }}
            >
              {staffAccess
                ? "Log Out"
                : activeRole || session
                  ? activeRole === "client"
                    ? "Sign Out"
                    : "Sign out / lock"
                  : "Sign in"}
            </button>
          </div>
        </nav>
      </header>
      {error && !selected && !breakDraft && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <main
        className={
          activeRole === "client" && view === "book" && step === 0
            ? "recipient-main"
            : ""
        }
      >
        {staffAccess && !roleLoading && (
          <ClockControls
            key={`${live}-${session?.user.id || activeRole}-${catalogVersion}`}
            live={live}
            db={db}
            data={staffData}
            setData={setStaffData}
            userId={session?.user.id || `local-staff-${ownStaffId}`}
            staffId={ownStaffId}
            name={actorName}
          />
        )}
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
        ) : privatePortal &&
          activeRole &&
          (accountantPortal
            ? activeRole !== "accountant"
            : !["admin", "staff"].includes(activeRole)) ? (
          <section className="panel login">
            <h1>
              {accountantPortal
                ? "Accountant account required."
                : "Staff account required."}
            </h1>
            <p>
              This account cannot access this portal. Switch to the appropriate
              account or portal.
            </p>
            <button className="primary" onClick={() => void signOut()}>
              Switch account
            </button>
          </section>
        ) : view === "staff-workspace" && staffAccess ? (
          <StaffWorkspace
            key={`${live}-${session?.user.id || localStaffId}-${initialStaffAppointment?.id || "home"}-${workspaceNavigation}`}
            treatments={treatments}
            staff={staff}
            initialScreen={workspaceScreen}
            role={activeRole || "staff"}
            permissions={permissions}
            onTreatments={() => setView("treatment-management")}
            onPermissions={() => setView("permission-management")}
            onReporting={() => setView("reporting-placeholder")}
            onStaffAdmin={() => setView("staff-admin")}
            db={db}
            live={live}
            data={staffData}
            setData={setStaffData}
            appointments={local}
            actor={actorName}
            initialAppointment={initialStaffAppointment}
            initialPatchRecord={initialPatchRecord}
            onDiary={() => {
              setDate(today());
              setView("diary");
            }}
            onBook={beginStaffBooking}
            onCancel={cancelFromWorkspace}
          />
        ) : view === "my-profile" && activeRole === "client" ? (
          <ClientProfile
            key={`${live}-${session?.user.id || "local"}`}
            live={live}
            db={db}
            data={staffData}
            setData={setStaffData}
            onSaved={setOwnClient}
            onHome={startBooking}
            onBuy={() => setView("voucher-purchase")}
          />
        ) : view === "my-vouchers" && activeRole === "client" ? (
          <MyVouchers db={db} live={live} data={staffData} onBuy={() => setView("voucher-purchase")} />
        ) : view === "voucher-purchase" && activeRole === "client" ? (
          <VoucherPurchase
            key={`${live}-${session?.user.id || "local"}`}
            live={live}
            db={db}
            data={staffData}
            setData={setStaffData}
            treatments={treatments}
            client={ownClient}
            onHome={startBooking}
            onProfile={() => setView("my-profile")}
          />
        ) : view === "multiple-bookings" && activeRole === "client" ? (
          <section className="panel login">
            <button className="back" onClick={startBooking}>
              ← Booking home
            </button>
            <h1>You and Other People</h1>
            <p>Multiple bookings are coming soon.</p>
          </section>
        ) : view === "book" &&
          (activeRole === "client" || (staffAccess && staffClient)) ? (
          <>
            {step > 0 && (
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
                  {["Treatment", "Your time", "Guarantee", "Booked"].map(
                    (s, i) => (
                      <span key={s} className={step === i + 1 ? "current" : ""}>
                        {i + 1} {s}
                      </span>
                    ),
                  )}
                </div>
              </>
            )}
            {step === 0 ? (
              <section
                className="recipient-choice"
                aria-labelledby="recipient-title"
              >
                <p className="eyebrow">YOUR NEXT APPOINTMENT</p>
                <h1 id="recipient-title">Who are you booking for?</h1>
                <div className="recipient-options">
                  <button
                    className="primary"
                    onClick={() => chooseRecipient(true)}
                  >
                    Yourself
                  </button>
                  <button
                    className="secondary"
                    onClick={() => chooseRecipient(false)}
                  >
                    Someone Else
                  </button>

                  <button
                    className="secondary"
                    onClick={() => setView("voucher-purchase")}
                  >
                    Buy a Voucher
                  </button>
                </div>
                <p className="multiple-booking-guidance">
                  Want to make a booking for multiple people at the same time?
                  Phone our salon on <a href="tel:+353871815137">087 1815137</a>{" "}
                  or Email:{" "}
                  <a href="mailto:sculptedbyac@gmail.com">
                    sculptedbyac@gmail.com
                  </a>
                  , and our staff will be happy to assist.
                </p>
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
                {!forSelf && (
                  <div className="booking-recipient-guidance">
                    <p>
                      If the person you are booking for isn't an existing
                      client, and you are booking a treatment that requires a
                      Patch Test, please be aware that you will only be able to
                      book the Patch Test online. They can book their Treatment
                      in-salon after completing the Patch Test. If the Treatment
                      does not require a Patch Test, then you can book the
                      treatment session immediately.
                    </p>
                    <p>
                      If the person you are booking for is an existing client,
                      we will have their Patch Test records already and our
                      online booking system will advise accordingly on the next
                      screen.
                    </p>
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setStep(1);
                  }}
                >
                  <label>
                    {forSelf ? "Full name" : "Their Full Name"}
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    {forSelf ? "Email address" : "Their Email"}
                    <input
                      type="email"
                      required
                      value={email}
                      readOnly={forSelf}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label>
                    {forSelf ? "Phone number" : "Their Phone Number"}
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
                  <label className="mobile-treatment-categories">
                    Treatment category
                    <select value={category} onChange={(e)=>{defaultPrevious.current=false;setCategory(e.target.value);}}>
                      {categories.map(c=><option key={c} value={c}>{c} ({c === "Previous Bookings" ? previousIds.length : c === "All treatments" ? treatments.length : treatments.filter(t=>t.category===c).length})</option>)}
                    </select>
                  </label>
                  {categories.map((c) => (
                    <button
                      key={c}
                      className={`category-filter ${category === c ? "chosen" : ""}`}
                      onClick={() => {
                        defaultPrevious.current = false;
                        setCategory(c);
                      }}
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
                  {patchChecking && (
                    <p role="status">Checking patch test requirements…</p>
                  )}
                  <div className="treatment-grid">
                    {filtered.map((t) => (
                      <button
                        className="treatment"
                        key={t.id}
                        disabled={patchChecking}
                        onClick={() => void chooseTreatment(t)}
                      >
                        <span className="eyebrow">{t.category}</span>
                        <h3>{t.name}</h3>
                        <div>
                          <span className="treatment-duration">
                            {t.duration} minutes
                          </span>
                          <strong>
                            {t.price_type === "From" ? "From " : ""}
                            {money(t.price)}
                          </strong>
                        </div>
                        {t.description?.trim() && (
                          <p className="treatment-description">{t.description}</p>
                        )}
                        <span className="choose">
                          {forSelf && !staffClient && previousIds.includes(t.id)
                            ? "Rebook Treatment ↗"
                            : "Choose treatment ↗"}
                        </span>
                        {category === "Previous Bookings" && forSelf && !staffClient && (
                          <span className="last-booked">{lastBookedLabel(live ? myBookings : local.filter(a => a.user_id === "local-client"), t.id, today())}</span>
                        )}
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
                  {patchPlan?.patch_needed && (
                    <div
                      className="guarantee patch-booking-notice"
                      role="status"
                    >
                      <h3>
                        Patch Test for {patchPlan.requested_treatment_name}
                      </h3>
                      <p>
                        {forSelf
                          ? "Booking this treatment will require a patch test first. The Patch Test must be done at least 24 hours before the Treatment. You can book in your Patch Test online now, and when you visit the salon, the staff can book your treatment appointment for you."
                          : "A Patch Test is required, please select a time/date for that appointment. After your Patch Test, the salon staff can book your treatment session with you"}
                      </p>
                    </div>
                  )}
                  {patchPlan?.earliest_treatment_at &&
                    new Date(patchPlan.earliest_treatment_at).getTime() >
                      Date.now() && (
                      <p role="status">
                        Your patch test is recorded. Treatment appointments are
                        available from{" "}
                        {new Date(
                          patchPlan.earliest_treatment_at,
                        ).toLocaleString("en-IE", {
                          timeZone: "Europe/Dublin",
                        })}
                        , at least 24 hours after the test.
                      </p>
                    )}
                  <label>
                    Who would you like to see?
                    <select
                      value={staffChoice}
                      onChange={(e) => setStaffChoice(Number(e.target.value))}
                    >
                      <option value={0}>No preference — first available</option>
                      {eligibleStaff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Appointment date
                    <input
                      type="date" lang="en-GB"
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
                    <legend>Choose a time of day</legend>
                    {["morning", "afternoon", "evening"].map((p) => (
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
                          : p === "afternoon"
                            ? "Afternoon · 12:00–17:00"
                            : "Evening · 17:00–20:00"}
                      </button>
                    ))}
                  </fieldset>
                  {!period && (
                    <p className="small">
                      Choose morning, afternoon or evening to see available
                      times.
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
                      : guaranteeNeeded === false
                        ? "Confirm Appointment"
                        : "Booking Guarantee"}
                  </h2>
                  {!amending && guaranteeNeeded === true && !prepayment && (
                    <p>
                      Guarantee your booking using your saved card details, or
                      supply new card details.
                    </p>
                  )}
                  <p>
                    Booking for <strong>{name}</strong> · {email}
                  </p>
                  {!amending && live && db && activeRole === "client" && Number(treatment.price)>0 && <BookingValueOptions db={db} treatmentId={treatment.id} requiresGuarantee={guaranteeNeeded} choice={prepayment} onChange={setPrepayment} disabled={busy} />}
                  {amending ? (
                    <label>
                      Reason for amendment
                      <textarea
                        required
                        value={changeReason}
                        onChange={(e) => setChangeReason(e.target.value)}
                      />
                    </label>
                  ) : guaranteeError ? (
                    <p role="alert" className="auth-error">
                      {guaranteeError}
                    </p>
                  ) : guaranteeNeeded === null ? (
                    <p>Checking booking guarantee requirements…</p>
                  ) : prepayment ? (
                    <p>Your treatment will be paid upfront by {prepayment.method === "voucher" ? "voucher" : "credit note"}. No booking guarantee card is required.</p>
                  ) : guaranteeNeeded === false ? (
                    <p>
                      {Number(treatment.price) === 0 &&
                      (patchPlan?.patch_needed ||
                        treatment.category.toUpperCase() === "PATCH TEST")
                        ? "This is a free booking, so no card guarantee is required for this appointment. After you have completed the Patch Test in the Salon, please speak to a member of staff who can book you in for any relevant treatments."
                        : "No card guarantee is required for this appointment. Payment will be made in the salon after the treatment."}
                    </p>
                  ) : live && db ? (
                    <BookingGuarantee
                      key={staffClient?.id || session?.user.id}
                      db={db}
                      clientId={staffClient?.id}
                      onChange={(id, agreed) => {
                        setCard(id);
                        setConsent(agreed);
                      }}
                    />
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
                      (amending
                        ? !changeReason.trim()
                        : guaranteeNeeded === null ||
                          (prepayment ? !prepayment.id : guaranteeNeeded && (!consent || !card))) ||
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
              <section ref={confirmationSection} className="success panel" style={{ scrollMarginTop: 20 }}>
                <div className="success-icon">✓</div>
                <p className="eyebrow">
                  {amending ? "APPOINTMENT UPDATED" : "YOU’RE ALL BOOKED"}
                </p>
                <h2>See you soon, {confirmation.client_name.split(" ")[0]}.</h2>
                <p>
                  <strong>Salon Address:</strong> Williams St., Mulladrillen,
                  Ardee, Co. Louth A92 HW30
                </p>
                <p>
                  <strong>Treatment Booked:</strong>{" "}
                  {confirmation.treatment_name}
                </p>
                <p>
                  <strong>Date and Time:</strong>{" "}
                  {new Date(confirmation.appointment_date + "T12:00:00Z")
                    .toLocaleDateString("en-GB", {
                      timeZone: "Europe/Dublin",
                      weekday: "long",
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })
                    .replace(",", "")}
                  ,{" "}
                  {String(
                    Math.floor(confirmation.start_minute / 60) % 12 || 12,
                  ).padStart(2, "0")}
                  :{String(confirmation.start_minute % 60).padStart(2, "0")}{" "}
                  {confirmation.start_minute < 720 ? "am" : "pm"}
                </p>
                <p>
                  <strong>With:</strong>{" "}
                  {staff.find((s) => s.id === confirmation.staff_id)?.name}
                </p>
                {confirmation.prepaid_method && <p><strong>Paid already:</strong> {confirmation.prepaid_method === "voucher" ? `Voucher ID: ${confirmation.prepaid_voucher_code}` : "Credit Note"}. No further payment is required.</p>}
                <p className="small">Your booking is saved.</p>
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
          privatePortal && view !== "recovery" ? (
            <section className="staff-login">
              <p className="eyebrow">
                SCULPTED ·{" "}
                {accountantPortal ? "ACCOUNTANT PORTAL" : "STAFF PORTAL"}
              </p>
              <h1>
                {accountantPortal
                  ? "Accountant sign-in"
                  : "Select a Staff Profile"}
              </h1>
              <p>Choose your profile and enter your PIN.</p>
              {loginTile === null ? (
                <div className="workspace-grid">
                  {profiles
                    .filter((p) =>
                      accountantPortal
                        ? p.role === "accountant"
                        : p.role !== "accountant",
                    )
                    .map((s) => (
                      <button
                        className="panel staff-tile"
                        key={s.id}
                        onClick={() => {
                          setLoginTile(s.id);
                          setPin("");
                          setError("");
                        }}
                      >
                        {s.photo_url ? (
                          <img
                            className="profile-photo"
                            src={
                              s.photo_url ||
                              `./images/${s.name.toLowerCase()}.webp`
                            }
                            alt=""
                          />
                        ) : (
                          <span className="avatar">{s.name[0]}</span>
                        )}
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
                  <h2>{profiles.find((s) => s.id === loginTile)?.name}</h2>
                  {live && db ? (
                    <>
                      {!accountantPortal && (
                        <form
                          className="panel login"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void loginWithPin();
                          }}
                        >
                          <label>
                            4-digit login PIN
                            <input
                              autoFocus
                              type="password"
                              inputMode="numeric"
                              pattern="[0-9]{4}"
                              maxLength={4}
                              value={pin}
                              required
                              autoComplete="off"
                              disabled={busy}
                              onChange={(e) => {
                                const enteredPin = e.target.value
                                  .replace(/\D/g, "")
                                  .slice(0, 4);
                                setPin(enteredPin);
                                if (enteredPin.length === 4)
                                  void loginWithPin(enteredPin);
                              }}
                            />
                          </label>
                          <button className="primary" disabled={busy}>
                            Sign in with PIN
                          </button>
                        </form>
                      )}
                      {accountantPortal && (
                        <AuthPanel db={db} staffMode onComplete={() => {}} />
                      )}
                    </>
                  ) : offlineTest ? (
                    <form
                      className="panel login"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (
                          pin !==
                          (records.find((r) => r.id === loginTile)?.demo_pin ||
                            "1234")
                        ) {
                          setError(
                            "Incorrect demo PIN. This is not a real staff login.",
                          );
                          setPin("");
                          return;
                        }
                        const selected = profiles.find(
                          (p) => p.id === loginTile,
                        )!;
                        setLocalStaffId(selected.staffId);
                        setLocalRole(selected.role);
                        setView(["admin","staff"].includes(selected.role) ? "diary" : roleHome(selected.role));
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
                  ) : (
                    <p role="alert">
                      The login service is unavailable. Please try again later.
                    </p>
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
          ) : offlineTest ? (
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
                      setLocalStaffId(
                        r === "staff" ? 2 : r === "admin" ? 1 : null,
                      );
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
          ) : (
            <section className="panel login">
              <h1>Welcome back.</h1>
              <p role="alert">
                The login service is unavailable. Please try again later.
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
            {(["Upcoming Appointments", "Previous Appointments"] as const).map(
              (heading, index) => {
                const now = new Date();
                const parts = new Intl.DateTimeFormat("en-CA", {
                  timeZone: "Europe/Dublin",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                }).formatToParts(now);
                const part = (key: string) =>
                  parts.find((p) => p.type === key)?.value || "";
                const currentDay = `${part("year")}-${part("month")}-${part("day")}`;
                const currentMinute =
                  Number(part("hour")) * 60 + Number(part("minute"));
                const upcoming = (a: Appointment) =>
                  ["booked", "checked_in"].includes(a.status) &&
                  (a.appointment_date > currentDay ||
                    (a.appointment_date === currentDay &&
                      a.start_minute + a.duration > currentMinute));
                const appointments = (
                  live
                    ? myBookings
                    : local.filter((a) => a.user_id === "local-client")
                )
                  .filter((a) => upcoming(a) === (index === 0))
                  .sort(
                    (a, b) =>
                      (a.appointment_date.localeCompare(b.appointment_date) ||
                        a.start_minute - b.start_minute) *
                      (index === 0 ? 1 : -1),
                  );
                return (
                  <section
                    className="appointment-section"
                    key={heading}
                    aria-labelledby={`appointments-${index}`}
                  >
                    <h2 id={`appointments-${index}`}>
                      {heading} <span>{appointments.length}</span>
                    </h2>
                    {appointments.length === 0 && (
                      <p>
                        {index === 0
                          ? "You have no upcoming appointments."
                          : "You have no previous appointments yet."}
                      </p>
                    )}
                    {appointments.map((a) => {
                      const currentTreatment =
                        treatments.find(
                          (t) =>
                            t.id ===
                            (a.patch_for_treatment_id ?? a.treatment_id),
                        ) ||
                        treatments.find((t) => t.name === a.treatment_name);
                      return (
                        <article className="history-card" key={a.id}>
                          <div>
                            <h3>{a.treatment_name}</h3>
                            {a.booked_for_self === false && (
                              <p className="booking-recipient-label">
                                Booked by you, for {a.client_name}
                              </p>
                            )}
                            <p>
                              {displayDate(a.appointment_date)} · {time(a.start_minute)} ·{" "}
                              {staff.find((s) => s.id === a.staff_id)?.name}
                            </p>
                          </div>
                          <div className="appointment-actions">
                            <strong>{money(a.price)}</strong>
                            <p className="status">
                              {a.status.replaceAll("_", " ")}
                            </p>
                            {index === 1 && (
                              <button
                                className="primary"
                                disabled={!currentTreatment}
                                onClick={() => {
                                  if (!currentTreatment) return;
                                  startBooking();
                                  chooseRecipient(a.booked_for_self !== false);
                                  if (a.booked_for_self === false) {
                                    setName(a.client_name);
                                    setEmail(a.attendee_email || "");
                                    setPhone(a.phone || "");
                                  }
                                  setStaffClient(null);
                                  setAmending(null);
                                  setConfirmation(null);
                                  setStaffChoice(0);
                                  setDate(today());
                                  void chooseTreatment(
                                    currentTreatment,
                                    a.booked_for_self !== false,
                                  );
                                }}
                              >
                                Rebook appointment
                              </button>
                            )}
                            {index === 1 && !currentTreatment && (
                              <p className="small">
                                This treatment is no longer available.
                              </p>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </section>
                );
              },
            )}
            <p className="small">
              Cancellation and rescheduling will be added when the salon policy
              is confirmed.
            </p>
          </section>
        ) : view === "reporting-home" && activeRole === "accountant" ? (
          <section className="owner-workspace">
            <h1>Welcome, Jacqui.</h1>
            <div className="workspace-grid">
              <button
                className="panel workspace-card"
                onClick={() => setView("reporting-placeholder")}
              >
                <h2>Reporting</h2>
                <p>View activity reports and export to CSV.</p>
                <span>Open →</span>
              </button>
            </div>
          </section>
        ) : view === "permission-management" &&
          staffAccess &&
          allowed("view.permissions") ? (
          <PermissionManagement
            db={db}
            onHome={staffHome}
            onChanged={() => setPermissionVersion((v) => v + 1)}
          />
        ) : view === "treatment-management" &&
          staffAccess &&
          allowed("view.treatments") ? (
          <TreatmentManagement
            db={db}
            onHome={staffHome}
            onChanged={() => setCatalogVersion((v) => v + 1)}
          />
        ) : view === "staff-admin" && staffAccess && allowed("view.staff") ? (
          <StaffAdministration
            key={`${live}-${session?.user.id || ownStaffId}`}
            live={live}
            db={db}
            data={staffData}
            setData={setStaffData}
            treatments={treatments}
            appointments={appointments}
            ownStaffId={ownStaffId}
            actor={actorName}
            onHome={staffHome}
            onChanged={() => {
              setCatalogVersion((v) => v + 1);
              void refresh();
            }}
          />
        ) : ["reporting-placeholder"].includes(view) &&
          canAccess(activeRole, view, permissions) ? (
          <Reporting
            allowSandbox={activeRole === "admin"}
            key={`${session?.user.id || "local"}-${view}`}
            db={db}
            onHome={() => setView(roleHome(activeRole))}
          />
        ) : !canAccess(activeRole, view, permissions) ? (
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
                  type="date" lang="en-GB"
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
                    disabled={
                      activeRole === "admin"
                        ? !staff.length
                        : !ownStaffId || !allowed("perform.own_breaks")
                    }
                    onClick={() => openBreak()}
                  >
                    Add break time
                  </button>
                  <button className="secondary" disabled={!live || !db || !ownStaffId} onClick={()=>calendar.open()}>Block Out Time</button>
                </div>
                <div className="diary-scroll">
                  <div className="mobile-diary-selector">
                    <strong>{new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {weekday:"short",day:"numeric",month:"short"})}</strong>
                    <label>View staff diary<select value={mobileDiaryId ?? ""} onChange={e=>setMobileDiaryStaff(Number(e.target.value))}>{staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                  </div>
                  <div
                    className="diary"
                    style={{
                      gridTemplateColumns: `85px repeat(${staff.length}, minmax(200px, 1fr))`,
                    }}
                  >
                    <div className="time-column">
                      <div className="staff-heading">Dublin time</div>
                      <div
                        className="time-body"
                        style={{ height: diaryHeight }}
                      >
                        {Array.from(
                          { length: (diaryEnd - diaryStart) / 60 + 1 },
                          (_, i) => (
                            <span key={i} style={{ top: i * 96 }}>
                              {time(diaryStart + i * 60)}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                    {staff.map((s) => (
                      <div className={`staff-column ${s.id === mobileDiaryId ? "mobile-diary-selected" : ""}`} key={s.id}>
                        <div className="staff-heading">
                          <span className="avatar">{s.name[0]}</span>
                          {s.name}
                        </div>
                        <div
                          className="diary-body"
                          style={{ height: diaryHeight }}
                        >
                          {Array.from(
                            { length: (diaryEnd - diaryStart) / 30 },
                            (_, i) => (
                              <div
                                className="gridline"
                                key={i}
                                style={{ top: i * 48 }}
                              />
                            ),
                          )}
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
                                    disabled={
                                      activeRole !== "admin" &&
                                      b.staff_id !== ownStaffId
                                    }
                                    onClick={() => openBreak(b)}
                                    style={{
                                      top: (b.start_minute - diaryStart) * 1.6,
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
                          {calendar.entries.filter(e=>e.staff_id===s.id).map((e)=><button key={e.id} className={`appointment calendar-entry ${e.show_as}`} style={{top:(e.start_minute-diaryStart)*1.6,height:Math.max(e.duration*1.6,40),...laneStyle(e)}} disabled={activeRole!=="admin"&&e.staff_id!==ownStaffId} onClick={()=>calendar.open(e)}><strong>{time(e.start_minute)}–{time(e.start_minute+e.duration)}</strong><span>{e.description}</span><small>{e.show_as==='busy'?'Busy':'Free'}</small></button>)}
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
                                  top: (a.start_minute - diaryStart) * 1.6,
                                  height: Math.max(a.duration * 1.6, 24),
                                  ...laneStyle(a),
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
              {breakDraft.kind === "lunch" ? "Lunch time" : "Add break time"}
            </h2>
            <p>
              {staff.find((s) => s.id === breakDraft.staff_id)?.name} · {displayDate(date)}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveBreak();
              }}
            >
              {activeRole === "admin" && (
                <label>
                  Staff member
                  <select
                    value={breakDraft.staff_id}
                    disabled={!!breakDraft.id || breakDraft.kind === "lunch"}
                    onChange={(e) =>
                      setBreakDraft({
                        ...breakDraft,
                        staff_id: Number(e.target.value),
                      })
                    }
                  >
                    {staff.map((s) => (
                      <option
                        key={s.id}
                        value={s.id}
                        disabled={
                          breakDraft.kind === "break" &&
                          !breakDraft.id &&
                          s.id === ownStaffId &&
                          !allowed("perform.own_breaks")
                        }
                      >
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
              disabled={busy}
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
              {displayDate(selected.appointment_date)} · {time(selected.start_minute)}–
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
            {allowed("view.clients") && (
              <button
                className="back"
                onClick={() => {
                  setInitialPatchRecord(false);
                  setInitialStaffAppointment(selected);
                  setSelected(null);
                  setView("staff-workspace");
                }}
              >
                Open client record →
              </button>
            )}
            <hr />
            {selected.status === "booked" && (
              <button
                className="secondary appointment-action"
                disabled={busy}
                onClick={() => void amendFromDiary(selected)}
              >
                Amend appointment
              </button>
            )}
            {selected.status === "booked" && (
              <AppointmentReminder key={`reminder-${selected.id}`} db={live ? db : null} appointmentId={selected.id} initialEmail={selected.attendee_email || ""} disabled={busy} />
            )}
            {selected.status === "booked" && (
              <button
                className="primary appointment-action"
                disabled={busy}
                onClick={() => void changeStatus("checked_in")}
              >
                Check client in
              </button>
            )}
            {selected.status === "checked_in" && (
              <p><button className="back" disabled={busy} onClick={() => void cancelCheckIn()}>Cancel Check In</button></p>
            )}
            {selected.status === "completed" && (
              <CheckoutHistory
                key={`history-${selected.id}`}
                db={live ? db : null}
                appointment={selected}
              />
            )}
            {selected.status === "checked_in" && (
              <AppointmentCheckout
                key={`checkout-${selected.id}`}
                canDiscount={allowed("perform.discounts")}
                db={live ? db : null}
                appointment={selected}
                onSaved={async (completed) => {
                  const operation = identityVersion.current;
                  await refresh();
                  if (operation !== identityVersion.current) return;
                  setSelected(null);
                  if (
                    completed.patch_for_treatment_id ||
                    selected.treatment_name.trim().toUpperCase() ===
                      "PATCH TEST" ||
                    treatments
                      .find((t) => t.id === selected.treatment_id)
                      ?.category.toUpperCase() === "PATCH TEST"
                  ) {
                    if (allowed("view.clients")) {
                      setInitialPatchRecord(true);
                      setInitialStaffAppointment(completed);
                      setView("staff-workspace");
                    } else
                      setError(
                        "Appointment completed. Client Management permission is required to record its patch test.",
                      );
                  }
                }}
              />
            )}
            {selected.status === "booked" && (
              <button
                className="danger appointment-action"
                disabled={busy}
                onClick={() => {
                  setStatusAction("cancelled");
                  setStatusReason("");
                }}
              >
                Cancel appointment
              </button>
            )}
            {sandboxNoShowTesting && selected.status === "booked" && (
              <p className="small">
                <strong>Sandbox testing:</strong> future appointments can be
                marked as no-shows.
              </p>
            )}
            {selected.status === "booked" && (
              <button
                className="danger appointment-action"
                disabled={
                  busy ||
                  (!sandboxNoShowTesting &&
                    (selected.appointment_date > today() ||
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
                            ))))
                }
                onClick={() => {
                  setStatusAction("no_show");
                  setStatusReason("");
                }}
              >
                Mark as no-show
              </button>
            )}
            {selected.status === "no_show" && (
              <div className="guarantee">
                <h3>No-show fee</h3>
                <p>
                  Sandbox payment:{" "}
                  <strong>
                    {feeInfo?.state === "completed"
                      ? "€10 paid"
                      : feeInfo?.state === "waived"
                        ? "Waived — no payment taken"
                        : feeInfo?.state === "failed"
                          ? "Failed — no payment taken"
                          : feeInfo?.state === "review"
                            ? "Needs review — payment not confirmed"
                            : feeInfo?.state === "not_recorded"
                              ? "No fee decision recorded"
                              : feeInfo?.state === "processing"
                                ? "Payment pending — not yet confirmed"
                                : feeInfo?.state === "pending"
                                  ? "Fee approved — awaiting submission"
                                  : feeInfo?.state || "Loading…"}
                  </strong>
                </p>
                {feeInfo?.comments && <p>Comments: {feeInfo.comments}</p>}
                {feeInfo?.error && <p role="alert">{feeInfo.error}</p>}
                {feeInfo?.provider_state && (
                  <p className="small">
                    Revolut order status: {feeInfo.provider_state}
                  </p>
                )}
                {feeInfo?.status_error && (
                  <p role="alert">
                    Status check failed: {feeInfo.status_error}
                  </p>
                )}
                <p role="status" aria-live="polite">
                  {feeChecking
                    ? "Checking the payment with Revolut…"
                    : feeCheckMessage}
                </p>
                {!feeInfo ||
                !["completed", "waived", "failed", "not_recorded"].includes(
                  feeInfo.state,
                ) ? (
                  <button
                    className="secondary"
                    disabled={busy || feeChecking}
                    onClick={async () => {
                      const id = selected.id;
                      const operation = identityVersion.current;
                      setFeeChecking(true);
                      setFeeCheckMessage("");
                      try {
                        const result = await feeCall(
                          feeInfo?.state === "pending"
                            ? "charge"
                            : "fee_status",
                          id,
                        );
                        if (operation !== identityVersion.current) return;
                        setFeeInfo(result);
                        setFeeCheckMessage(
                          ["pending", "processing"].includes(result.state)
                            ? "Checked just now — Revolut has not confirmed payment yet."
                            : "Payment status updated.",
                        );
                      } catch (e) {
                        if (operation !== identityVersion.current) return;
                        setFeeCheckMessage(
                          "Unable to check the payment: " +
                            (e as Error).message,
                        );
                      } finally {
                        setFeeChecking(false);
                      }
                    }}
                  >
                    {feeChecking
                      ? "Checking…"
                      : feeInfo?.state === "pending"
                        ? "Finish approved €10 charge"
                        : "Check payment status again"}
                  </button>
                ) : null}
              </div>
            )}
            {statusAction && (
              <div className="guarantee" ref={statusSection}>
                <h3>
                  {statusAction === "no_show"
                    ? "Record a no-show"
                    : "Confirm cancellation"}
                </h3>
                {statusAction === "no_show" && (
                  <p>
                    {selected.guarantee_required === false
                      ? "This appointment has no card guarantee. Record the no-show without a card charge."
                      : "Do you want to apply the €10 no-show fee? This is a Revolut Sandbox charge. Either choice marks the appointment as a no-show."}
                  </p>
                )}
                <label>
                  {statusAction === "no_show"
                    ? "Comments — explain why the fee is applied or waived"
                    : "Reason"}
                  <textarea
                    required
                    ref={statusComments}
                    maxLength={2000}
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                  />
                </label>
                {statusAction === "no_show" ? (
                  <>
                    {selected.guarantee_required !== false && (
                      <button
                        className="danger"
                        disabled={busy || !statusReason.trim()}
                        onClick={() => void recordNoShow(true)}
                      >
                        Yes — apply €10 fee
                      </button>
                    )}
                    {(selected.guarantee_required === false ||
                      allowed("perform.waive_fees")) && (
                      <button
                        className="secondary"
                        disabled={busy || !statusReason.trim()}
                        onClick={() => void recordNoShow(false)}
                      >
                        {selected.guarantee_required === false
                          ? "Mark no-show — no card guarantee required"
                          : "No — waive fee"}
                      </button>
                    )}
                    {selected.guarantee_required !== false &&
                      !allowed("perform.waive_fees") && (
                        <p className="small">
                          You do not have permission to waive this fee. Ask an
                          authorised staff member if a waiver is needed.
                        </p>
                      )}
                  </>
                ) : (
                  <button
                    className="danger"
                    disabled={busy || !statusReason.trim()}
                    onClick={() => void changeStatus(statusAction)}
                  >
                    Confirm cancellation
                  </button>
                )}
                <button
                  className="back"
                  disabled={busy}
                  onClick={() => setStatusAction("")}
                >
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
      <p>{displayDate(date)}</p>
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
