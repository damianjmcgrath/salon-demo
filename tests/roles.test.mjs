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
test("admin has operational access and IT Support is retired", () => {
  for (const role of ["admin"])
    for (const view of ["diary", "staff-workspace", "report"])
      assert.equal(canAccess(role, view), true);
  assert.equal(roleHome("accountant"), "reporting-home");
  assert.equal(roleHome("staff"), "staff-workspace");
  assert.equal(normalizeRole("superuser"), null);
  assert.equal(canAccess(null, "diary"), false);
});

test("client login opens booking and anonymous users cannot book", () => {
  assert.equal(roleHome("client"), "book");
  assert.equal(canAccess(null, "book"), false);
});

test("retired IT Support has no access", () => {
  assert.equal(normalizeRole("it_support"), null);
  assert.equal(canAccess("it_support", "diary"), false);
});
test("profile and voucher purchase screens are client-only", () => {
  for (const view of ["my-profile", "voucher-purchase", "multiple-bookings"]) {
    assert(canAccess("client", view));
    for (const role of ["staff", "admin", "accountant", null])
      assert.equal(canAccess(role, view), false);
  }
});

test('explicit page permissions allow delegation and override admin page defaults',()=>{
 assert.equal(canAccess('staff','staff-admin',{'view.staff':true}),true);
 assert.equal(canAccess('staff','reporting-placeholder',{'view.reporting':true}),true);
 assert.equal(canAccess('admin','treatment-management',{'view.treatments':false}),false);
 assert.equal(canAccess('staff','diary',{'view.diary':false}),false);
 assert.equal(canAccess('client','permission-management',{'view.permissions':true}),false);
});
