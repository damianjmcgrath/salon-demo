export const demoClients = [
  {
    id: "demo-emma",
    name: "Emma Demo",
    email: "emma@example.com",
    phone: "0800000001",
    revision: 0,
  },
  {
    id: "demo-grace",
    name: "Grace Demo",
    email: "grace@example.com",
    phone: "0800000002",
    revision: 0,
  },
  {
    id: "demo-sophie",
    name: "Sophie Demo",
    email: "sophie@example.com",
    phone: "0800000003",
    revision: 0,
  },
];
export function searchClients(clients, query) {
  const name = query.name.trim().toLowerCase(),
    email = query.email.trim().toLowerCase(),
    phone = query.phone.replace(/\D/g, "");
  if (!name && !email && !phone)
    throw Error("Enter at least one search field.");
  return clients.filter(
    (c) =>
      (!name || c.name.toLowerCase().includes(name)) &&
      (!email || c.email.toLowerCase().includes(email)) &&
      (!phone || c.phone.replace(/\D/g, "").includes(phone)),
  );
}
export function openAppointments(appointments, clientId) {
  return appointments.filter(
    (a) =>
      a.client_id === clientId && ["booked", "checked_in"].includes(a.status),
  );
}
export function shiftDate(date, days) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function effectiveBreaks(staffIds, date, overrides) {
  if (new Date(date + "T12:00:00Z").getUTCDay() === 0) return [];
  return staffIds.flatMap((staff_id) => {
    const own = overrides.filter(
      (b) => b.staff_id === staff_id && b.appointment_date === date,
    );
    return own.some((b) => b.kind === "lunch")
      ? own
      : [
          {
            id: null,
            staff_id,
            appointment_date: date,
            start_minute: 780,
            duration: 30,
            kind: "lunch",
            revision: 0,
          },
          ...own,
        ];
  });
}
export function validateBreak({
  staffId,
  date,
  start,
  end,
  breakId,
  kind,
  appointments,
  breaks,
}) {
  if (!staffId)
    throw Error("Your account must be mapped to a staff diary column.");
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 540 ||
    end > 1020 ||
    end <= start ||
    new Date(date + "T12:00:00Z").getUTCDay() === 0
  )
    throw Error("Break must fit inside your working day.");
  const overlap = (b) =>
    start < b.start_minute + b.duration && end > b.start_minute;
  if (
    appointments.some(
      (a) =>
        a.staff_id === staffId &&
        a.appointment_date === date &&
        a.status !== "cancelled" &&
        overlap(a),
    )
  )
    throw Error("Break overlaps an appointment.");
  if (
    breaks.some(
      (b) =>
        b.staff_id === staffId &&
        (b.appointment_date == null || b.appointment_date === date) &&
        (breakId === null || b.id !== breakId) &&
        !(kind === "lunch" && b.kind === "lunch") &&
        overlap(b),
    )
  )
    throw Error("Break overlaps another break.");
}
export function validTransition(from, to) {
  return (
    (from === "booked" &&
      ["checked_in", "cancelled", "no_show"].includes(to)) ||
    (from === "checked_in" && ["completed", "cancelled"].includes(to))
  );
}
