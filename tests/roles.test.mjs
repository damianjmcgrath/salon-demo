import test from "node:test";
import assert from "node:assert/strict";
import { canAccess, roleHome, normalizeRole } from "../src/roles.js";
test("customers never get staff diary or financial reporting", () => {
  for (const view of ["diary", "report", "workspace"])
    assert.equal(canAccess("client", view), false);
  assert.equal(canAccess("client", "my-bookings"), true);
});
test("accountant is reporting only; staff cannot see management reports", () => {
  assert.equal(canAccess("accountant", "report"), true);
  for (const view of ["diary", "workspace", "book", "my-bookings"])
    assert.equal(canAccess("accountant", view), false);
  assert.equal(canAccess("staff", "diary"), true);
  assert.equal(canAccess("staff", "report"), false);
});
test("admin and IT share operational access with distinct role identities", () => {
  for (const role of ["admin", "it_support"])
    for (const view of ["diary", "workspace", "report"])
      assert.equal(canAccess(role, view), true);
  assert.equal(roleHome("accountant"), "report");
  assert.equal(roleHome("staff"), "diary");
  assert.equal(normalizeRole("superuser"), null);
  assert.equal(canAccess(null, "diary"), false);
});

test("client login opens booking and anonymous users cannot book", () => {
  assert.equal(roleHome("client"), "book");
  assert.equal(canAccess(null, "book"), false);
});
