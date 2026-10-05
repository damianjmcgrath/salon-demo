// Fictional development PIN login. No PIN hashes or service keys reach the browser.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const origins = (
  Deno.env.get("SALON_ALLOWED_ORIGINS") || "https://damianjmcgrath.github.io"
)
  .split(",")
  .map((s) => s.trim());
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (origin && !origins.includes(origin))
    return reply({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return reply({ error: "Method not allowed." }, 405);
  if (Deno.env.get("SALON_DEMO_PIN_LOGIN") !== "true")
    return reply(
      {
        error:
          "PIN login is not enabled. Use your individual email/password account.",
      },
      503,
    );
  try {
    const { profile, pin } = await req.json();
    if (
      typeof profile !== "string" ||
      typeof pin !== "string" ||
      profile.length > 80 ||
      !/^\d{4}$/.test(pin)
    )
      return reply(
        { error: "Invalid PIN or profile temporarily locked." },
        401,
      );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: check, error } = await admin.rpc("verify_staff_pin", {
      p_profile: profile,
      p_pin: pin,
    });
    if (error || !check?.valid)
      return reply(
        { error: "Invalid PIN or profile temporarily locked." },
        401,
      );
    let uid = check.user_id;
    if (!uid) {
      const email = `salon-staff-${check.staff_id}@staff.invalid`;
      const created = await admin.auth.admin.createUser({
        email,
        password: crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { salon_pin_profile: profile },
      });
      if (created.error || !created.data.user)
        return reply(
          {
            error:
              "Unable to create the staff login. Ask the admin to check its account link.",
          },
          409,
        );
      uid = created.data.user.id;
      const linked = await admin.rpc("link_staff_pin_account", {
        p_staff_id: check.staff_id,
        p_user_id: uid,
      });
      if (linked.error) {
        await admin.auth.admin.deleteUser(uid);
        return reply(
          { error: "Unable to link the staff account. Please retry." },
          409,
        );
      }
    }
    const identity = await admin.auth.admin.getUserById(uid);
    if (identity.error || !identity.data.user?.email)
      return reply({ error: "Staff login unavailable." }, 401);
    // Generate and consume the sign-in token server-side; this does not send an email.
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: identity.data.user.email,
    });
    if (link.error || !link.data.properties?.hashed_token)
      return reply({ error: "Staff login unavailable." }, 401);
    const result = await admin.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: "magiclink",
    });
    if (result.error || !result.data.session)
      return reply({ error: "Staff login unavailable." }, 401);
    return reply({
      session: {
        access_token: result.data.session.access_token,
        refresh_token: result.data.session.refresh_token,
      },
    });
  } catch {
    return reply({ error: "Staff login unavailable. Please retry." }, 400);
  }
});
