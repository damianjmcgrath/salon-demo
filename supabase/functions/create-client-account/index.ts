// Deploy only to the fictional-data development project. Never ship a browser service key.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const salonOrigins = (
  Deno.env.get("SALON_ALLOWED_ORIGINS") || "https://damianjmcgrath.github.io"
)
  .split(",")
  .map((s) => s.trim());
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (salonOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (origin && !salonOrigins.includes(origin))
    return respond({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return respond({ error: "Method not allowed." }, 405);
  if (Deno.env.get("SALON_DEMO_ACCOUNT_PROVISIONING") !== "true")
    return respond(
      {
        error:
          "Fictional demo account provisioning is disabled. Set SALON_DEMO_ACCOUNT_PROVISIONING=true only in the development project.",
      },
      503,
    );
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return respond({ error: "Sign-in required." }, 401);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: identity, error: authError } = await admin.auth.getUser(token);
  if (authError || !identity.user)
    return respond({ error: "Sign-in required." }, 401);
  const uid = identity.user.id;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid request." }, 400);
  }
  const action = body.action || "create";
  const password =
    action === "set_password" ? body.password : body.temporary_password;
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    return respond({ error: "Password must contain 12–128 characters." }, 400);
  if (action === "set_password") {
    if (!identity.user.app_metadata.requires_password_change)
      return respond({ error: "No initial password change is pending." }, 403);
    const { data: c } = await admin
      .from("clients")
      .select("id")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (!c) return respond({ error: "Client account required." }, 403);
    const result = await admin.auth.admin.updateUserById(uid, {
      password,
      app_metadata: {
        ...identity.user.app_metadata,
        requires_password_change: false,
      },
    });
    if (result.error)
      return respond({ error: "Unable to update password." }, 400);
    await admin.from("audit_events").insert({
      user_id: uid,
      client_id: c.id,
      action: "client_initial_password_changed",
    });
    return respond({ success: true });
  }
  if (action !== "create") return respond({ error: "Unknown action." }, 400);
  const { data: membership } = await admin
    .from("staff_users")
    .select("role")
    .eq("user_id", uid)
    .maybeSingle();
  if (
    !membership ||
    !["staff", "admin", "it_support"].includes(membership.role)
  )
    return respond({ error: "Staff access required." }, 403);
  if (typeof body.client_id !== "string")
    return respond({ error: "Client required." }, 400);
  // Serialize concurrent provisioning for the same client through a reservation RPC.
  const reservation = await admin.rpc("reserve_client_account", {
    p_client_id: body.client_id,
    p_actor_id: uid,
  });
  if (reservation.error)
    return respond(
      {
        error:
          "Client already has a login or account creation is in progress. Refresh and retry.",
      },
      409,
    );
  const c = reservation.data;
  let createdId: string | null = null;
  try {
    const created = await admin.auth.admin.createUser({
      email: c.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: c.name, mobile: c.phone },
      app_metadata: { requires_password_change: true },
    });
    if (created.error || !created.data.user)
      throw Error(
        "Could not create login. The email may already have an account. No existing account has been linked.",
      );
    createdId = created.data.user.id;
    const link = await admin.rpc("link_client_account", {
      p_client_id: c.id,
      p_user_id: createdId,
    });
    if (link.error) throw Error("Could not link this login to the client.");
    const { data: client, error: refreshError } = await admin
      .from("clients")
      .select("*")
      .eq("id", c.id)
      .single();
    if (refreshError || !client)
      return respond(
        {
          error:
            "Login created, but the record could not be refreshed. Refresh the client record.",
          account_created: true,
        },
        503,
      );
    return respond({ client });
  } catch (e) {
    // Delete only the newly created login if linking did not succeed. Never touch an existing identity.
    if (createdId) {
      const { data: linked } = await admin
        .from("clients")
        .select("auth_user_id")
        .eq("id", c.id)
        .single();
      if (linked?.auth_user_id !== createdId)
        await admin.auth.admin.deleteUser(createdId);
    }
    return respond({ error: (e as Error).message }, 400);
  } finally {
    await admin.rpc("release_client_account_reservation", {
      p_client_id: c.id,
      p_actor_id: uid,
    });
  }
});
