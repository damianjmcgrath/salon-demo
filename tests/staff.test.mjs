import test from "node:test";
import assert from "node:assert/strict";
import {
  demoClients,
  searchClients,
  openAppointments,
  effectiveBreaks,
  validateBreak,
  validTransition,
  shiftDate,
} from "../src/staffModel.js";
import { availableSlots } from "../src/availability.js";
import { canAccess, roleHome } from "../src/roles.js";
test("staff home opens the staff workspace without exposing reports", () => {
  assert.equal(roleHome("staff"), "staff-workspace");
  assert.equal(canAccess("staff", "staff-workspace"), true);
  assert.equal(canAccess("client", "staff-workspace"), false);
  assert.equal(canAccess("accountant", "staff-workspace"), false);
  assert.equal(canAccess("staff", "report"), false);
});
test("search supports individual fields, normalized phones and intersection of criteria", () => {
  assert.equal(
    searchClients(demoClients, { name: "EMMA", email: "", phone: "" })[0].id,
    "demo-emma",
  );
  assert.equal(
    searchClients(demoClients, { name: "", email: "grace@", phone: "" })[0].id,
    "demo-grace",
  );
  assert.equal(
    searchClients(demoClients, {
      name: "",
      email: "",
      phone: "0800 000 003",
    })[0].id,
    "demo-sophie",
  );
  assert.equal(
    searchClients(demoClients, { name: "Emma", email: "grace@", phone: "" })
      .length,
    0,
  );
  assert.throws(
    () => searchClients(demoClients, { name: "", email: "", phone: "" }),
    /at least one/,
  );
});
test("only open bookings for the selected client can be selected for editing", () => {
  const a = ["booked", "checked_in", "completed", "cancelled", "no_show"].map(
    (status, i) => ({ id: i, client_id: "a", status }),
  );
  a.push({ id: 6, client_id: "b", status: "booked" });
  assert.deepEqual(
    openAppointments(a, "a").map((a) => a.status),
    ["booked", "checked_in"],
  );
});
test("date-specific lunch overrides leave other staff and dates unchanged", () => {
  const override = {
    id: "lunch1",
    staff_id: 1,
    appointment_date: "2026-10-05",
    kind: "lunch",
    start_minute: 840,
    duration: 30,
    revision: 1,
  };
  const breaks = effectiveBreaks([1, 2], "2026-10-05", [override]);
  assert.equal(breaks.find((b) => b.staff_id === 1).start_minute, 840);
  assert.equal(breaks.find((b) => b.staff_id === 2).start_minute, 780);
  assert.equal(
    effectiveBreaks([1], "2026-10-06", [override])[0].start_minute,
    780,
  );
  assert.deepEqual(effectiveBreaks([1], "2026-10-11", [override]), []);
});
test("personal break validation rejects overlaps and allows adjacent periods", () => {
  const base = {
    staffId: 1,
    date: "2026-10-05",
    start: 810,
    end: 840,
    breakId: null,
    kind: "break",
    appointments: [],
    breaks: effectiveBreaks([1, 2], "2026-10-05", []),
  };
  assert.doesNotThrow(() => validateBreak(base));
  assert.throws(() => validateBreak({ ...base, start: 790 }), /another break/);
  assert.throws(
    () =>
      validateBreak({
        ...base,
        appointments: [
          {
            staff_id: 1,
            appointment_date: base.date,
            start_minute: 830,
            duration: 30,
            status: "booked",
          },
        ],
      }),
    /appointment/,
  );
  assert.doesNotThrow(() =>
    validateBreak({
      ...base,
      appointments: [
        {
          staff_id: 2,
          appointment_date: base.date,
          start_minute: 830,
          duration: 30,
          status: "booked",
        },
      ],
    }),
  );
  assert.throws(() => validateBreak({ ...base, staffId: null }), /mapped/);
});
test("amendment excludes own original slot but preserves other blocking appointments", () => {
  const own = {
      id: "own",
      staff_id: 1,
      start_minute: 600,
      duration: 60,
      status: "booked",
    },
    other = {
      id: "other",
      staff_id: 1,
      start_minute: 660,
      duration: 60,
      status: "booked",
    };
  const slots = availableSlots(
    60,
    [1],
    [own, other].filter((a) => a.id !== "own"),
    [],
  );
  assert(slots.some((s) => s.start_minute === 600));
  assert(!slots.some((s) => s.start_minute === 660));
});
test("no-show stays visible and blocks its original slot while cancellation frees it", () => {
  const a = { staff_id: 1, start_minute: 600, duration: 60, status: "no_show" };
  assert(!availableSlots(60, [1], [a], []).some((s) => s.start_minute === 600));
  assert(
    availableSlots(60, [1], [{ ...a, status: "cancelled" }], []).some(
      (s) => s.start_minute === 600,
    ),
  );
  assert(validTransition("booked", "no_show"));
  assert(!validTransition("completed", "no_show"));
  assert(!validTransition("no_show", "checked_in"));
  assert(validTransition("checked_in", "cancelled"));
});
test("day arrows cross month and year boundaries correctly", () => {
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
});
