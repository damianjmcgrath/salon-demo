import { createClient } from "npm:@supabase/supabase-js@2.57.0";
// Sandbox only. User authentication and admin authorization are verified here.
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
    return reply({ error: "Sandbox mode is required." }, 403);
  const key = Deno.env.get("REVOLUT_SECRET_KEY");
  if (!key) return reply({ error: "Revolut sandbox secret is missing." }, 503);
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
  const { data: isAdmin, error: roleError } =
    await userDb.rpc("is_salon_admin");
  if (roleError)
    return reply(
      { error: "Unable to verify admin access: " + roleError.message },
      503,
    );
  const { data: canReport, error: permissionError } = await userDb.rpc(
    "has_permission",
    { p_key: "view.reporting" },
  );
  if (permissionError || canReport !== true)
    return reply({ error: "Reporting permission required." }, 403);
  if (isAdmin !== true)
    return reply(
      {
        error:
          "Admin access required. Sign out and select Aoife in the Staff Portal.",
      },
      403,
    );
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
        (path.startsWith("/customers/")
          ? "Saved-card lookup"
          : body
            ? "Payment request"
            : "Order lookup") +
          " — Revolut " +
          r.status +
          ": " +
          (typeof value.message === "string"
            ? value.message.slice(0, 300)
            : "Request rejected."),
      );
    return value;
  }
  try {
    const input = await req.json();
    if (input.action === "create") {
      if (input.consent !== true)
        return reply({ error: "Confirm sandbox consent first." }, 400);
      const order = await api("/orders", {
        amount: 0,
        currency: "EUR",
        customer: { email: "sandbox-card-setup@example.com" },
        description: "Salon sandbox saved-card test",
      });
      const { data: row, error } = await db
        .from("revolut_sandbox_tests")
        .insert({ user_id: auth.user.id, setup_order_id: order.id })
        .select("id")
        .single();
      if (error)
        throw new Error(
          "Test table unavailable. Apply 016_revolut_sandbox.sql.",
        );
      return reply({ test_id: row.id, token: order.token });
    }
    if (!["status", "charge"].includes(input.action))
      return reply({ error: "Unknown action." }, 400);
    const { data: row, error } = await db
      .from("revolut_sandbox_tests")
      .select("*")
      .eq("id", input.test_id)
      .eq("user_id", auth.user.id)
      .single();
    if (error || !row) return reply({ error: "Test not found." }, 404);
    const setup = await api(
      "/orders/" + encodeURIComponent(row.setup_order_id),
    );
    const customer = setup.customer?.id;
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
    if (input.action === "status") {
      const charge = row.charge_order_id
        ? await api("/orders/" + encodeURIComponent(row.charge_order_id))
        : null;
      return reply({
        setup_state: setup.state,
        saved_card: card
          ? { brand: card.brand, last_four: card.last_four }
          : null,
        charge_attempted: row.charge_attempted,
        charge_state: charge?.state || null,
      });
    }
    if (!card)
      return reply(
        {
          error:
            "No merchant-enabled saved card found. Complete card setup first.",
        },
        409,
      );
    const { data: claimed, error: claimError } = await db
      .from("revolut_sandbox_tests")
      .update({ charge_attempted: true })
      .eq("id", row.id)
      .eq("charge_attempted", false)
      .select("id");
    if (claimError) throw new Error("Could not reserve the test charge.");
    if (!claimed?.length)
      return reply(
        {
          error:
            "A charge has already been attempted for this test. Check its status.",
        },
        409,
      );
    const charge = await api("/orders", {
      amount: 1000,
      currency: "EUR",
      customer: { id: customer },
      description: "Salon sandbox EUR 10 no-show test",
    });
    const { error: saveError } = await db
      .from("revolut_sandbox_tests")
      .update({ charge_order_id: charge.id })
      .eq("id", row.id);
    if (saveError)
      throw new Error("Could not record charge order. No payment submitted.");
    const payment = await api(
      "/orders/" + encodeURIComponent(charge.id) + "/payments",
      {
        saved_payment_method: {
          type: "card",
          id: card.id,
          initiator: "merchant",
        },
      },
    );
    return reply({ payment_state: payment.state, order_id: charge.id });
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Sandbox request failed." },
      400,
    );
  }
});
