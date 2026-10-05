import test from "node:test";
import assert from "node:assert/strict";
import { availableSlots } from "../src/availability.js";
test("shift hours admit 8am appointments and off days admit none", () => {
  const shifts = [
    { staff_id: 4, start_minute: 480, end_minute: 660 },
    { staff_id: 5, start_minute: null, end_minute: null },
  ];
  const slots = availableSlots(60, [4, 5], [], [], undefined, shifts);
  assert.deepEqual(slots, [
    { start_minute: 480, staff_id: 4 },
    { start_minute: 540, staff_id: 4 },
    { start_minute: 600, staff_id: 4 },
  ]);
});
