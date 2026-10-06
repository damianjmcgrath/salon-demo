import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
const source = await readFile(
  new URL(
    "../supabase/functions/booking-guarantee/payment-state.ts",
    import.meta.url,
  ),
  "utf8",
);
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { feeState } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
test("only a completed provider order confirms a collected fee", () => {
  assert.equal(feeState({ state: "completed" }), "completed");
  for (const state of ["pending", "processing", "authorised", "unknown"])
    assert.equal(feeState({ state }), "processing");
  assert.equal(
    feeState({
      state: "pending",
      payments: [{ state: "authorisation_passed" }],
    }),
    "processing",
  );
  assert.equal(feeState({ state: "failed" }), "failed");
  assert.equal(feeState({ state: "cancelled" }), "failed");
  assert.equal(
    feeState({ state: "pending", payments: [{ state: "declined" }] }),
    "failed",
  );
  assert.equal(
    feeState({
      state: "pending",
      payments: [{ state: "declined" }, { state: "authorisation_passed" }],
    }),
    "processing",
  );
});
