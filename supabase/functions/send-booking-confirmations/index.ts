import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { confirmationPayload } from "./email.ts";
Deno.serve(async (req) => {
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  if (req.method !== "POST") return response({ error: "POST required" }, 405);
  const secret = Deno.env.get("SALON_EMAIL_WORKER_SECRET");
  if (!secret || req.headers.get("x-salon-email-secret") !== secret)
    return response({ error: "Not authorized" }, 401);
  if (Deno.env.get("SALON_EMAIL_ENABLED") !== "true")
    return response({ error: "Email sender disabled" }, 503);
  const key = Deno.env.get("RESEND_API_KEY");
  const from =
    Deno.env.get("SALON_EMAIL_FROM") ||
    "Sculpted Testing <bookings@auth.benniescardgame.co.uk>";
  if (!key) return response({ error: "Resend key not configured" }, 503);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: jobs, error } = await db.rpc("claim_booking_emails");
  if (error)
    return response({ error: "Could not claim queued confirmations" }, 500);
  let accepted = 0,
    failed = 0;
  for (const job of jobs || []) {
    const payload = job.payload || confirmationPayload(job.snapshot, from);
    const saved = await db
      .from("booking_email_queue")
      .update({ payload })
      .eq("id", job.id)
      .eq("claim_token", job.claim_token)
      .eq("status", "processing")
      .select("id");
    if (saved.error || !saved.data?.length) {
      failed++;
      continue;
    }
    let update: Record<string, unknown>;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `salon-booking/${job.id}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json();
      if (res.ok && body.id) {
        update = { status: "accepted", resend_id: body.id, last_error: null };
        accepted++;
      } else {
        const retry = res.status === 429 || res.status >= 500;
        update = {
          status: retry ? "pending" : "failed",
          last_error: `Resend HTTP ${res.status}: ${String(body.name || "request_error").slice(0, 100)}`,
        };
        failed++;
      }
    } catch {
      update = {
        status: "pending",
        last_error:
          "Network/timeout failure; safely retry with same idempotency key.",
      };
      failed++;
    }
    const result = await db
      .from("booking_email_queue")
      .update({
        ...update,
        locked_until: null,
        next_attempt_at: new Date(Date.now() + 5 * 60000).toISOString(),
      })
      .eq("id", job.id)
      .eq("claim_token", job.claim_token);
    // If recording acceptance fails, the lease expires and the same frozen payload/idempotency key is retried.
    if (result.error) failed++;
  }
  return response({ accepted, failed, processed: jobs?.length || 0 });
});
