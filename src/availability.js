export function availableSlots(
  duration,
  staffIds,
  appointments,
  breaks,
  interval = 10,
) {
  const slots = [];
  for (let start = 540; start + duration <= 1020; start += interval) {
    for (const staffId of staffIds) {
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
