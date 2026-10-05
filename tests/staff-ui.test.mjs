// Offline DOM interaction tests: actual React screens and forms, without a browser or network.
import { before, after, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
async function login(name = /Aoife/) {
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
  assert(screen.getByRole("heading", { name: "Who’s working today?" }));
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
  await screen.findByRole("heading", { name: "Who’s working today?" });
  assert.equal(
    screen.queryByRole("heading", { name: "Your salon workspace." }),
    null,
  );
  await login(/Demo Therapist A/);
  assert(screen.getByText(/STAFF PORTAL · Demo Therapist A/));
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
  assert.equal(data.notes[0].author_name, "Aoife");
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
    2,
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
