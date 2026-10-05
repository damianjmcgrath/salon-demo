import type { StaffRecord, DayShift } from "./domain";
export function seedStaffRecords(ids: number[]): StaffRecord[] {
  return [
    {
      id: 1,
      staff_id: 1,
      name: "Aoife",
      first_name: "Aoife",
      last_name: "",
      role: "admin",
      profile_key: "aoife",
      photo_url: "./images/aoife.webp",
    },
    {
      id: 2,
      staff_id: 2,
      name: "Leah",
      first_name: "Leah",
      last_name: "",
      role: "staff",
      profile_key: "leah",
      photo_url: "./images/leah.webp",
    },
  ].map((s) => ({
    ...s,
    active: true,
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
    pin_set: true,
    demo_pin: "1234",
    treatment_ids: ids,
  }));
}
export const dublinToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const addDays = (date: string, n: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const minute = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};
export const hhmm = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export function localClockInput(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const v = (k: string) => parts.find((p) => p.type === k)?.value;
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}
export function clockISO(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw Error("Enter a valid clock time.");
  const nominal = Date.parse(value + ":00Z");
  for (const offset of [60, 0]) {
    const candidate = new Date(nominal - offset * 60000).toISOString();
    if (localClockInput(candidate) === value) return candidate;
  }
  throw Error("That local time does not exist because of the clock change.");
}
export function localShift(
  records: StaffRecord[],
  days: DayShift[],
  staffId: number,
  date: string,
) {
  const saved = days.find(
    (s) => s.staff_id === staffId && s.shift_date === date,
  );
  if (saved) return saved;
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  const existing = staffId <= 2 && records.some((s) => s.id === staffId);
  return {
    staff_id: staffId,
    shift_date: date,
    start_minute: existing && weekday !== 0 ? 540 : null,
    end_minute: existing && weekday !== 0 ? 1020 : null,
    revision: 0,
  };
}
