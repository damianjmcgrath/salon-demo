// Temporary backend-only diagnostic: creates one sandbox EUR 0 order.
// Invoke from Supabase's dashboard with the service-role Authorization header.
// Never put the service-role key in frontend code.
Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey || req.headers.get("Authorization") !== "Bearer " + serviceKey)
    return reply({ error: "Use the dashboard service-role Authorization header." }, 401);
  if (Deno.env.get("REVOLUT_ENVIRONMENT") !== "sandbox")
    return reply({ error: "This diagnostic only runs in sandbox." }, 403);
  const key = Deno.env.get("REVOLUT_SECRET_KEY");
  if (!key) return reply({ error: "REVOLUT_SECRET_KEY is missing." }, 503);
  try {
    const response = await fetch("https://sandbox-merchant.revolut.com/api/orders", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "Revolut-Api-Version": "2023-09-01",
      },
      body: JSON.stringify({
        amount: 0, currency: "EUR",
        customer: { email: "sandbox-card-setup@example.com" },
        description: "Sandbox zero-value card setup diagnostic",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (!response.ok) return reply({
      zero_order_accepted: false,
      revolut_status: response.status,
      error_code: body.code ?? null,
      message: typeof body.message === "string" ? body.message.slice(0, 500) : "Revolut rejected the zero-value order.",
    });
    return reply({
      zero_order_accepted: true,
      order_id: body.id,
      state: body.state,
      message: "Order created. Card authentication and reusable-card setup still need a separate checkout test.",
    });
  } catch {
    return reply({ error: "Could not obtain a response from Revolut. Check the key and try again." }, 502);
  }
});
