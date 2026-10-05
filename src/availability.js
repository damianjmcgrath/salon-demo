/** @param {Array<{staff_id:number,start_minute:number|null,end_minute:number|null}>|null} workingHours */
export function availableSlots(
  duration,
  staffIds,
  appointments,
  breaks,
  interval = startInterval(duration),
  workingHours = null,
) {
  const slots = [];
  for (
    let start = workingHours ? 0 : 540;
    start + duration <= (workingHours ? 1440 : 1020);
    start += interval
  ) {
    for (const staffId of staffIds) {
      if (
        workingHours &&
        !workingHours.some(
          (s) =>
            s.staff_id === staffId &&
            s.start_minute !== null &&
            start >= s.start_minute &&
            start + duration <= s.end_minute,
        )
      )
        continue;
      const blocked = [
        ...appointments.filter(
          (a) => a.staff_id === staffId && a.status !== "cancelled",
        ),
        ...breaks.filter((b) => b.staff_id === staffId),
      ];
      if (
        !blocked.some(
          (a) =>
            start < a.start_minute + a.duration &&
            start + duration > a.start_minute,
        )
      )
        slots.push({ start_minute: start, staff_id: staffId });
    }
  }
  return slots;
}

export function startInterval(duration) {
  return duration === 60 ? 60 : duration === 30 ? 30 : duration < 15 ? 5 : 15;
}
export function periodSlots(slots, period) {
  return slots.filter((s) =>
    period === "morning"
      ? s.start_minute >= 480 && s.start_minute < 720
      : period === "afternoon"
        ? s.start_minute >= 720
        : false,
  );
}
export function attendedTreatmentIds(bookings) {
  return [
    ...new Set(
      bookings
        .filter(
          (a) =>
            a.status === "completed" &&
            a.booked_for_self !== false &&
            a.treatment_id != null,
        )
        .map((a) => a.treatment_id),
    ),
  ];
}
