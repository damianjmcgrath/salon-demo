import test from "node:test";
import assert from "node:assert/strict";
import { availableSlots } from "../src/availability.js";
test("appointment overlap blocked but adjacent appointment allowed", () => {
  const slots = availableSlots(
    60,
    [1],
    [{ staff_id: 1, start_minute: 600, duration: 60, status: "booked" }],
    [],
  );
  assert(slots.some((s) => s.start_minute === 540));
  assert(!slots.some((s) => s.start_minute === 550));
  assert(!slots.some((s) => s.start_minute === 600));
  assert(slots.some((s) => s.start_minute === 660));
});
test("breaks and closing time constrain a long treatment", () => {
  const slots = availableSlots(
    60,
    [1],
    [],
    [{ staff_id: 1, start_minute: 780, duration: 30 }],
  );
  assert(!slots.some((s) => s.start_minute === 730));
  assert(slots.some((s) => s.start_minute === 840));
  assert(slots.every((s) => s.start_minute + 60 <= 1020));
});
test("no preference includes other staff and cancellation frees time", () => {
  const slots = availableSlots(
    30,
    [1, 2],
    [
      { staff_id: 1, start_minute: 540, duration: 30, status: "booked" },
      { staff_id: 2, start_minute: 540, duration: 30, status: "cancelled" },
    ],
    [],
  );
  assert(!slots.some((s) => s.staff_id === 1 && s.start_minute === 540));
  assert(slots.some((s) => s.staff_id === 2 && s.start_minute === 540));
});

test("duration aligns starts to hour, half hour or quarter hour", () => {
  for (const [duration, grid] of [
    [60, 60],
    [30, 30],
    [15, 15],
  ]) {
    const slots = availableSlots(duration, [1], [], []);
    assert(slots.length > 0);
    assert(slots.every((s) => s.start_minute % grid === 0));
  }
});
test("period is mandatory and midday belongs to afternoon", async () => {
  const { periodSlots } = await import("../src/availability.js");
  const slots = [479, 480, 719, 720, 780, 959, 960, 1019, 1020, 1199, 1200].map(
    (start_minute) => ({
      start_minute,
      staff_id: 1,
    }),
  );
  assert.deepEqual(periodSlots(slots, ""), []);
  assert.deepEqual(
    periodSlots(slots, "morning").map((s) => s.start_minute),
    [480, 719],
  );
  assert.deepEqual(
    periodSlots(slots, "afternoon").map((s) => s.start_minute),
    [720, 780, 959, 960, 1019],
  );
  assert.deepEqual(
    periodSlots(slots, "evening").map((s) => s.start_minute),
    [1020, 1199],
  );
});
test("previous treatments include only attended self bookings and deduplicate", async () => {
  const { attendedTreatmentIds } = await import("../src/availability.js");
  assert.deepEqual(
    attendedTreatmentIds([
      { treatment_id: 1, status: "completed", booked_for_self: true },
      { treatment_id: 1, status: "completed" },
      { treatment_id: 2, status: "completed", booked_for_self: false },
      { treatment_id: 3, status: "booked" },
    ]),
    [1],
  );
});
