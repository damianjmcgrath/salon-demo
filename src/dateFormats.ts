/** Human-readable dates. ISO values remain unchanged for storage and date inputs. */
export function displayDate(value: string | null | undefined, friendly = false): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin", day: "2-digit", month: friendly ? "short" : "2-digit", year: "numeric",
  }).formatToParts(d);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return [part("day"),friendly ? part("month").slice(0,3) : part("month"),part("year")].join(friendly ? "-" : "/");
}
export const voucherDate = (value: string | null | undefined) => displayDate(value, true);
export function displayDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${displayDate(value)} ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d)}`;
}
/** Format date values in expanded audit details without changing stored records. */
export function displayHistoryValue(_key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return displayDate(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return displayDateTime(value);
  return value;
}

export function appointmentDate(value: string): string {
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/Dublin", day: "2-digit", month: "long", year: "numeric"}).formatToParts(d);
  return ["day", "month", "year"].map(type => parts.find(p => p.type === type)?.value || "").join("-");
}
