// Offline DOM interaction tests: actual React screens and forms, without a browser or network.
import { before, after, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React from "react";
let render, screen, fireEvent, cleanup, waitFor, within, App, buildDir, dom;
const ActualDate = Date;
class DemoDate extends ActualDate {
  constructor(...args) {
    super(...(args.length ? args : ["2026-10-05T14:00:00Z"]));
  }
  static now() {
    return new ActualDate("2026-10-05T14:00:00Z").getTime();
  }
}

before(async () => {
  globalThis.Date = DemoDate;
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://salon.example/?portal=staff",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ render, screen, fireEvent, cleanup, waitFor, within } =
    await import("@testing-library/react"));
  buildDir = await mkdtemp(new URL("../.ui-test-", import.meta.url));
  const out = buildDir + "/app.mjs";
  await build({
    entryPoints: [new URL("../src/App.tsx", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: out,
    define: { "import.meta.env": "{}" },
    jsx: "automatic",
  });
  App = (await import(pathToFileURL(out))).default;
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  render(React.createElement(React.StrictMode, null, React.createElement(App)));
});
afterEach(() => {
  cleanup();
});
after(async () => {
  await rm(buildDir, { recursive: true, force: true });
  dom.window.close();
  globalThis.Date = ActualDate;
});
async function login(name = /Leah/) {
  fireEvent.click(screen.getByRole("button", { name }));
  fireEvent.change(screen.getByLabelText("4-digit demo PIN"), {
    target: { value: "1234" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open demo workspace" }));
  await screen.findByRole("heading", { name: "Your salon workspace." });
}
async function findEmma() {
  fireEvent.click(
    screen.getByRole("button", { name: /Client Administration/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Search for a Client/ }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Emma" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: /Emma Demo/ }));
  await screen.findByRole("heading", { name: "Emma Demo", exact: true });
}
test("UI: staff tiles, PIN preview, home tiles and profile locking work", async () => {
  assert(screen.getByRole("heading", { name: "Select a Staff Profile" }));
  await login();
  for (const name of [
    "Appointment Management",
    "Client Administration",
    "Staff Diary",
  ])
    assert(screen.getByRole("heading", { name, exact: true }));
  fireEvent.click(
    screen.getByRole("button", { name: "Switch profile / lock" }),
  );
  await screen.findByRole("heading", { name: "Select a Staff Profile" });
  assert.equal(
    screen.queryByRole("heading", { name: "Your salon workspace." }),
    null,
  );
  await login(/Leah/);
  assert(screen.getByText(/STAFF PORTAL · Leah/));
});
test("UI: client search, audited contact edit, notes and cancellation", async () => {
  await login();
  await findEmma();
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Emma Updated" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await screen.findByRole("heading", { name: "Emma Updated" });
  fireEvent.change(screen.getByLabelText("Add a note"), {
    target: { value: "Prefers morning appointments." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByText("Prefers morning appointments.");
  fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  const dialog = screen.getByRole("dialog", { name: "Cancel appointment" });
  fireEvent.change(within(dialog).getByLabelText("Reason"), {
    target: { value: "Client called to cancel" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Cancel appointment" }),
  );
  await waitFor(() =>
    assert(!screen.queryByRole("dialog", { name: "Cancel appointment" })),
  );
  const stored = JSON.parse(localStorage.getItem("sculpted-demo-v1"));
  assert.equal(stored.find((a) => a.id === "sample-1").status, "cancelled");
  const data = JSON.parse(localStorage.getItem("sculpted-staff-data-v1"));
  assert(data.activity.some((a) => a.action === "client_updated"));
  assert(
    data.activity.some((a) => a.details.reason === "Client called to cancel"),
  );
  assert.equal(data.notes[0].author_name, "Leah");
});
test("UI: new-client booking reuses treatment/time/guarantee flow and sidebar Continue", async () => {
  await login();
  fireEvent.click(
    screen.getByRole("button", { name: /Appointment Management/ }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: /Book a New Appointment for a New Client/,
    }),
  );
  fireEvent.change(screen.getByLabelText("Full name"), {
    target: { value: "New Demo" },
  });
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "new@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Phone number"), {
    target: { value: "0800000009" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create client & choose treatment" }),
  );
  await screen.findByRole("heading", { name: "Explore treatments" });
  assert.equal(
    screen.queryByRole("button", { name: /Previous Bookings/ }),
    null,
  );
  fireEvent.click(screen.getByRole("button", { name: /BIAB \/ BIAB Refill/ }));
  assert.equal(document.querySelectorAll(".slots button").length, 0);
  fireEvent.click(screen.getByRole("button", { name: /Morning ·/ }));
  await waitFor(() =>
    assert(document.querySelectorAll(".slots button").length > 0),
  );
  fireEvent.click(document.querySelector(".slots button"));
  const summary = document.querySelector(".summary");
  fireEvent.click(within(summary).getByRole("button", { name: "Continue →" }));
  await screen.findByRole("heading", { name: "Booking Guarantee" });
  fireEvent.change(screen.getByLabelText("Card for your guarantee"), {
    target: { value: "new_demo" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm appointment" }));
  await screen.findByText("YOU’RE ALL BOOKED");
  const record = JSON.parse(localStorage.getItem("sculpted-demo-v1")).find(
    (a) => a.client_name === "New Demo",
  );
  assert(record.client_id);
  assert.equal(record.start_minute % 60, 0);
  fireEvent.click(screen.getByRole("button", { name: "Back to staff home" }));
  await screen.findByRole("heading", { name: "Your salon workspace." });
});
test("UI: diary hides staff takings, has date arrows, and changes only own daily lunch", async () => {
  await login();
  fireEvent.click(screen.getByRole("button", { name: /Staff Diary Today/ }));
  assert.equal(screen.queryByText("Recorded takings"), null);
  assert(screen.getByText("Appointments scheduled for today"));
  assert(screen.getByText("Appointments completed so far today"));
  const date = screen.getByLabelText("Diary date"),
    original = date.value;
  fireEvent.click(screen.getByRole("button", { name: "Next day" }));
  assert.notEqual(date.value, original);
  fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
  assert.equal(date.value, original);
  const lunches = screen.getAllByRole("button", {
    name: "Lunch · 13:00–13:30",
  });
  assert.equal(lunches.filter((b) => !b.disabled).length, 1);
  fireEvent.click(lunches.find((b) => !b.disabled));
  const dialog = screen.getByRole("dialog", { name: "Personal break" });
  fireEvent.change(within(dialog).getByLabelText("Start"), {
    target: { value: "12:30" },
  });
  fireEvent.change(within(dialog).getByLabelText("End"), {
    target: { value: "13:00" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save break time" }),
  );
  await waitFor(() =>
    assert(!screen.queryByRole("dialog", { name: "Personal break" })),
  );
  assert(screen.getByRole("button", { name: "Lunch · 12:30–13:00" }));
  assert.equal(
    screen.getAllByRole("button", { name: "Lunch · 13:00–13:30" }).length,
    1,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add break time" }));
  const additional = screen.getByRole("dialog", { name: "Personal break" });
  fireEvent.click(
    within(additional).getByRole("button", { name: "Save break time" }),
  );
  await screen.findByRole("button", { name: "Break · 14:00–14:15" });
});

test("UI: amendment revalidates slots and records a reason without creating a second booking", async () => {
  await login();
  await findEmma();
  fireEvent.click(screen.getByRole("button", { name: "Amend", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: /BIAB \/ BIAB Refill/ }));
  fireEvent.click(screen.getByRole("button", { name: /Morning ·/ }));
  await waitFor(() => assert(document.querySelector(".slots button")));
  fireEvent.click(document.querySelector(".slots button"));
  fireEvent.click(
    within(document.querySelector(".summary")).getByRole("button", {
      name: "Continue →",
    }),
  );
  await screen.findByRole("heading", { name: "Review appointment changes" });
  fireEvent.change(screen.getByLabelText("Reason for amendment"), {
    target: { value: "Client requested an earlier time" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save appointment changes" }),
  );
  await screen.findByText("APPOINTMENT UPDATED");
  const bookings = JSON.parse(localStorage.getItem("sculpted-demo-v1"));
  assert.equal(bookings.filter((a) => a.id === "sample-1").length, 1);
  assert.equal(bookings.find((a) => a.id === "sample-1").revision, 1);
  const event = JSON.parse(
    localStorage.getItem("sculpted-staff-data-v1"),
  ).activity.find((a) => a.action === "appointment_amended");
  assert.equal(event.details.reason, "Client requested an earlier time");
  assert.equal(event.details.before.start_minute, 570);
  assert.equal(event.details.after.start_minute, 540);
});
test("UI: diary no-show is visibly marked and records no guarantee charge", async () => {
  await login();
  fireEvent.click(screen.getByRole("button", { name: /Staff Diary Today/ }));
  fireEvent.click(screen.getByRole("button", { name: /09:30 · Emma Demo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Mark as no-show" }));
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "Client did not attend" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm no-show" }));
  await waitFor(() =>
    assert(!screen.queryByRole("dialog", { name: "Appointment details" })),
  );
  assert(document.querySelector(".appointment.no_show"));
  const data = JSON.parse(localStorage.getItem("sculpted-staff-data-v1"));
  assert.equal(data.activity.at(-1).details.guarantee_charged, false);
  assert.equal(data.activity.at(-1).details.after, "no_show");
});
test("UI: admin has six tiles, accountant only Reporting, and clocks remain profile specific", async () => {
  await login(/Aoife/);
  assert.equal(document.querySelectorAll(".workspace-card").length, 6);
  const out = screen.getByRole("button", { name: "Clock-Out" });
  assert(out.disabled);
  fireEvent.click(screen.getByRole("button", { name: "Clock-In" }));
  assert(!out.disabled);
  fireEvent.click(
    screen.getByRole("button", { name: "Switch profile / lock" }),
  );
  assert.equal(screen.queryByRole("button", { name: /Jacqui/ }), null);
});
test("UI: voucher issuance, client assignment, transfer and print use the current name", async () => {
  await login();
  fireEvent.click(screen.getByRole("button", { name: /Voucher Management/ }));
  fireEvent.click(screen.getByRole("button", { name: /Create a New Voucher/ }));
  fireEvent.change(screen.getByLabelText("Voucher amount (€)"), {
    target: { value: "50" },
  });
  fireEvent.change(screen.getByLabelText("Expiry date"), {
    target: { value: "2027-12-31" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Assign to an existing client" }),
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Emma" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: /Emma Demo/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Create voucher", exact: true }),
  );
  assert(await screen.findByRole("heading", { name: "Gift Voucher" }));
  let prints = 0;
  window.print = () => prints++;
  fireEvent.click(screen.getByRole("button", { name: "Print voucher" }));
  assert.equal(prints, 1);
  fireEvent.click(
    screen.getByRole("button", { name: "Reassign", exact: true }),
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Grace" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: /Grace Demo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Transfer voucher" }));
  await screen.findByRole("heading", { name: "Gift Voucher" });
  const saved = JSON.parse(localStorage.getItem("sculpted-staff-data-v1"));
  assert.equal(saved.vouchers[0].assigned_client_name, "Grace Demo");
  assert.equal(saved.voucherTransactions.length, 2);
  assert.equal(Number(saved.vouchers[0].original_amount), 50);
  assert(
    document
      .querySelector(".voucher-print-area")
      .textContent.includes("Grace Demo"),
  );
});

test("UI: diary and booking therapist choices contain only salon staff", async () => {
  await login();
  fireEvent.click(screen.getByRole("button", { name: /Staff Diary Today/ }));
  assert.equal(document.querySelectorAll(".staff-column").length, 2);
  assert.equal(screen.queryByText("Jacqui"), null);
});
test("UI: separate Accountant Portal has only Jacqui and Reporting", async () => {
  cleanup();
  window.history.replaceState({}, "", "?portal=accountant");
  try {
    const AccountantApp = (
      await import(pathToFileURL(buildDir + "/app.mjs").href + "?accountant")
    ).default;
    render(React.createElement(AccountantApp));
    assert(screen.getByRole("heading", { name: "Accountant sign-in" }));
    assert.equal(document.querySelectorAll(".staff-tile").length, 1);
    fireEvent.click(screen.getByRole("button", { name: /Jacqui/ }));
    fireEvent.change(screen.getByLabelText("4-digit demo PIN"), {
      target: { value: "1234" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open demo workspace" }),
    );
    assert(await screen.findByRole("heading", { name: "Welcome, Jacqui." }));
    assert.equal(document.querySelectorAll(".workspace-card").length, 1);
    assert.equal(screen.queryByRole("button", { name: "Clock-In" }), null);
    assert.equal(screen.queryByRole("button", { name: "Staff Diary" }), null);
  } finally {
    cleanup();
    window.history.replaceState({}, "", "?portal=staff");
  }
});
test("UI: client choice screen leads directly to self treatments or recipient details", async () => {
  cleanup();
  window.history.replaceState({}, "", "/");
  try {
    const ClientApp = (
      await import(pathToFileURL(buildDir + "/app.mjs").href + "?client-choice")
    ).default;
    render(React.createElement(ClientApp));
    fireEvent.click(
      screen.getByRole("button", { name: "Client", exact: true }),
    );
    assert(screen.getByRole("heading", { name: "Who are you booking for?" }));
    assert.equal(document.querySelector(".intro"), null);
    assert.equal(document.querySelector(".steps"), null);
    fireEvent.click(screen.getByRole("button", { name: "Menu", exact: true }));
    assert.equal(
      screen
        .getByRole("button", { name: "Menu", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Book a treatment", exact: true }),
    );
    assert.equal(
      screen
        .getByRole("button", { name: "Menu", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Yourself", exact: true }),
    );
    assert(screen.getByRole("heading", { name: "Explore treatments" }));
    assert(document.querySelector(".steps"));
    fireEvent.click(screen.getByRole("button", { name: /Booking recipient/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Someone Else", exact: true }),
    );
    assert(screen.getByRole("heading", { name: "Their details" }));
    assert(screen.getByLabelText("Full name"));
  } finally {
    cleanup();
    window.history.replaceState({}, "", "?portal=staff");
  }
});
test("UI: admin creates staff, edits notes and skills, archives with retained history", async () => {
  await login(/Aoife/);
  fireEvent.click(
    screen.getByRole("button", { name: /Staff Administration Staff/ }),
  );
  await screen.findByRole("heading", { name: "Staff Administration" });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Create New Staff Member",
      exact: true,
    }),
  );
  fireEvent.change(screen.getByLabelText("First name"), {
    target: { value: "Nora" },
  });
  fireEvent.change(screen.getByLabelText("Last name"), {
    target: { value: "Test" },
  });
  fireEvent.change(screen.getByLabelText(/^Login PIN/), {
    target: { value: "2580" },
  });
  fireEvent.change(screen.getByLabelText("Current Hourly Rate (€)"), {
    target: { value: "20" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save staff details" }));
  assert(await screen.findByRole("heading", { name: "Nora Test" }));
  fireEvent.click(screen.getByRole("button", { name: "Notes", exact: true }));
  fireEvent.change(screen.getByLabelText("New staff note"), {
    target: { value: "Completed induction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add staff note" }));
  assert(await screen.findByText("Completed induction"));
  fireEvent.click(screen.getByRole("button", { name: "Remove note" }));
  await waitFor(() =>
    assert.equal(screen.queryByText("Completed induction"), null),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Treatments", exact: true }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Select visible treatments" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save treatment permissions" }),
  );
  await screen.findByText("Treatment permissions saved.");
  fireEvent.click(screen.getByRole("button", { name: "Shifts", exact: true }));
  assert.equal(screen.getAllByRole("checkbox", { name: "Working" }).length, 14);
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Working" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Save working shifts" }));
  await screen.findByText("Working shifts saved.");
  fireEvent.click(screen.getByRole("button", { name: "Archive", exact: true }));
  fireEvent.change(screen.getByLabelText("Archive reason"), {
    target: { value: "Left salon" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Archive staff member", exact: true }),
  );
  await screen.findByText("Staff member archived. History retained.");
  assert.equal(screen.queryByRole("button", { name: /Nora Test/ }), null);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Show archived staff" }),
  );
  assert(screen.getByRole("button", { name: /Nora Test/ }));
  const d = JSON.parse(localStorage.getItem("sculpted-staff-data-v1"));
  const n = d.staffRecords.find((s) => s.first_name === "Nora");
  assert.equal(n.active, false);
  assert.equal(n.date_left, "2026-10-05");
  assert(d.staffNotes[0].removed_at);
  assert(n.treatment_ids.length > 0);
});
test("UI: newly created staff appears in login and uses its saved demo PIN", async () => {
  await login(/Aoife/);
  fireEvent.click(
    screen.getByRole("button", { name: /Staff Administration Staff/ }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Create New Staff Member",
      exact: true,
    }),
  );
  fireEvent.change(screen.getByLabelText("First name"), {
    target: { value: "Nora" },
  });
  fireEvent.change(screen.getByLabelText(/^Login PIN/), {
    target: { value: "2580" },
  });
  fireEvent.change(screen.getByLabelText("Current Hourly Rate (€)"), {
    target: { value: "20" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save staff details" }));
  await screen.findByRole("heading", { name: "Nora", exact: true });
  fireEvent.click(
    screen.getByRole("button", { name: "Switch profile / lock" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Nora/ }));
  fireEvent.change(screen.getByLabelText("4-digit demo PIN"), {
    target: { value: "2580" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open demo workspace" }));
  assert(await screen.findByRole("heading", { name: "Your salon workspace." }));
  assert.equal(
    screen.queryByRole("button", { name: /Staff Administration Staff/ }),
    null,
  );
});
test("UI: admin can add and amend missed clock entries with a retained audit trail", async () => {
  await login(/Aoife/);
  fireEvent.click(
    screen.getByRole("button", { name: /Staff Administration Staff/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Leah Staff/ }));
  await screen.findByRole("heading", { name: "Leah", exact: true });
  fireEvent.click(
    screen.getByRole("button", { name: "Clock history", exact: true }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Add missed clock entry" }),
  );
  fireEvent.change(screen.getByLabelText("Clock-In time"), {
    target: { value: "2026-10-04T09:00" },
  });
  fireEvent.change(screen.getByLabelText("Clock-Out time"), {
    target: { value: "2026-10-04T17:00" },
  });
  fireEvent.change(screen.getByLabelText("Correction reason"), {
    target: { value: "Forgot to clock in" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save clock correction" }),
  );
  await screen.findByText(
    "Clock record saved; original times retained in the audit history.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Amend clock times" }));
  fireEvent.change(screen.getByLabelText("Clock-In time"), {
    target: { value: "2026-10-04T09:15" },
  });
  fireEvent.change(screen.getByLabelText("Correction reason"), {
    target: { value: "Correct actual arrival" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save clock correction" }),
  );
  await screen.findByText(
    "Clock record saved; original times retained in the audit history.",
  );
  const d = JSON.parse(localStorage.getItem("sculpted-staff-data-v1"));
  assert.equal(d.shifts.length, 1);
  assert.equal(d.shifts[0].clocked_in_at, "2026-10-04T08:15:00.000Z");
  const table = screen.getByRole("table");
  const row = table.querySelector("tbody tr");
  assert.equal(row.cells[0].textContent, "Sunday 04/10/26");
  assert.equal(row.cells[1].textContent, "09:15");
  assert.equal(row.cells[2].textContent, "17:00");
  assert(table.textContent.includes("07:45"));
  assert(table.textContent.includes("00:00"));
  assert(screen.getByRole("columnheader", { name: "Scheduled Hours" }));
  const log = d.activity.filter((a) => a.action === "staff_clock_corrected");
  assert.equal(log.length, 2);
  assert.equal(log[1].details.before.clocked_in_at, "2026-10-04T08:00:00.000Z");
});
async function clientScreen(tag) {
  cleanup();
  window.history.replaceState({}, "", "/");
  const ClientApp = (
    await import(pathToFileURL(buildDir + "/app.mjs").href + "?" + tag)
  ).default;
  render(React.createElement(ClientApp));
  fireEvent.click(screen.getByRole("button", { name: "Client", exact: true }));
  return ClientApp;
}
test("UI: client profile, voucher purchase, print and simulated email work together", async () => {
  try {
    await clientScreen("voucher-profile");
    assert(screen.getByRole("button", { name: "Sign Out", exact: true }));
    assert(screen.getByRole("button", { name: /You and Other People/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /You and Other People/ }),
    );
    assert(screen.getByText("Multiple bookings are coming soon."));
    fireEvent.click(screen.getByRole("button", { name: /Booking home/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "My Profile", exact: true }),
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Updated Demo Client" },
    });
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "0800000099" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Email", exact: true }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "WhatsApp", exact: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save my profile" }));
    await screen.findByText("Your profile has been saved.");
    fireEvent.click(
      screen.getByRole("button", { name: "Buy a Voucher", exact: true }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "€50", exact: true }));
    fireEvent.change(screen.getByLabelText("Card for your voucher"), {
      target: { value: "saved_demo" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I understand this is a demo purchase.",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Confirm demo purchase/ }),
    );
    assert(
      await screen.findByRole("heading", {
        name: "Your voucher is confirmed.",
      }),
    );
    assert(
      document
        .querySelector(".voucher-print-area")
        .textContent.includes("Updated Demo Client"),
    );
    let prints = 0;
    window.print = () => prints++;
    fireEvent.click(screen.getByRole("button", { name: "Print voucher" }));
    assert.equal(prints, 1);
    fireEvent.click(
      screen.getByRole("button", { name: "Email voucher to recipient" }),
    );
    await screen.findByText(
      "Demo email prepared for client@example.com. No email has been sent.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: /View My Profile and vouchers/ }),
    );
    assert(await screen.findByText(/€50.00 remaining/));
    const d = JSON.parse(localStorage.getItem("sculpted-staff-data-v1"));
    const c = d.clients.find((c) => c.auth_user_id === "local-client");
    assert(c.marketing_email);
    assert(c.marketing_whatsapp);
    assert(!c.marketing_sms);
    assert.equal(c.phone, "0800000099");
    assert.equal(d.vouchers[0].original_amount, 50);
    assert.equal(d.vouchers[0].card_number, undefined);
  } finally {
    cleanup();
    window.history.replaceState({}, "", "?portal=staff");
  }
});
test("UI: treatment-priced gift vouchers use the selected price and recipient details", async () => {
  try {
    await clientScreen("gift-voucher");
    fireEvent.click(
      screen.getByRole("button", { name: "Buy a Voucher", exact: true }),
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "Full-treatment-price" }),
    );
    const catalog = JSON.parse(
      await readFile(new URL("../src/catalog.json", import.meta.url), "utf8"),
    );
    const t = catalog.find((t) => t.name === "EXCLUSIVE PACKAGE 1");
    fireEvent.change(screen.getByLabelText("Treatment"), {
      target: { value: String(t.id) },
    });
    fireEvent.click(
      screen.getByRole("radio", { name: "Someone Else", exact: true }),
    );
    fireEvent.change(screen.getByLabelText("Recipient name"), {
      target: { value: "Gift Friend" },
    });
    fireEvent.change(screen.getByLabelText("Recipient email address"), {
      target: { value: "gift@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Card for your voucher"), {
      target: { value: "new_demo" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I understand this is a demo purchase.",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Confirm demo purchase/ }),
    );
    await screen.findByRole("heading", { name: "Your voucher is confirmed." });
    const d = JSON.parse(localStorage.getItem("sculpted-staff-data-v1"));
    assert.equal(d.vouchers[0].original_amount, t.price);
    assert.equal(d.vouchers[0].recipient_email, "gift@example.com");
    assert.equal(d.vouchers[0].assigned_client_name, "Gift Friend");
    fireEvent.click(
      screen.getByRole("button", { name: /View My Profile and vouchers/ }),
    );
    assert(
      await screen.findByText("You don’t have any assigned vouchers yet."),
    );
  } finally {
    cleanup();
    window.history.replaceState({}, "", "?portal=staff");
  }
});
test("UI: attended self bookings default to Previous Bookings and say Rebook Treatment", async () => {
  try {
    cleanup();
    const catalog = JSON.parse(
      await readFile(new URL("../src/catalog.json", import.meta.url), "utf8"),
    );
    const t = catalog.find((t) => t.name === "Glamour Special");
    localStorage.setItem(
      "sculpted-demo-v1",
      JSON.stringify([
        {
          id: "past-self",
          user_id: "local-client",
          staff_id: 1,
          treatment_id: t.id,
          start_minute: 540,
          duration: t.duration,
          appointment_date: "2026-10-04",
          status: "completed",
          client_name: "Demo Client",
          treatment_name: t.name,
          price: t.price,
          booked_for_self: true,
        },
      ]),
    );
    await clientScreen("rebooking");
    fireEvent.click(
      screen.getByRole("button", { name: "Yourself", exact: true }),
    );
    assert(
      screen.getByRole("heading", { name: "Previous Bookings", exact: true }),
    );
    assert(
      screen.getByRole("button", { name: /Glamour Special.*Rebook Treatment/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Booking recipient/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Someone Else", exact: true }),
    );
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Other Person" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "other@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "0800000000" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Continue to treatments/ }),
    );
    assert(
      screen.getByRole("heading", { name: "All treatments", exact: true }),
    );
    assert.equal(
      screen.queryByRole("button", { name: /Previous Bookings/ }),
      null,
    );
  } finally {
    cleanup();
    window.history.replaceState({}, "", "?portal=staff");
  }
});

test("UI: appointment sections separate history and rebook directly into time selection", async () => {
  try {
    cleanup();
    const catalog = JSON.parse(await readFile(new URL("../src/catalog.json", import.meta.url), "utf8"));
    const t = catalog.find(t => t.name === "Glamour Special");
    const base = { user_id: "local-client", staff_id: 1, treatment_id: t.id, start_minute: 600, duration: t.duration, client_name: "Demo Client", treatment_name: t.name, price: t.price, booked_for_self: true };
    localStorage.setItem("sculpted-demo-v1", JSON.stringify([
      { ...base, id: "future", appointment_date: "2026-10-06", status: "booked" },
      { ...base, id: "completed", appointment_date: "2026-10-05", status: "completed" },
      { ...base, id: "cancelled", appointment_date: "2026-10-07", status: "cancelled" }
    ]));
    await clientScreen("appointment-history");
    fireEvent.click(screen.getByRole("button", { name: "My appointments", exact: true }));
    const upcoming = screen.getByRole("region", { name: /Upcoming Appointments/ });
    const previous = screen.getByRole("region", { name: /Previous Appointments/ });
    assert.equal(upcoming.querySelectorAll(".history-card").length, 1);
    assert.equal(previous.querySelectorAll(".history-card").length, 2);
    assert.equal(upcoming.querySelector("button"), null);
    fireEvent.click(previous.querySelector("button"));
    assert(screen.getByText(/Who would you like to see/i));
    assert(screen.getAllByText("Glamour Special").length > 0);
    assert.equal(screen.queryByRole("heading", { name: "All treatments", exact: true }), null);
  } finally {
    cleanup();
    window.history.replaceState({}, "", "?portal=staff");
  }
});

test("UI: admin can select Leah for a break and edit Leah's lunch", async () => {
  await login(/Aoife/);
  fireEvent.click(screen.getByRole("button", { name: /Staff Diary Today/ }));
  fireEvent.click(screen.getByRole("button", { name: /Add break time/i }));
  fireEvent.change(screen.getByLabelText("Staff member"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Start", { exact: true }), { target: { value: "14:00" } });
  fireEvent.change(screen.getByLabelText("End", { exact: true }), { target: { value: "14:15" } });
  fireEvent.click(screen.getByRole("button", { name: "Save break time" }));
  assert.equal(JSON.parse(localStorage.getItem("sculpted-staff-data-v1")).breaks[0].staff_id, 2);
  const column = document.querySelectorAll(".staff-column")[1];
  const lunch = Array.from(column.querySelectorAll("button")).find(b => b.textContent.includes("Lunch"));
  assert.equal(lunch.disabled, false);
  fireEvent.click(lunch);
  assert.equal(screen.getByLabelText("Staff member").value, "2");
});
