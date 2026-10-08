export type CalendarBooking = { id: string; appointment_date: string; start_minute: number; duration: number; treatment_name: string; staff_name?: string };
const address = 'Williams St., Mulladrillen, Ardee, Co. Louth A92 HW30';
// Convert Ireland wall-clock time to UTC, including winter/summer offsets.
function instant(date: string, minute: number) {
  const wall = Date.parse(date + 'T00:00:00Z') + minute * 60000;
  let utc = wall;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utc));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    utc += wall - represented;
  }
  return new Date(utc).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function fold(line: string) {
  let result = '', count = 0;
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length;
    if (count + bytes > 75) { result += '\r\n '; count = 1; }
    result += char; count += bytes;
  }
  return result;
}
export function bookingCalendar(b: CalendarBooking) {
  const start = instant(b.appointment_date, b.start_minute);
  const end = instant(b.appointment_date, b.start_minute + b.duration);
  const title = `${b.treatment_name} — Sculpted by Aoife Clare`;
  const description = `With: ${b.staff_name || 'Salon team'}\nBooking reference: ${b.id}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${start}/${end}`, details: description, location: address, ctz: 'Europe/Dublin' });
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sculpted//Salon Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${escape(b.id)}@sculpted-salon`, `DTSTAMP:${start}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${escape(title)}`, `DESCRIPTION:${escape(description)}`, `LOCATION:${escape(address)}`, 'END:VEVENT', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
  const base64 = btoa(Array.from(new TextEncoder().encode(ics), byte => String.fromCharCode(byte)).join(''));
  return { google: `https://calendar.google.com/calendar/render?${params}`, ics, base64, download: `https://damianjmcgrath.github.io/salon-demo/calendar.html#${encodeURIComponent(base64)}` };
}
