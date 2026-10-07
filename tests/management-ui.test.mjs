import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import React from "react";
let dom,
  dir,
  Treatment,
  Permission,
  Values,
  Patch,
  VoucherReport,
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup;
before(async () => {
  dom = new JSDOM("<html><body></body></html>", {
    url: "https://salon.example/",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ render, screen, fireEvent, waitFor, cleanup } =
    await import("@testing-library/react"));
  dir = await mkdtemp(new URL("../.management-test-", import.meta.url));
  for (const name of [
    "TreatmentManagement",
    "PermissionManagement",
    "ClientValues",
    "ClientPatchTests",
    "VoucherStatusReport",
  ])
    await build({
      entryPoints: [
        new URL("../src/" + name + ".tsx", import.meta.url).pathname,
      ],
      outfile: dir + "/" + name + ".mjs",
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      jsx: "automatic",
    });
  Treatment = (await import(pathToFileURL(dir + "/TreatmentManagement.mjs")))
    .default;
  Permission = (await import(pathToFileURL(dir + "/PermissionManagement.mjs")))
    .default;
  Values = (await import(pathToFileURL(dir + "/ClientValues.mjs"))).default;
  Patch = (await import(pathToFileURL(dir + "/ClientPatchTests.mjs"))).default;
  VoucherReport = (
    await import(pathToFileURL(dir + "/VoucherStatusReport.mjs"))
  ).default;
});
afterEach(() => cleanup());
after(async () => {
  dom.window.close();
  await rm(dir, { recursive: true, force: true });
});
test("treatment edit submits name, description, price, duration and patch test flag with its revision", async () => {
  const row = {
    id: 1,
    name: "Original",
    category: "Brows",
    description: "",
    price: 20,
    duration: 30,
    patch_required: false,
    revision: 2,
  };
  const calls = [];
  const q = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    then(fn) {
      return Promise.resolve({ data: [row], error: null }).then(fn);
    },
  };
  const db = {
    from: () => q,
    rpc: async (name, args) => {
      calls.push([name, args]);
      return {
        data: {
          ...row,
          name: args.p_name,
          description: args.p_description,
          price: args.p_price,
          duration: args.p_duration,
          patch_required: args.p_patch_required,
          revision: 3,
        },
      };
    },
  };
  render(React.createElement(Treatment, { db, onHome() {}, onChanged() {} }));
  fireEvent.click(await screen.findByRole("button", { name: /Original/ }));
  for (const [label, value] of [
    ["Treatment name", "Updated"],
    ["Description", "Better description"],
    ["Length (minutes)", "45"],
    ["Price (€)", "35.50"],
    ["Patch test required", "yes"],
    ["Booking guarantee required", "no"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save Treatment" }));
  await screen.findByRole("status");
  assert.deepEqual(calls[0], [
    "save_treatment",
    {
      p_id: 1,
      p_name: "Updated",
      p_description: "Better description",
      p_duration: 45,
      p_price: 35.5,
      p_patch_required: true,
      p_revision: 2,
      p_guarantee_required: false,
    },
  ]);
});
test("admin Permission Management is locked on and staff action changes submit for the selected profile", async () => {
  const members = [
    {
      id: 1,
      name: "Aoife",
      role: "admin",
      revision: 0,
      permissions: { "view.permissions": true, "perform.waive_fees": true },
    },
    {
      id: 2,
      name: "Leah",
      role: "staff",
      revision: 4,
      permissions: { "view.diary": true, "perform.waive_fees": true },
    },
  ];
  let saved;
  const db = {
    rpc: async (name, args) =>
      name === "list_staff_permissions"
        ? { data: members }
        : { data: null, ...((saved = args), {}) },
  };
  render(React.createElement(Permission, { db, onHome() {}, onChanged() {} }));
  await screen.findByText("Can View");
  const locked = screen.getByLabelText(
    /Permission Management \(required for Admin\)/,
  );
  assert(locked.checked && locked.disabled);
  fireEvent.change(screen.getByLabelText("Staff member"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByLabelText("Can Waive No Show Fees"));
  fireEvent.click(screen.getByRole("button", { name: "Save Permissions" }));
  await screen.findByRole("status");
  assert.equal(saved.p_staff, 2);
  assert.equal(saved.p_revision, 4);
  assert.equal(saved.p_grants["perform.waive_fees"], false);
});
test("credit note history is readable without displaying a forbidden create action", async () => {
  const db = {
    rpc: async () => ({
      data: { vouchers: [], credit_notes: [], redemptions: [] },
      error: null,
    }),
  };
  render(
    React.createElement(Values, {
      db,
      kind: "credit",
      clientId: "client",
      onSaved() {},
      canCreate: false,
    }),
  );
  await screen.findByText("No active credit notes.");
  assert.equal(
    screen.queryByRole("button", { name: "Create New Credit Note" }),
    null,
  );
});

test("patch checkout form opens with intended treatment selected and allows additional coverage before saving", async () => {
  const treatments = [
    { id: 8001, name: "Intended", category: "Brows" },
    { id: 8002, name: "Additional", category: "Brows" },
    { id: 69, name: "PATCH TEST", category: "PATCH TEST" },
  ];
  let saved;
  const q = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    then(fn) {
      return Promise.resolve({ data: [], error: null }).then(fn);
    },
  };
  const db = {
    from: () => q,
    rpc: async (name, args) => {
      saved = args;
      return {
        data: {
          id: "record",
          staff_name: "Aoife",
          recorded_at: new Date().toISOString(),
          treatments_covered: treatments.filter((t) =>
            args.p_treatments.includes(t.id),
          ),
        },
        error: null,
      };
    },
  };
  render(
    React.createElement(Patch, {
      db,
      clientId: "attendee",
      treatments,
      staff: [{ id: 1, name: "Aoife" }],
      initiallyRecord: true,
      initialTreatmentId: 8001,
      initialStaffId: 1,
      onSaved() {},
    }),
  );
  assert(screen.getByLabelText("Intended").checked);
  assert(!screen.getByLabelText("Additional").checked);
  assert.equal(screen.queryByLabelText("PATCH TEST"), null);
  await waitFor(() => assert(!screen.getByLabelText("Additional").disabled));
  fireEvent.click(screen.getByLabelText("Additional"));
  fireEvent.click(screen.getByRole("button", { name: "Save Patch Test" }));
  await waitFor(() => assert.equal(saved?.p_client, "attendee"));
  assert.deepEqual(saved.p_treatments, [8001, 8002]);
  assert.equal(saved.p_staff, 1);
  await screen.findByRole("button", { name: "Record Patch Test" });
  assert(screen.getByText("Intended, Additional"));
});

test("completed patch coverage is disabled with its latest date and category selection saves only new treatments", async () => {
  const treatments = [
    { id: 1, name: "Done", category: "Brows" },
    { id: 2, name: "New", category: "Brows" },
  ];
  let saved;
  const history = [
    {
      id: "older",
      recorded_at: "2026-01-01T09:30:00Z",
      staff_name: "Aoife",
      treatments_covered: [treatments[0]],
    },
    {
      id: "latest",
      recorded_at: "2026-02-03T14:05:00Z",
      staff_name: "Leah",
      treatments_covered: [treatments[0]],
    },
  ];
  const q = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    then(fn) {
      return Promise.resolve({ data: history, error: null }).then(fn);
    },
  };
  const db = {
    from: () => q,
    rpc: async (name, args) => {
      saved = args;
      return {
        data: {
          id: "new",
          recorded_at: new Date().toISOString(),
          staff_name: "Aoife",
          treatments_covered: [treatments[1]],
        },
        error: null,
      };
    },
  };
  render(
    React.createElement(Patch, {
      db,
      clientId: "client",
      treatments,
      staff: [{ id: 1, name: "Aoife" }],
      initiallyRecord: true,
      initialTreatmentId: 1,
      initialStaffId: 1,
      onSaved() {},
    }),
  );
  const done = await screen.findByLabelText(
    "Done (already completed on 03/02/2026 14:05)",
  );
  assert(done.disabled);
  assert(done.closest("label").classList.contains("patch-completed"));
  assert(screen.getByText("0 treatments selected"));
  fireEvent.click(screen.getByLabelText("Select all in Brows"));
  assert(screen.getByLabelText("New").checked);
  assert(screen.getByText("1 treatments selected"));
  fireEvent.click(screen.getByRole("button", { name: "Save Patch Test" }));
  await waitFor(() => assert.deepEqual(saved?.p_treatments, [2]));
  fireEvent.click(
    await screen.findByRole("button", { name: "Record Patch Test" }),
  );
  assert(screen.getByLabelText("Select all in Brows").disabled);
});

test("voucher report filters partial and full use and exports the selected view with matching dates", async () => {
  const usage = {
    used_at: "2026-01-01T10:00:00Z",
    treatment_name: "Brow Treatment",
    appointment_date: "2026-10-07",
    start_minute: 600,
  };
  const base = {
    purchased_at: "2026-01-01T09:00:00Z",
    purchased_by: "Buyer",
    purchased_for: "Recipient",
  };
  const rows = [
    {
      ...base,
      id: "part",
      code: "PART-100",
      original_amount: 100,
      redeemed_amount: 20,
      balance: 80,
      uses: [usage],
    },
    {
      ...base,
      id: "full",
      code: "FULL-50",
      original_amount: 50,
      redeemed_amount: 50,
      balance: 0,
      uses: [usage],
    },
    {
      ...base,
      id: "open",
      code: "OPEN-25",
      original_amount: 25,
      redeemed_amount: 0,
      balance: 25,
      uses: [],
    },
  ];
  render(
    React.createElement(VoucherReport, {
      db: { rpc: async () => ({ data: rows, error: null }) },
      onBack() {},
    }),
  );
  await screen.findByText("PART-100");
  assert(screen.getByText("€175.00"));
  assert(screen.getByText("€70.00"));
  assert(screen.getByText("€105.00"));
  assert(screen.getAllByText("07/10/26 10:00").length === 2);
  fireEvent.change(screen.getByLabelText("Voucher filter"), {
    target: { value: "used" },
  });
  assert.equal(screen.queryByText("OPEN-25"), null);
  assert(screen.getByText("Part"));
  assert(screen.getByText("Full"));
  const oldCreate = URL.createObjectURL,
    oldRevoke = URL.revokeObjectURL,
    oldClick = window.HTMLAnchorElement.prototype.click;
  let blob;
  URL.createObjectURL = (b) => {
    blob = b;
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  try {
    fireEvent.click(screen.getByRole("button", { name: "Export to CSV" }));
    let csv = await blob.text();
    assert(csv.includes("PART-100"));
    assert(csv.includes("FULL-50"));
    assert(!csv.includes("OPEN-25"));
    assert(csv.includes("07/10/26 10:00"));
    fireEvent.change(screen.getByLabelText("Voucher filter"), {
      target: { value: "open" },
    });
    assert(screen.getByText("OPEN-25"));
    assert.equal(screen.queryByText("FULL-50"), null);
    fireEvent.click(screen.getByRole("button", { name: "Export to CSV" }));
    csv = await blob.text();
    assert(csv.includes("PART-100"));
    assert(csv.includes("OPEN-25"));
    assert(!csv.includes("FULL-50"));
  } finally {
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
    window.HTMLAnchorElement.prototype.click = oldClick;
  }
});
