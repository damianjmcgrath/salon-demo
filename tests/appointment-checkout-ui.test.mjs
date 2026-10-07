import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import React from "react";
let dom, dir, Component, render, screen, fireEvent, waitFor, cleanup;
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
  dir = await mkdtemp(new URL("../.checkout-test-", import.meta.url));
  await build({
    entryPoints: [
      new URL("../src/AppointmentCheckout.tsx", import.meta.url).pathname,
    ],
    outfile: dir + "/component.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
  });
  Component = (await import(pathToFileURL(dir + "/component.mjs"))).default;
});
afterEach(() => cleanup());
after(async () => {
  dom.window.close();
  await rm(dir, { recursive: true, force: true });
});
const appointment = { id: "appointment-1", revision: 3, price: 80 };
function setup({ balance = 60, error = null } = {}) {
  const calls = [],
    saved = [];
  const v = { id: "voucher-1", code: "SC-TEST", balance },
    n = { id: "note-1", balance, reason: "Goodwill" };
  const db = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "checkout_appointment") return { data: {}, error };
      return {
        data: {
          vouchers: [v],
          credit_notes: [n],
          found_voucher: args.p_code ? v : null,
        },
        error: null,
      };
    },
  };
  render(
    React.createElement(Component, {
      db,
      appointment,
      onSaved: async () => saved.push(true),
    }),
  );
  return { calls, saved };
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Check Client Out" }));
  await waitFor(() =>
    assert.equal(screen.queryByText("Loading available balances…"), null),
  );
}
test("card choice can be edited and only final confirmation records the selected cash method", async () => {
  const { calls, saved } = setup();
  await open();
  assert.equal(screen.queryByRole("button", { name: "Complete Appointment" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Card", exact: true }));
  assert(screen.getByText("Payment breakdown"));
  assert.equal(calls.filter((c) => c[0] === "checkout_appointment").length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  assert.equal(screen.queryByRole("button", { name: "Complete Appointment" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Cash", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Complete Appointment" }));
  await waitFor(() => assert.equal(saved.length, 1));
  assert.deepEqual(calls.find((c) => c[0] === "checkout_appointment")[1], {
    p_id: "appointment-1",
    p_revision: 3,
    p_method: "cash",
    p_voucher_code: null,
    p_credit_note_id: null,
    p_remainder_method: null,
    p_value_amount: null,
  });
});
test("partial voucher requires a Card/Cash remainder and records the displayed breakdown", async () => {
  const { calls, saved } = setup();
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Voucher", exact: true }));
  await screen.findByRole("combobox");
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "voucher-1" },
  });
  assert(screen.getByText("€20.00 remaining to pay"));
  assert.equal(screen.queryByRole("button", { name: "Complete Appointment" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Card", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Complete Appointment" }));
  await waitFor(() => assert.equal(saved.length, 1));
  const p = calls.find((c) => c[0] === "checkout_appointment")[1];
  assert.equal(p.p_value_amount, 60);
  assert.equal(p.p_remainder_method, "card");
  assert.equal(p.p_voucher_code, "SC-TEST");
});
test("credit note exceeding the treatment uses only its price and preserves the remainder", async () => {
  const { calls, saved } = setup({ balance: 100 });
  await open();
  fireEvent.click(
    screen.getByRole("button", { name: "Credit Note", exact: true }),
  );
  fireEvent.change(await screen.findByRole("combobox"), {
    target: { value: "note-1" },
  });
  assert(screen.getByText("€80.00 will be used. €20.00 will remain."));
  assert.equal(screen.queryByText("remaining to pay"), null);
  fireEvent.click(screen.getByRole("button", { name: "Complete Appointment" }));
  await waitFor(() => assert.equal(saved.length, 1));
  const p = calls.find((c) => c[0] === "checkout_appointment")[1];
  assert.equal(p.p_value_amount, 80);
  assert.equal(p.p_credit_note_id, "note-1");
  assert.equal(p.p_remainder_method, null);
});
test("manual voucher lookup and server balance error leave checkout uncompleted", async () => {
  const { calls, saved } = setup({
    error: { message: "The balance changed." },
  });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Voucher", exact: true }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "SC-TEST" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Find Voucher" }));
  await screen.findByText("€20.00 remaining to pay");
  fireEvent.click(screen.getByRole("button", { name: "Cash", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Complete Appointment" }));
  assert(
    (await screen.findByRole("alert")).textContent.includes(
      "The balance changed.",
    ),
  );
  assert.equal(saved.length, 0);
  assert.equal(calls.filter((c) => c[0] === "checkout_appointment").length, 1);
});

test('free checkout completes on the first click without payment choices and returns the completed appointment',async()=>{
 const free={id:'free-patch',revision:2,price:0,status:'checked_in',patch_for_treatment_id:8001};let call,saved;
 const db={rpc:async(name,args)=>{call=[name,args];return {data:{...free,status:'completed',revision:3},error:null};}};
 render(React.createElement(Component,{db,appointment:free,onSaved:async(a)=>{saved=a;}}));
 fireEvent.click(screen.getByRole('button',{name:'Check Client Out'}));
 await waitFor(()=>assert.equal(saved?.status,'completed'));assert.equal(saved.patch_for_treatment_id,8001);assert.equal(call[0],'checkout_appointment');assert.equal(call[1].p_method,null);assert.equal(call[1].p_revision,2);assert.equal(screen.queryByText('Select method of payment'),null);
});
