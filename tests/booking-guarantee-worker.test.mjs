import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
let handler, fee, isStaff, mode, hasCard, calls;
const originalFetch = globalThis.fetch;
const originalDeno = globalThis.Deno;
const result = (data) => ({ data, error: null });
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.values = null;
    this.singleRow = false;
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.filters.push([k, v]);
    return this;
  }
  update(values) {
    this.values = values;
    return this;
  }
  single() {
    this.singleRow = true;
    return this;
  }
  maybeSingle() {
    this.singleRow = true;
    return this;
  }
  then(resolve, reject) {
    return Promise.resolve()
      .then(() => {
        let row =
          this.table === "no_show_fees"
            ? fee
            : this.table === "appointments"
              ? {
                  status: "no_show",
                  guarantee_card_id: hasCard ? "card-id" : null,
                }
              : {
                  verified_at: "2026-01-01",
                  payment_method_id: "method-id",
                  customer_id: "customer-id",
                  environment: "sandbox",
                };
        if (this.filters.some(([k, v]) => k === "state" && row.state !== v))
          return result(this.singleRow ? null : []);
        if (this.values) Object.assign(row, this.values);
        return result(this.singleRow ? { ...row } : [{ ...row }]);
      })
      .then(resolve, reject);
  }
}
before(async () => {
  const state = await readFile(
    new URL(
      "../supabase/functions/booking-guarantee/payment-state.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const code = await readFile(
    new URL(
      "../supabase/functions/booking-guarantee/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  globalThis.__guaranteeCreateClient = () => ({
    auth: { getUser: async () => result({ user: { id: "staff-id" } }) },
    rpc: async () => result(isStaff),
    from: (table) => new Query(table),
  });
  globalThis.Deno = {
    env: {
      get: (k) =>
        ({
          REVOLUT_ENVIRONMENT: "sandbox",
          REVOLUT_SECRET_KEY: "sandbox-private-key",
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-key",
          SUPABASE_ANON_KEY: "anon-key",
        })[k],
    },
    serve: (fn) => {
      handler = fn;
    },
  };
  const compiled = await transform(
    code.replace(
      /^import[^\n]+\nimport[^\n]+\n/,
      "const createClient=globalThis.__guaranteeCreateClient;\n" +
        state.replace("export function", "function") +
        "\n",
    ),
    { loader: "ts", format: "esm" },
  );
  await import(
    "data:text/javascript;base64," +
      Buffer.from(compiled.code).toString("base64")
  );
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/payments")) {
      if (mode === "timeout") throw new Error("Payment response lost");
      return Response.json({ state: "authorisation_passed" });
    }
    if (options.method === "POST")
      return Response.json({ id: "order-id", state: "pending" });
    if (mode === "timeout") throw new Error("Order lookup unavailable");
    return Response.json({
      state: mode === "decline" ? "pending" : "completed",
      payments: mode === "decline" ? [{ state: "declined" }] : [],
    });
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  globalThis.Deno = originalDeno;
  delete globalThis.__guaranteeCreateClient;
});
function reset() {
  fee = {
    appointment_id: "appointment-id",
    state: "pending",
    comments: "Client did not attend",
    apply_fee: true,
  };
  isStaff = true;
  mode = "success";
  hasCard = true;
  calls = [];
}
async function invoke(action = "charge") {
  const r = await handler(
    new Request("https://example/function", {
      method: "POST",
      headers: {
        Authorization: "Bearer user-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, appointment_id: "appointment-id" }),
    }),
  );
  return { status: r.status, data: await r.json() };
}
test("parallel/repeated staff requests submit one €10 MIT charge and confirm its order", async () => {
  reset();
  await Promise.all([invoke(), invoke()]);
  const r = await invoke();
  assert.equal(r.data.state, "completed");
  const orders = calls.filter((c) => c.url.endsWith("/orders"));
  assert.equal(orders.length, 1);
  assert.equal(orders[0].body.amount, 1000);
  assert.equal(orders[0].body.currency, "EUR");
  assert.equal(orders[0].body.customer.id, "customer-id");
  const payments = calls.filter((c) => c.url.endsWith("/payments"));
  assert.equal(payments.length, 1);
  assert.equal(payments[0].body.saved_payment_method.initiator, "merchant");
});
test("waived fees and missing guarantee cards never submit payments", async () => {
  reset();
  fee.state = "waived";
  fee.apply_fee = false;
  assert.equal((await invoke()).data.state, "waived");
  assert.equal(calls.length, 0);
  reset();
  hasCard = false;
  assert.equal((await invoke()).data.state, "failed");
  assert.equal(calls.length, 0);
});
test("a lost response is recorded for review and cannot produce another charge", async () => {
  reset();
  mode = "timeout";
  assert.equal((await invoke()).data.state, "review");
  await invoke();
  await invoke("fee_status");
  assert.equal(calls.filter((c) => c.url.endsWith("/payments")).length, 1);
  mode = "success";
  assert.equal((await invoke("fee_status")).data.state, "completed");
  assert.equal(calls.filter((c) => c.url.endsWith("/payments")).length, 1);
});
test("declines are not recorded as collected fees and cannot be retried blindly", async () => {
  reset();
  mode = "decline";
  assert.equal((await invoke()).data.state, "failed");
  await invoke();
  assert.equal(calls.filter((c) => c.url.endsWith("/payments")).length, 1);
});
test("client/accountant requests cannot trigger no-show payments", async () => {
  reset();
  isStaff = false;
  assert.equal((await invoke()).status, 403);
  assert.equal(calls.length, 0);
});
