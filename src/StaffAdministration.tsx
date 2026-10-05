import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LocalStaffData,
  StaffRecord,
  StaffNote,
  DayShift,
  WorkSession,
  Appointment,
} from "./domain";
import {
  seedStaffRecords,
  dublinToday,
  addDays,
  minute,
  hhmm,
  localClockInput,
  clockISO,
  localShift,
} from "./staffAdminModel";
type Treatment = { id: number; name: string; category: string };
const blank = (): StaffRecord => ({
  id: 0,
  staff_id: 0,
  name: "",
  first_name: "",
  last_name: "",
  address: "",
  date_of_birth: null,
  phone: "",
  email: "",
  date_hired: null,
  date_left: null,
  employment_type: "hourly",
  salary: null,
  hourly_rate: null,
  commission_rate: null,
  revision: 0,
  role: "staff",
  active: true,
  photo_url: null,
  treatment_ids: [],
});
export default function StaffAdministration({
  live,
  db,
  data,
  setData,
  treatments,
  appointments,
  ownStaffId,
  actor,
  onChanged,
  onHome,
}: {
  live: boolean;
  db: SupabaseClient | null;
  data: LocalStaffData;
  setData: Dispatch<SetStateAction<LocalStaffData>>;
  treatments: Treatment[];
  appointments: Appointment[];
  ownStaffId: number | null;
  actor: string;
  onChanged: () => void;
  onHome: () => void;
}) {
  const records =
    data.staffRecords || seedStaffRecords(treatments.map((t) => t.id));
  const [remote, setRemote] = useState<StaffRecord[]>([]),
    [draft, setDraft] = useState<StaffRecord | null>(null),
    [pin, setPin] = useState(""),
    [tab, setTab] = useState("details"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [archived, setArchived] = useState(false),
    [archiveMode, setArchiveMode] = useState(false);
  const [notes, setNotes] = useState<StaffNote[]>([]),
    [note, setNote] = useState(""),
    [days, setDays] = useState<DayShift[]>([]),
    [shiftStart, setShiftStart] = useState(dublinToday()),
    [clockStart, setClockStart] = useState(addDays(dublinToday(), -13)),
    [clocks, setClocks] = useState<WorkSession[]>([]),
    [clockEdit, setClockEdit] = useState<WorkSession | null>(null),
    [clockIn, setClockIn] = useState(""),
    [clockOut, setClockOut] = useState(""),
    [reason, setReason] = useState(""),
    [skills, setSkills] = useState<number[]>([]),
    [skillSearch, setSkillSearch] = useState(""),
    [skillCategory, setSkillCategory] = useState("All treatments"),
    [left, setLeft] = useState(dublinToday()),
    [archiveReason, setArchiveReason] = useState("");
  const alive = useRef(true),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  async function loadList() {
    if (!live || !db) return;
    const r = await db.rpc("list_admin_staff");
    if (!alive.current) return;
    if (r.error) throw r.error;
    setRemote(r.data || []);
  }
  useEffect(() => {
    if (live) void loadList().catch((e) => setError(e.message));
  }, [live, db]);
  const list = live ? remote : records;
  const audit = (
    action: string,
    staffId: number,
    details: Record<string, unknown> = {},
  ) => ({
    id: crypto.randomUUID(),
    action,
    created_at: new Date().toISOString(),
    actor_name: actor,
    details: { staff_id: staffId, ...details },
  });
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function select(s: StaffRecord) {
    const version = ++generation.current;
    setDraft({ ...s });
    setPin("");
    setTab("details");
    setError("");
    setMessage("");
    setClockEdit(null);
    setNote("");
    setShiftStart(dublinToday());
    setClockStart(addDays(dublinToday(), -13));
    if (!live) {
      setSkills(s.treatment_ids || []);
      return;
    }
    setNotes([]);
    setSkills([]);
    await run(async () => {
      const [n, k] = await Promise.all([
        db!
          .from("staff_notes")
          .select("*")
          .eq("staff_id", s.id)
          .is("removed_at", null)
          .order("created_at", { ascending: false }),
        db!
          .from("staff_treatments")
          .select("treatment_id")
          .eq("staff_id", s.id),
      ]);
      if (n.error) throw n.error;
      if (k.error) throw k.error;
      if (!alive.current || version !== generation.current) return;
      setNotes(n.data || []);
      setSkills((k.data || []).map((x) => x.treatment_id));
    });
  }
  useEffect(() => {
    if (!draft?.id) return;
    let stopped = false;
    const s = draft;
    if (!live) {
      setDays(
        Array.from({ length: 14 }, (_, i) =>
          localShift(
            records,
            data.dayShifts || [],
            s.id,
            addDays(shiftStart, i),
          ),
        ),
      );
      setClocks(
        (data.shifts || [])
          .filter(
            (w) =>
              w.staff_id === s.id &&
              localClockInput(w.clocked_in_at).slice(0, 10) >= clockStart &&
              localClockInput(w.clocked_in_at).slice(0, 10) <=
                addDays(clockStart, 13),
          )
          .sort((a, b) => b.clocked_in_at.localeCompare(a.clocked_in_at)),
      );
      setNotes(
        (data.staffNotes || []).filter(
          (n) => n.staff_id === s.id && !n.removed_at,
        ),
      );
      return;
    }
    void (async () => {
      const [sh, w, r] = await Promise.all([
        db!
          .from("staff_day_shifts")
          .select("*")
          .eq("staff_id", s.id)
          .gte("shift_date", shiftStart)
          .lte("shift_date", addDays(shiftStart, 13)),
        db!
          .from("work_sessions")
          .select("*")
          .eq("staff_id", s.id)
          .gte("clocked_in_at", clockISO(clockStart + "T00:00"))
          .lt("clocked_in_at", clockISO(addDays(clockStart, 14) + "T00:00"))
          .order("clocked_in_at", { ascending: false }),
        db!.from("weekly_rotas").select("*").eq("staff_id", s.id),
      ]);
      if (stopped) return;
      if (sh.error || w.error || r.error) {
        setError((sh.error || w.error || r.error)!.message);
        return;
      }
      setDays(
        Array.from({ length: 14 }, (_, i) => {
          const date = addDays(shiftStart, i);
          const saved = sh.data?.find((x) => x.shift_date === date);
          if (saved) return saved;
          const rota = r.data?.find(
            (x) => x.weekday === new Date(date + "T12:00:00Z").getUTCDay(),
          );
          return {
            staff_id: s.id,
            shift_date: date,
            start_minute: rota?.start_minute ?? null,
            end_minute: rota?.end_minute ?? null,
            revision: 0,
          };
        }),
      );
      setClocks(w.data || []);
    })().catch((e) => {
      if (!stopped) setError(e.message);
    });
    return () => {
      stopped = true;
    };
  }, [
    draft?.id,
    shiftStart,
    clockStart,
    data.dayShifts,
    data.shifts,
    data.staffNotes,
  ]);
  function update<K extends keyof StaffRecord>(key: K, value: StaffRecord[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }
  async function photo(file: File) {
    await run(async () => {
      if (!file.type.startsWith("image/") || file.size > 10_000_000)
        throw Error("Choose an image under 10 MB.");
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(Error("Unable to read image."));
          img.src = url;
        });
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 400 / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas
          .getContext("2d")!
          .drawImage(img, 0, 0, canvas.width, canvas.height);
        if (alive.current)
          update("photo_url", canvas.toDataURL("image/webp", 0.85));
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  }
  async function save() {
    if (!draft) return;
    const s = draft;
    await run(async () => {
      if (!s.first_name.trim()) throw Error("First name is required.");
      const value =
        s.employment_type === "hourly"
          ? s.hourly_rate
          : s.employment_type === "salaried"
            ? s.salary
            : s.commission_rate;
      if (
        value === null ||
        !Number.isFinite(Number(value)) ||
        Number(value) < 0 ||
        (s.employment_type === "commission" && Number(value) > 100)
      )
        throw Error("Enter a valid pay rate.");
      if (s.date_of_birth && s.date_of_birth > dublinToday())
        throw Error("Date of birth cannot be in the future.");
      if ((!s.id && !pin) || (pin && !/^\d{4}$/.test(pin)))
        throw Error("Enter a four-digit PIN.");
      let saved: StaffRecord;
      if (live) {
        const r = await db!.rpc("save_admin_staff", {
          p_id: s.id || null,
          p_details: s,
          p_pin: pin,
          p_revision: s.revision,
        });
        if (r.error) throw r.error;
        if (!alive.current) return;
        saved = r.data;
        await loadList();
      } else {
        const id = s.id || Math.max(3, ...records.map((x) => x.id)) + 1;
        saved = {
          ...s,
          id,
          staff_id: id,
          name: (s.first_name + " " + s.last_name).trim(),
          profile_key: s.profile_key || `local-staff-${id}`,
          demo_pin: pin || s.demo_pin,
          pin_set: !!(pin || s.demo_pin),
          revision: s.revision + 1,
        };
        const before = records.find((x) => x.id === id);
        if (before && before.revision !== s.revision)
          throw Error("Staff details changed. Reload before saving.");
        setData((d) => ({
          ...d,
          staffRecords: s.id
            ? records.map((x) => (x.id === id ? saved : x))
            : [...records, saved],
          activity: [
            ...d.activity,
            audit(s.id ? "staff_updated" : "staff_created", id, {
              before: before ? { ...before, demo_pin: undefined } : null,
              after: { ...saved, demo_pin: undefined },
              pin_changed: !!pin,
            }),
          ],
        }));
      }
      if (!alive.current) return;
      setDraft(saved);
      setPin("");
      setMessage("Staff details saved.");
      onChanged();
    });
  }
  async function saveSkills() {
    if (!draft) return;
    const s = draft;
    await run(async () => {
      if (live) {
        const r = await db!.rpc("save_staff_skills", {
          p_staff_id: s.id,
          p_treatment_ids: skills,
        });
        if (r.error) throw r.error;
      } else
        setData((d) => ({
          ...d,
          staffRecords: records.map((x) =>
            x.id === s.id ? { ...x, treatment_ids: skills } : x,
          ),
          activity: [
            ...d.activity,
            audit("staff_treatments_changed", s.id, {
              before: records.find((x) => x.id === s.id)?.treatment_ids,
              after: skills,
            }),
          ],
        }));
      if (alive.current) {
        setMessage("Treatment permissions saved.");
        onChanged();
      }
    });
  }
  async function saveShifts() {
    if (!draft) return;
    await run(async () => {
      const editable = days.filter((s) => s.shift_date >= dublinToday());
      for (const d of editable) {
        if (
          d.start_minute !== null &&
          (d.end_minute === null ||
            d.start_minute < 0 ||
            d.end_minute > 1440 ||
            d.start_minute >= d.end_minute)
        )
          throw Error("Shift end must be after shift start.");
        if (
          appointments.some(
            (a) =>
              a.staff_id === d.staff_id &&
              a.appointment_date === d.shift_date &&
              ["booked", "checked_in"].includes(a.status) &&
              (d.start_minute === null ||
                a.start_minute < d.start_minute ||
                a.start_minute + a.duration > d.end_minute!),
          )
        )
          throw Error(
            "An open appointment falls outside this shift. Reassign it first.",
          );
      }
      if (live) {
        const r = await db!.rpc("save_staff_shifts", {
          p_staff_id: draft.id,
          p_days: editable,
        });
        if (r.error) throw r.error;
      } else
        setData((d) => ({
          ...d,
          dayShifts: [
            ...(d.dayShifts || []).filter(
              (old) =>
                !editable.some(
                  (x) =>
                    x.staff_id === old.staff_id &&
                    x.shift_date === old.shift_date,
                ),
            ),
            ...editable.map((x) => ({ ...x, revision: x.revision + 1 })),
          ],
          activity: [
            ...d.activity,
            audit("staff_shifts_changed", draft.id, { after: editable }),
          ],
        }));
      if (alive.current) {
        setDays((d) => d.map((s) => ({ ...s, revision: s.revision + 1 })));
        setMessage("Working shifts saved.");
        onChanged();
      }
    });
  }
  async function addNote() {
    if (!draft) return;
    await run(async () => {
      if (!note.trim()) throw Error("Enter a note.");
      if (live) {
        const r = await db!.rpc("add_staff_note", {
          p_staff_id: draft.id,
          p_body: note,
        });
        if (r.error) throw r.error;
        if (alive.current) setNotes((n) => [r.data, ...n]);
      } else {
        const n = {
          id: crypto.randomUUID(),
          staff_id: draft.id,
          body: note.trim(),
          created_at: new Date().toISOString(),
        };
        setData((d) => ({
          ...d,
          staffNotes: [...(d.staffNotes || []), n],
          activity: [
            ...d.activity,
            audit("staff_note_added", draft.id, { note_id: n.id }),
          ],
        }));
      }
      if (alive.current) setNote("");
    });
  }
  async function removeNote(n: StaffNote) {
    await run(async () => {
      if (live) {
        const r = await db!.rpc("remove_staff_note", { p_id: n.id });
        if (r.error) throw r.error;
        if (alive.current) setNotes((ns) => ns.filter((x) => x.id !== n.id));
      } else
        setData((d) => ({
          ...d,
          staffNotes: (d.staffNotes || []).map((x) =>
            x.id === n.id ? { ...x, removed_at: new Date().toISOString() } : x,
          ),
          activity: [
            ...d.activity,
            audit("staff_note_removed", n.staff_id, { note_id: n.id }),
          ],
        }));
    });
  }
  async function archive() {
    if (!draft) return;
    const s = draft;
    await run(async () => {
      if (s.id === ownStaffId)
        throw Error("You cannot archive your own account.");
      if (!left || left > dublinToday() || !archiveReason.trim())
        throw Error(
          "Enter a date left and reason; date left cannot be in the future.",
        );
      if (s.date_hired && left < s.date_hired)
        throw Error("Date left must be on or after date hired.");
      if (
        appointments.some(
          (a) =>
            a.staff_id === s.id &&
            a.appointment_date >= dublinToday() &&
            ["booked", "checked_in"].includes(a.status),
        )
      )
        throw Error("Reassign or cancel open appointments before archiving.");
      if (
        !live &&
        (data.shifts || []).some(
          (w) => w.staff_id === s.id && !w.clocked_out_at,
        )
      )
        throw Error("Close the open clock session before archiving.");
      if (live) {
        const r = await db!.rpc("archive_admin_staff", {
          p_id: s.id,
          p_date_left: left,
          p_reason: archiveReason,
          p_revision: s.revision,
        });
        if (r.error) throw r.error;
        await loadList();
      } else
        setData((d) => ({
          ...d,
          staffRecords: records.map((x) =>
            x.id === s.id
              ? {
                  ...x,
                  active: false,
                  date_left: left,
                  revision: x.revision + 1,
                }
              : x,
          ),
          activity: [
            ...d.activity,
            audit("staff_archived", s.id, {
              date_left: left,
              reason: archiveReason,
            }),
          ],
        }));
      if (alive.current) {
        setDraft(null);
        setMessage("Staff member archived. History retained.");
        onChanged();
      }
    });
  }
  async function correctClock() {
    if (!draft) return;
    await run(async () => {
      const start = clockISO(clockIn),
        end = clockOut ? clockISO(clockOut) : null;
      if (
        !reason.trim() ||
        Date.parse(start) > Date.now() ||
        (end && (Date.parse(end) > Date.now() || end < start))
      )
        throw Error("Enter valid past times and a correction reason.");
      if (live) {
        const r = await db!.rpc("correct_staff_clock", {
          p_staff_id: draft.id,
          p_id: clockEdit?.id || null,
          p_in: start,
          p_out: end,
          p_reason: reason,
          p_revision: clockEdit?.revision || 0,
        });
        if (r.error) throw r.error;
        if (alive.current)
          setClocks((c) =>
            [...c.filter((x) => x.id !== r.data.id), r.data].sort((a, b) =>
              b.clocked_in_at.localeCompare(a.clocked_in_at),
            ),
          );
      } else {
        if (
          (data.shifts || []).some(
            (w) =>
              w.staff_id === draft.id &&
              w.id !== clockEdit?.id &&
              Date.parse(w.clocked_in_at) <
                (end ? Date.parse(end) : Infinity) &&
              Date.parse(w.clocked_out_at || "9999-01-01") > Date.parse(start),
          )
        )
          throw Error("Clock times overlap another session.");
        const w: WorkSession = {
          id: clockEdit?.id || crypto.randomUUID(),
          user_id: clockEdit?.user_id || `local-staff-${draft.id}`,
          staff_id: draft.id,
          staff_name: draft.name,
          clocked_in_at: start,
          clocked_out_at: end,
          revision: (clockEdit?.revision || 0) + 1,
          correction_reason: reason,
        };
        setData((d) => ({
          ...d,
          shifts: [...(d.shifts || []).filter((x) => x.id !== w.id), w],
          activity: [
            ...d.activity,
            audit("staff_clock_corrected", draft.id, {
              before: clockEdit,
              after: w,
              reason,
            }),
          ],
        }));
      }
      if (alive.current) {
        setClockEdit(null);
        setClockIn("");
        setClockOut("");
        setReason("");
        setMessage(
          "Clock record saved; original times retained in the audit history.",
        );
        onChanged();
      }
    });
  }
  const tabs = [
    "details",
    "notes",
    "shifts",
    "clock history",
    "treatments",
    "archive",
  ];
  return (
    <section className="staff-administration">
      <button
        className="back"
        disabled={busy}
        onClick={() => {
          if (draft) {
            generation.current++;
            setDraft(null);
            setError("");
            setMessage("");
          } else onHome();
        }}
      >
        ← {draft ? "Staff Administration" : "Staff home"}
      </button>
      <h1>
        {draft
          ? draft.id
            ? draft.name
            : "Create New Staff Member"
          : "Staff Administration"}
      </h1>
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
      {!draft ? (
        <>
          <div className="record-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setDraft(blank());
                setPin("");
                setTab("details");
                setError("");
                setMessage("");
              }}
            >
              Create New Staff Member
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setArchiveMode(!archiveMode);
                setArchived(false);
              }}
            >
              {archiveMode ? "Open staff details" : "Archive Staff Member"}
            </button>
            <label>
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />{" "}
              Show archived staff
            </label>
          </div>
          {archiveMode && <p>Select the staff member you want to archive.</p>}
          <div className="workspace-grid">
            {list
              .filter((s) => (archived ? !s.active : s.active !== false))
              .map((s) => (
                <button
                  className="panel staff-tile"
                  key={s.id}
                  disabled={busy}
                  onClick={() =>
                    void select(s).then(() => {
                      if (archiveMode) setTab("archive");
                    })
                  }
                >
                  {s.photo_url ? (
                    <img className="profile-photo" src={s.photo_url} alt="" />
                  ) : (
                    <span className="avatar">{s.first_name[0]}</span>
                  )}
                  <h2>{s.name}</h2>
                  <p>
                    {s.active === false
                      ? `Archived · Left ${s.date_left || "not recorded"}`
                      : s.role === "admin"
                        ? "Admin"
                        : "Staff"}
                  </p>
                </button>
              ))}
          </div>
        </>
      ) : (
        <>
          <nav className="admin-tabs" aria-label="Staff record sections">
            {tabs
              .filter((t) => draft.id || t === "details")
              .map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  disabled={busy}
                  onClick={() => {
                    setTab(t);
                    setMessage("");
                    setError("");
                  }}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
          </nav>
          {tab === "details" ? (
            <section className="panel">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={busy || draft.active === false}>
                  <div className="staff-form-grid">
                    {(
                      [
                        "first_name",
                        "last_name",
                        "address",
                        "date_of_birth",
                        "phone",
                        "email",
                        "date_hired",
                      ] as const
                    ).map((k) => (
                      <label key={k}>
                        {
                          {
                            first_name: "First name",
                            last_name: "Last name",
                            address: "Address",
                            date_of_birth: "Date of Birth",
                            phone: "Phone Number",
                            email: "Email Address",
                            date_hired: "Date Hired",
                          }[k]
                        }
                        <input
                          type={
                            k === "date_of_birth" || k === "date_hired"
                              ? "date"
                              : k === "email"
                                ? "email"
                                : k === "phone"
                                  ? "tel"
                                  : "text"
                          }
                          required={k === "first_name"}
                          max={
                            k === "date_of_birth" ? dublinToday() : undefined
                          }
                          value={draft[k] || ""}
                          onChange={(e) =>
                            update(k, e.target.value || (null as any))
                          }
                        />
                      </label>
                    ))}
                    <label>
                      {draft.id ? "Set / change login PIN" : "Login PIN"}
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        autoComplete="new-password"
                        required={!draft.id}
                        value={pin}
                        onChange={(e) =>
                          setPin(e.target.value.replace(/\D/g, ""))
                        }
                      />
                      <small>
                        {draft.pin_set
                          ? "PIN set. Leave blank to keep it. Saved PINs cannot be displayed."
                          : "PIN not set."}
                      </small>
                    </label>
                    <label>
                      Employment Type
                      <select
                        value={draft.employment_type}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            employment_type: e.target.value,
                            salary: null,
                            hourly_rate: null,
                            commission_rate: null,
                          })
                        }
                      >
                        <option value="hourly">Hourly rate</option>
                        <option value="salaried">Salaried</option>
                        <option value="commission">Commission</option>
                      </select>
                    </label>
                    {(["salary", "hourly_rate", "commission_rate"] as const)
                      .filter(
                        (k) =>
                          k ===
                          (
                            {
                              hourly: "hourly_rate",
                              salaried: "salary",
                              commission: "commission_rate",
                            } as Record<string, string>
                          )[draft.employment_type],
                      )
                      .map((k) => (
                        <label key={k}>
                          {k === "salary"
                            ? "Current Salary (€ per year)"
                            : k === "hourly_rate"
                              ? "Current Hourly Rate (€)"
                              : "Current Commission Rate (%)"}
                          <input
                            type="number"
                            min="0"
                            max={k === "commission_rate" ? 100 : undefined}
                            step="0.01"
                            required
                            value={draft[k] ?? ""}
                            onChange={(e) =>
                              update(
                                k,
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                          />
                        </label>
                      ))}
                    <label>
                      Staff photo
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          if (e.target.files?.[0])
                            void photo(e.target.files[0]);
                        }}
                      />
                      {draft.photo_url && (
                        <img
                          className="profile-photo"
                          src={draft.photo_url}
                          alt="Staff photo preview"
                        />
                      )}
                    </label>
                  </div>
                  <button className="primary">Save staff details</button>
                </fieldset>
              </form>
              {draft.date_left && <p>Date Left: {draft.date_left}</p>}
              <button
                className="secondary"
                onClick={() =>
                  setMessage(
                    "HR Log Report download will be available when Reporting is built.",
                  )
                }
              >
                HR Log Report — coming soon
              </button>
            </section>
          ) : tab === "notes" ? (
            <section className="panel">
              <h2>Staff Notes</h2>
              <label>
                New staff note
                <textarea
                  value={note}
                  maxLength={5000}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={busy || !note.trim()}
                onClick={() => void addNote()}
              >
                Add staff note
              </button>
              {notes.map((n) => (
                <article className="staff-note" key={n.id}>
                  <p>{n.body}</p>
                  <small>
                    {new Date(n.created_at).toLocaleString("en-IE", {
                      timeZone: "Europe/Dublin",
                    })}
                  </small>
                  <button
                    className="back"
                    disabled={busy}
                    onClick={() => void removeNote(n)}
                  >
                    Remove note
                  </button>
                </article>
              ))}
            </section>
          ) : tab === "shifts" ? (
            <section className="panel">
              <h2>Two-week Shift Pattern</h2>
              <p>
                Set working hours for each date, or mark the day off. These
                hours determine booking availability. Existing weekly hours
                apply until a date is saved.
              </p>
              <div className="date-controls">
                <button
                  disabled={busy || shiftStart <= dublinToday()}
                  onClick={() =>
                    setShiftStart(
                      addDays(shiftStart, -14) < dublinToday()
                        ? dublinToday()
                        : addDays(shiftStart, -14),
                    )
                  }
                >
                  ← Previous fortnight
                </button>
                <label>
                  Shifts starting
                  <input
                    type="date"
                    min={dublinToday()}
                    value={shiftStart}
                    onChange={(e) => {
                      if (e.target.value) setShiftStart(e.target.value);
                    }}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() => setShiftStart(addDays(shiftStart, 14))}
                >
                  Next fortnight →
                </button>
              </div>
              <div className="shift-list">
                {days.map((s, i) => (
                  <div className="shift-row" key={s.shift_date}>
                    <strong>
                      {new Date(s.shift_date + "T12:00:00Z").toLocaleDateString(
                        "en-IE",
                        { weekday: "short", day: "numeric", month: "short" },
                      )}
                    </strong>
                    <label>
                      <input
                        type="checkbox"
                        disabled={busy || draft.active === false}
                        checked={s.start_minute !== null}
                        onChange={(e) =>
                          setDays((d) =>
                            d.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    start_minute: e.target.checked ? 540 : null,
                                    end_minute: e.target.checked ? 1020 : null,
                                  }
                                : x,
                            ),
                          )
                        }
                      />{" "}
                      Working
                    </label>
                    {s.start_minute !== null ? (
                      <>
                        <label>
                          Start
                          <input
                            type="time"
                            disabled={busy || draft.active === false}
                            value={hhmm(s.start_minute)}
                            onChange={(e) =>
                              setDays((d) =>
                                d.map((x, j) =>
                                  j === i
                                    ? {
                                        ...x,
                                        start_minute: e.target.value
                                          ? minute(e.target.value)
                                          : null,
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          End
                          <input
                            type="time"
                            disabled={busy || draft.active === false}
                            value={hhmm(s.end_minute ?? 1020)}
                            onChange={(e) =>
                              setDays((d) =>
                                d.map((x, j) =>
                                  j === i
                                    ? {
                                        ...x,
                                        end_minute: e.target.value
                                          ? minute(e.target.value)
                                          : null,
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </label>
                      </>
                    ) : (
                      <span>Day off</span>
                    )}
                  </div>
                ))}
              </div>
              <button
                className="primary"
                disabled={busy || draft.active === false}
                onClick={() => void saveShifts()}
              >
                Save working shifts
              </button>
            </section>
          ) : tab === "clock history" ? (
            <section className="panel">
              <h2>Clock-In / Clock-Out History</h2>
              <p>
                Showing {clockStart} to {addDays(clockStart, 13)} · Dublin time.
                Corrections retain the original entry and record your reason.
              </p>
              <div className="date-controls">
                <button
                  disabled={busy}
                  onClick={() => setClockStart(addDays(clockStart, -14))}
                >
                  ← Previous fortnight
                </button>
                <label>
                  Clock history starting
                  <input
                    type="date"
                    max={dublinToday()}
                    value={clockStart}
                    onChange={(e) => {
                      if (e.target.value) setClockStart(e.target.value);
                    }}
                  />
                </label>
                <button
                  disabled={busy || addDays(clockStart, 13) >= dublinToday()}
                  onClick={() => setClockStart(addDays(clockStart, 14))}
                >
                  Next fortnight →
                </button>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setClockEdit(null);
                  setClockIn(dublinToday() + "T09:00");
                  setClockOut("");
                  setReason("");
                }}
              >
                Add missed clock entry
              </button>
              {!clocks.length && <p>No clock entries for this period.</p>}
              <div className="clock-history">
                {clocks.map((w) => (
                  <article className="staff-note" key={w.id}>
                    <strong>
                      {localClockInput(w.clocked_in_at).replace("T", " · ")}
                    </strong>
                    <p>
                      Clock-Out:{" "}
                      {w.clocked_out_at
                        ? localClockInput(w.clocked_out_at).replace("T", " · ")
                        : "Still clocked in"}
                    </p>
                    {w.correction_reason && (
                      <p>Correction: {w.correction_reason}</p>
                    )}
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setClockEdit(w);
                        setClockIn(localClockInput(w.clocked_in_at));
                        setClockOut(
                          w.clocked_out_at
                            ? localClockInput(w.clocked_out_at)
                            : "",
                        );
                        setReason("");
                      }}
                    >
                      Amend clock times
                    </button>
                  </article>
                ))}
              </div>
              {clockIn && (
                <form
                  className="clock-correction"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void correctClock();
                  }}
                >
                  <h3>
                    {clockEdit
                      ? "Amend clock record"
                      : "Add missed clock record"}
                  </h3>
                  <label>
                    Clock-In time
                    <input
                      type="datetime-local"
                      required
                      value={clockIn}
                      onChange={(e) => setClockIn(e.target.value)}
                    />
                  </label>
                  <label>
                    Clock-Out time
                    <input
                      type="datetime-local"
                      value={clockOut}
                      onChange={(e) => setClockOut(e.target.value)}
                    />
                  </label>
                  <label>
                    Correction reason
                    <input
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    Save clock correction
                  </button>
                  <button
                    className="back"
                    type="button"
                    onClick={() => {
                      setClockIn("");
                      setClockEdit(null);
                    }}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </section>
          ) : tab === "treatments" ? (
            <section className="panel">
              <h2>Treatment Permissions</h2>
              <p>
                {skills.length} treatments selected. Only selected treatments
                can be booked with this staff member.
              </p>
              <div className="staff-form-grid">
                <label>
                  Search treatments
                  <input
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                  />
                </label>
                <label>
                  Treatment category
                  <select
                    value={skillCategory}
                    onChange={(e) => setSkillCategory(e.target.value)}
                  >
                    {[
                      "All treatments",
                      ...new Set(treatments.map((t) => t.category)),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="record-actions">
                <button
                  className="secondary"
                  disabled={busy || draft.active === false}
                  onClick={() =>
                    setSkills([
                      ...new Set([
                        ...skills,
                        ...treatments
                          .filter(
                            (t) =>
                              (skillCategory === "All treatments" ||
                                t.category === skillCategory) &&
                              t.name
                                .toLowerCase()
                                .includes(skillSearch.toLowerCase()),
                          )
                          .map((t) => t.id),
                      ]),
                    ])
                  }
                >
                  Select visible treatments
                </button>
                <button
                  className="secondary"
                  disabled={busy || draft.active === false}
                  onClick={() => setSkills([])}
                >
                  Clear all selections
                </button>
              </div>
              <div className="skills-list">
                {treatments
                  .filter(
                    (t) =>
                      (skillCategory === "All treatments" ||
                        t.category === skillCategory) &&
                      t.name.toLowerCase().includes(skillSearch.toLowerCase()),
                  )
                  .map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        disabled={busy || draft.active === false}
                        checked={skills.includes(t.id)}
                        onChange={(e) =>
                          setSkills((ids) =>
                            e.target.checked
                              ? [...ids, t.id]
                              : ids.filter((id) => id !== t.id),
                          )
                        }
                      />
                      <span>
                        {t.name}
                        <small>{t.category}</small>
                      </span>
                    </label>
                  ))}
              </div>
              <button
                className="primary"
                disabled={busy || draft.active === false}
                onClick={() => void saveSkills()}
              >
                Save treatment permissions
              </button>
            </section>
          ) : tab === "archive" ? (
            <section className="panel">
              <h2>Archive Staff Member</h2>
              {draft.active === false ? (
                <p>
                  Archived · Date Left: {draft.date_left || "Not recorded"}. All
                  details and history are retained.
                </p>
              ) : (
                <>
                  <p>
                    Archiving removes the staff member from login profiles and
                    new booking availability. Their HR details and history
                    remain available here.
                  </p>
                  <label>
                    Date Left
                    <input
                      type="date"
                      required
                      max={dublinToday()}
                      min={draft.date_hired || undefined}
                      value={left}
                      onChange={(e) => setLeft(e.target.value)}
                    />
                  </label>
                  <label>
                    Archive reason
                    <input
                      required
                      value={archiveReason}
                      onChange={(e) => setArchiveReason(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || draft.id === ownStaffId}
                    onClick={() => void archive()}
                  >
                    Archive staff member
                  </button>
                  {draft.id === ownStaffId && (
                    <p>You cannot archive your own account.</p>
                  )}
                </>
              )}
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
