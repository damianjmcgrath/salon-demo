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
  assert(slots.some((s) => s.start_minute === 810));
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
