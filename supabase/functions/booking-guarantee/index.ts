import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { feeState } from "./payment-state.ts";
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const allowed = (
    Deno.env.get("SALON_ALLOWED_ORIGINS") || "https://damianjmcgrath.github.io"
  )
    .split(",")
    .map((s) => s.trim());
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (allowed.includes(origin))
    Object.assign(headers, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (origin && !allowed.includes(origin))
    return reply({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  if (Deno.env.get("REVOLUT_ENVIRONMENT") !== "sandbox")
    return reply({ error: "This integration requires Sandbox mode." }, 403);
  const key = Deno.env.get("REVOLUT_SECRET_KEY");
  if (!key) return reply({ error: "Revolut Sandbox secret is missing." }, 503);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const bearer =
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth.user) return reply({ error: "Please sign in." }, 401);
  const userDb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: "Bearer " + bearer } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  async function checked(query: any) {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  }
  async function saveFee(row: any, values: Record<string, unknown>) {
    // A stale status response must never downgrade a completed/failed fee.
    const saved = await checked(
      db
        .from("no_show_fees")
        .update(values)
        .eq("appointment_id", row.appointment_id)
        .eq("state", row.state)
        .select("*")
        .maybeSingle(),
    );
    return (
      saved ||
      (await checked(
        db
          .from("no_show_fees")
          .select("*")
          .eq("appointment_id", row.appointment_id)
          .single(),
      ))
    );
  }
  async function api(path: string, body?: unknown) {
    const r = await fetch("https://sandbox-merchant.revolut.com/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "Revolut-Api-Version": path.startsWith("/customers/")
          ? "2026-08-17"
          : "2023-09-01",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const value = await r.json();
    if (!r.ok)
      throw new Error(
        "Revolut " +
          r.status +
          ": " +
          (typeof value.message === "string"
            ? value.message.slice(0, 200)
            : "Request rejected."),
      );
    return value;
  }
  try {
    const input = await req.json();
    const isStaff = await checked(userDb.rpc("is_salon_staff"));
    if (isStaff) {
      const keys = ["charge", "fee_status"].includes(input.action)
        ? ["view.diary", "view.appointments"]
        : ["view.appointments"];
      const access = await Promise.all(
        keys.map((p_key) => checked(userDb.rpc("has_permission", { p_key }))),
      );
      if (!access.some((v) => v === true))
        return reply({ error: "Permission denied for this feature." }, 403);
    }
    if (["charge", "fee_status"].includes(input.action)) {
      if (!isStaff) {
        const policy = await userDb.rpc("client_appointment_policy", {
          p_id: input.appointment_id,
        });
        if (policy.error)
          return reply({ error: "Appointment access denied." }, 403);
        const allowedFee = await db
          .from("no_show_fees")
          .select("purpose")
          .eq("appointment_id", input.appointment_id)
          .maybeSingle();
        if (allowedFee.error || allowedFee.data?.purpose !== "cancellation")
          return reply({ error: "Cancellation fee access required." }, 403);
      }
      let row = await checked(
        db
          .from("no_show_fees")
          .select("*")
          .eq("appointment_id", input.appointment_id)
          .maybeSingle(),
      );
      if (!row) return reply({ state: "not_recorded", comments: "" });
      if (input.action === "charge" && row.state === "pending") {
        const claimed = await checked(
          db
            .from("no_show_fees")
            .update({
              state: "processing",
              updated_at: new Date().toISOString(),
            })
            .eq("appointment_id", row.appointment_id)
            .eq("state", "pending")
            .select("*"),
        );
        if (claimed.length) {
          row = claimed[0];
          try {
            const appointment = await checked(
              db
                .from("appointments")
                .select("guarantee_card_id,status")
                .eq("id", row.appointment_id)
                .single(),
            );
            if (
              appointment.status !== "no_show" &&
              !(
                row.purpose === "cancellation" &&
                appointment.status === "cancelled"
              )
            )
              throw new Error("Appointment is not a no-show.");
            const card = appointment.guarantee_card_id
              ? await checked(
                  db
                    .from("booking_guarantee_cards")
                    .select("*")
                    .eq("id", appointment.guarantee_card_id)
                    .single(),
                )
              : null;
            if (
              !card?.verified_at ||
              !card.payment_method_id ||
              card.environment !== "sandbox"
            ) {
              row = await checked(
                db
                  .from("no_show_fees")
                  .update({
                    state: "failed",
                    error:
                      "No verified guarantee card was recorded for this appointment.",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("appointment_id", row.appointment_id)
                  .select("*")
                  .single(),
              );
            } else {
              const order = await api("/orders", {
                amount: row.amount_cents,
                currency: "EUR",
                customer: { id: card.customer_id },
                description:
                  "Salon Sandbox " +
                  (row.purpose === "cancellation"
                    ? "cancellation"
                    : "no-show") +
                  " fee " +
                  row.appointment_id,
              });
              // Persist the order before submitting any payment. A request is never
              // automatically repeated if an external response is lost.
              row = await checked(
                db
                  .from("no_show_fees")
                  .update({ order_id: order.id })
                  .eq("appointment_id", row.appointment_id)
                  .select("*")
                  .single(),
              );
              await api(
                "/orders/" + encodeURIComponent(order.id) + "/payments",
                {
                  saved_payment_method: {
                    type: "card",
                    id: card.payment_method_id,
                    initiator: "merchant",
                  },
                },
              );
            }
          } catch (e) {
            row = await saveFee(row, {
              state: "review",
              error: (e instanceof Error
                ? e.message
                : "Payment result unavailable."
              ).slice(0, 300),
              updated_at: new Date().toISOString(),
            });
          }
        } else
          row = await checked(
            db
              .from("no_show_fees")
              .select("*")
              .eq("appointment_id", row.appointment_id)
              .single(),
          );
      }
      let providerState: string | null = null;
      let statusError: string | null = null;
      if (row.order_id && ["processing", "review"].includes(row.state)) {
        try {
          const order = await api(
            "/orders/" + encodeURIComponent(row.order_id),
          );
          providerState = order.state || "unknown";
          const state = feeState(order);
          row = await saveFee(row, {
            state,
            error:
              state === "failed"
                ? "Revolut declined or failed the payment."
                : null,
            updated_at: new Date().toISOString(),
          });
        } catch (e) {
          // Surface lookup errors instead of silently leaving processing on screen.
          statusError =
            e instanceof Error ? e.message : "Payment status lookup failed.";
        }
      }
      return reply({
        amount_cents: row.amount_cents,
        state: row.state,
        provider_state: providerState,
        status_error: statusError,
        comments: row.comments,
        error: row.error,
        apply_fee: row.apply_fee,
        created_at: row.created_at,
        environment: "sandbox",
      });
    }
    // Card owner is the logged-in booker. Staff bookings use the selected client's
    // card with their consent; never the staff member's own card.
    let cid: string;
    if (isStaff) {
      if (!input.client_id)
        return reply(
          {
            error: "Choose the client whose card will guarantee this booking.",
          },
          400,
        );
      cid = input.client_id;
    } else {
      if (input.client_id)
        return reply(
          { error: "Cannot access another client’s saved cards." },
          403,
        );
      cid = await checked(userDb.rpc("ensure_own_client"));
    }
    const client = await checked(
      db.from("clients").select("id,name,email").eq("id", cid).single(),
    );
    if (input.action === "list") {
      const cards = await checked(
        db
          .from("booking_guarantee_cards")
          .select("id,brand,last_four")
          .eq("client_id", cid)
          .not("verified_at", "is", null)
          .order("consent_at", { ascending: false }),
      );
      return reply({
        cards,
        owner_name: client.name,
        owner_email: client.email,
      });
    }
    if (input.action === "create") {
      if (input.consent !== true)
        return reply(
          {
            error:
              "Agree to save the card for the 50% no-show / late-cancellation guarantee first.",
          },
          400,
        );
      const recent = await checked(
        db
          .from("booking_guarantee_cards")
          .select("id")
          .eq("created_by", auth.user.id)
          .gte("consent_at", new Date(Date.now() - 3600000).toISOString()),
      );
      if (recent.length >= 10)
        return reply(
          { error: "Too many card setup attempts. Please try again later." },
          429,
        );
      const order = await api("/orders", {
        amount: 0,
        currency: "EUR",
        customer: { email: client.email },
        description: "Salon Sandbox booking guarantee",
      });
      const row = await checked(
        db
          .from("booking_guarantee_cards")
          .insert({
            client_id: cid,
            created_by: auth.user.id,
            setup_order_id: order.id,
          })
          .select("id")
          .single(),
      );
      return reply({
        id: row.id,
        token: order.token,
        owner_name: client.name,
        owner_email: client.email,
      });
    }
    if (input.action !== "verify")
      return reply({ error: "Unknown action." }, 400);
    const row = await checked(
      db
        .from("booking_guarantee_cards")
        .select("*")
        .eq("id", input.card_id)
        .eq("client_id", cid)
        .single(),
    );
    const order = await api(
      "/orders/" + encodeURIComponent(row.setup_order_id),
    );
    if (order.state !== "completed")
      return reply({ verified: false, setup_state: order.state });
    const customer = order.customer?.id;
    const methods = customer
      ? (
          await api(
            "/customers/" +
              encodeURIComponent(customer) +
              "/payment-methods?only_merchant=true",
          )
        ).payment_methods || []
      : [];
    const card = methods.find((m: any) => m.type === "card");
    if (!card) return reply({ verified: false, setup_state: order.state });
    const paymentDetails =
      order.payments?.find((p: any) => p.payment_method?.id === card.id)
        ?.payment_method ||
      order.payments?.[0]?.payment_method ||
      {};
    const details = card.card || card.method_details || card;
    const brand = details.brand || card.brand || paymentDetails.brand || "Card";
    const lastFour =
      details.last_four || card.last_four || paymentDetails.last_four || null;
    await checked(
      db
        .from("booking_guarantee_cards")
        .update({
          customer_id: customer,
          payment_method_id: card.id,
          brand: brand,
          last_four: lastFour,
          verified_at: new Date().toISOString(),
        })
        .eq("id", row.id),
    );
    return reply({
      verified: true,
      id: row.id,
      brand: brand,
      last_four: lastFour,
    });
  } catch (e) {
    return reply(
      {
        error:
          e instanceof Error ? e.message : "Booking guarantee request failed.",
      },
      400,
    );
  }
});
