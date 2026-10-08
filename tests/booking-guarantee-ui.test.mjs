import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import React, { act } from "react";
let dom,
  dir,
  Component,
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  callbacks,
  invocations,
  changes,
  verifyCount;
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
  globalThis.__salonCheckout = async () => ({
    createCardField(options) {
      callbacks = options;
      return {
        destroy() {},
        submit() {
          options.onSuccess();
        },
      };
    },
  });
  dir = await mkdtemp(new URL("../.guarantee-test-", import.meta.url));
  const source = (
    await readFile(
      new URL("../src/BookingGuarantee.tsx", import.meta.url),
      "utf8",
    )
  ).replace(
    'import RevolutCheckout from "@revolut/checkout";',
    "const RevolutCheckout=globalThis.__salonCheckout;",
  );
  await build({
    stdin: {
      contents: source,
      loader: "tsx",
      resolveDir: new URL("../src/", import.meta.url).pathname,
    },
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
  delete globalThis.__salonCheckout;
  await rm(dir, { recursive: true, force: true });
});
function mount(cards = []) {
  invocations = [];
  changes = [];
  verifyCount = 0;
  const db = {
    functions: {
      invoke: async (_, { body }) => {
        invocations.push(body.action);
        let data;
        if (body.action === "list")
          data = {
            cards,
            owner_name: "Damian McGrath",
            owner_email: "damian@example.com",
          };
        if (body.action === "create")
          data = { id: "new-card", token: "sandbox-token" };
        if (body.action === "verify")
          data =
            ++verifyCount === 1
              ? { verified: false, setup_state: "pending" }
              : {
                  verified: true,
                  id: "new-card",
                  brand: "Visa",
                  last_four: "5709",
                };
        return { data, error: null };
      },
    },
  };
  return render(
    React.createElement(Component, {
      db,
      onChange: (...args) => changes.push(args),
    }),
  );
}
test("new card automatically opens secure fields and verifies delayed success without extra clicks", async () => {
  mount();
  await waitFor(() =>
    assert.equal(screen.getByLabelText("Card for your guarantee").value, "new"),
  );
  assert(!screen.queryByRole("button", { name: "Set up guarantee card" }));
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() =>
    assert(screen.getByRole("button", { name: "Save guarantee card" })),
  );
  assert.equal(invocations.filter((a) => a === "create").length, 1);
  fireEvent.click(screen.getByRole("button", { name: "Save guarantee card" }));
  await waitFor(
    () =>
      assert(
        screen.getByText(
          "Card verified. You can now confirm your appointment.",
        ),
      ),
    { timeout: 2500 },
  );
  assert.equal(verifyCount, 2);
  assert.deepEqual(changes.at(-1), ["new-card", true]);
  assert(!screen.queryByRole("button", { name: "Check card again" }));
  assert.equal(invocations.filter((a) => a === "create").length, 1);
});
test("a saved card is preselected but still requires fresh consent", async () => {
  mount([{ id: "saved-card", brand: "Visa", last_four: "5709" }]);
  await waitFor(() =>
    assert.equal(
      screen.getByLabelText("Card for your guarantee").value,
      "saved-card",
    ),
  );
  assert.deepEqual(changes.at(-1), ["saved-card", false]);
  fireEvent.click(screen.getByRole("checkbox"));
  assert.deepEqual(changes.at(-1), ["saved-card", true]);
  assert(!invocations.includes("create"));
});
test("a declined setup remains unconfirmed and lets the client correct their card", async () => {
  mount();
  await waitFor(() =>
    assert.equal(screen.getByLabelText("Card for your guarantee").value, "new"),
  );
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() =>
    assert(screen.getByRole("button", { name: "Save guarantee card" })),
  );
  await act(async () => callbacks.onError("Insufficient funds"));
  await waitFor(() => assert(screen.getByText("Insufficient funds")));
  assert(!changes.some(([id, consent]) => id === "new-card" && consent));
  assert.equal(invocations.filter((a) => a === "create").length, 1);
});

test('saved card dropdown stays disabled during a delayed lookup and never claims there are no cards',async()=>{
 let resolve;
 const db={functions:{invoke:()=>new Promise(r=>resolve=r)}};
 render(React.createElement(Component,{db,onChange:()=>{}}));
 assert.equal(screen.getByLabelText('Card for your guarantee').disabled,true);
 assert(screen.getByText('Loading your saved cards. Please wait before choosing a card.'));
 assert.equal(screen.queryByText('You have no saved cards yet. Add a new card below.'),null);
 await act(async()=>resolve({data:{cards:[{id:'saved',brand:'Visa',last_four:'4242'}],owner_name:'Jacqui Durnin',owner_email:'jacqui@example.com'},error:null}));
 await waitFor(()=>assert.equal(screen.getByLabelText('Card for your guarantee').value,'saved'));
 assert.equal(screen.getByLabelText('Card for your guarantee').disabled,false);
});
test('connection errors retry a card lookup once, then offer a clear manual retry that clears on recovery',async()=>{
 let calls=0;const actions=[];
 const db={functions:{invoke:async(_,{body})=>{calls++;actions.push(body.action);return calls<=2?{data:null,error:{message:'TypeError: Load failed'}}:{data:{cards:[{id:'saved',brand:'Visa',last_four:'4242'}],owner_name:'Jacqui Durnin',owner_email:'jacqui@example.com'},error:null};}}};
 render(React.createElement(Component,{db,onChange:()=>{}}));
 await screen.findByRole('button',{name:'Retry loading saved cards'});
 assert.equal(calls,2);assert(screen.getByText('We couldn’t load your saved cards. Please check your connection and try again.'));assert.equal(screen.getByLabelText('Card for your guarantee').disabled,true);
 assert.equal(screen.queryByText('You have no saved cards yet. Add a new card below.'),null);
 fireEvent.click(screen.getByRole('button',{name:'Retry loading saved cards'}));
 await waitFor(()=>assert.equal(screen.getByLabelText('Card for your guarantee').value,'saved'));
 assert.equal(screen.queryByRole('alert'),null);assert.deepEqual(actions,['list','list','list']);
});
test('permission errors are not repeatedly retried as connection errors',async()=>{
 let calls=0;render(React.createElement(Component,{db:{functions:{invoke:async()=>{calls++;return {data:null,error:{message:'Permission denied'}};}}},onChange:()=>{}}));
 await screen.findByText('Permission denied');assert.equal(calls,1);assert.equal(screen.getByLabelText('Card for your guarantee').disabled,true);
});
