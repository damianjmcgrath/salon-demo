import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { voucherPayload } from "./email.ts";
Deno.serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer "))
    return reply({ error: "Please sign in." }, 401);
  const url = Deno.env.get("SUPABASE_URL")!,
    apiKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userDb = createClient(url, apiKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user, error: authError } = await userDb.auth.getUser();
  if (authError || !user.user) return reply({ error: "Please sign in." }, 401);
  const permitted = await userDb.rpc("has_permission", {
    p_key: "view.vouchers",
  });
  if (permitted.error || permitted.data !== true)
    return reply({ error: "Voucher Management permission required." }, 403);
  if (
    Deno.env.get("SALON_EMAIL_ENABLED") !== "true" ||
    !Deno.env.get("RESEND_API_KEY")
  )
    return reply(
      { error: "Email sender is not configured or is disabled." },
      503,
    );
  let input;
  try {
    input = await req.json();
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }
  const prepared = await userDb.rpc("prepare_staff_voucher_email", {
    p_id: input.voucher_id,
    p_email: input.email,
    p_request: input.request_id,
  });
  if (prepared.error) return reply({ error: prepared.error.message }, 400);
  const job = prepared.data;
  if (job.status === "accepted")
    return reply({
      accepted: true,
      test_recipient: "damianjmcgrath@gmail.com",
    });
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `salon-voucher/${job.id}`,
      },
      body: JSON.stringify(
        voucherPayload(
          job.snapshot,
          Deno.env.get("SALON_EMAIL_FROM") ||
            "Sculpted Testing <bookings@auth.benniescardgame.co.uk>",
        ),
      ),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json();
    if (!res.ok || !body.id) {
      await db.rpc("finish_staff_voucher_email", {
        p_request: job.id,
        p_status: "failed",
        p_error: `Resend HTTP ${res.status}`,
      });
      return reply(
        {
          error:
            "Email provider did not accept the message. Retry this request.",
        },
        502,
      );
    }
    const saved = await db.rpc("finish_staff_voucher_email", {
      p_request: job.id,
      p_status: "accepted",
      p_resend_id: body.id,
    });
    if (saved.error)
      return reply(
        {
          error:
            "Email accepted; delivery record could not be saved. Retry the same request to verify.",
        },
        502,
      );
    return reply({
      accepted: true,
      test_recipient: "damianjmcgrath@gmail.com",
    });
  } catch {
    return reply(
      { error: "Email status is uncertain. Retry the same request safely." },
      502,
    );
  }
});
