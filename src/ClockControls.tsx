import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalStaffData, WorkSession } from "./domain";
const displayTime = (date: string) =>
  new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
export default function ClockControls({
  live,
  db,
  data,
  setData,
  userId,
  staffId,
  name,
}: {
  live: boolean;
  db: SupabaseClient | null;
  data: LocalStaffData;
  setData: Dispatch<SetStateAction<LocalStaffData>>;
  userId: string;
  staffId: number | null;
  name: string;
}) {
  const [active, setActive] = useState<WorkSession | null>(null),
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
      setActive(
        (data.shifts || []).find(
          (s) => s.staff_id === staffId && !s.clocked_out_at,
        ) || null,
      );
      setBusy(false);
      return;
    }
    if (!db) return;
    setBusy(true);
    db.rpc("get_my_shift").then(({ data, error }) => {
      if (stopped) return;
      setBusy(false);
      if (error) setError(error.message);
      else setActive(data?.id ? data : null);
    });
    return () => {
      stopped = true;
    };
  }, [live, db, userId, data.shifts]);
  async function clock(out: boolean) {
    setBusy(true);
    setError("");
    try {
      let s: WorkSession;
      if (live && db) {
        const r = await db.rpc(out ? "clock_out" : "clock_in");
        if (r.error) throw r.error;
        if (!alive.current) return;
        s = r.data;
        setActive(out ? null : s);
      } else {
        if (!staffId) throw Error("Your account needs a diary mapping.");
        if (out && !active) throw Error("Clock in before clocking out.");
        if (!out && active) throw Error("You are already clocked in.");
        s = out
          ? { ...active!, clocked_out_at: new Date().toISOString() }
          : {
              id: crypto.randomUUID(),
              user_id: userId,
              staff_id: staffId,
              staff_name: name,
              clocked_in_at: new Date().toISOString(),
              clocked_out_at: null,
            };
        setData((d) => ({
          ...d,
          shifts: out
            ? (d.shifts || []).map((x) => (x.id === s.id ? s : x))
            : [...(d.shifts || []), s],
          activity: [
            ...d.activity,
            {
              id: crypto.randomUUID(),
              action: out ? "staff_clocked_out" : "staff_clocked_in",
              created_at: new Date().toISOString(),
              actor_name: name,
              details: {
                session_id: s.id,
                clocked_in_at: s.clocked_in_at,
                clocked_out_at: s.clocked_out_at,
              },
            },
          ],
        }));
        setActive(out ? null : s);
      }
      setMessage(
        `${name} clocked ${out ? "out" : "in"} at ${displayTime(out ? s.clocked_out_at! : s.clocked_in_at)}.`,
      );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="clock-bar" aria-label="Staff attendance">
      <div className="clock-buttons">
        <button
          className="clock-button"
          disabled={busy || !!active || !staffId}
          onClick={() => void clock(false)}
        >
          Clock-In
        </button>
        <button
          className="clock-button"
          disabled={busy || !active}
          onClick={() => void clock(true)}
        >
          Clock-Out
        </button>
      </div>
      <span>
        {active
          ? `${name} · Clocked in ${displayTime(active.clocked_in_at)}`
          : `${name} · Not clocked in`}
      </span>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
    </section>
  );
}
