// Edge Function: admin-users — lets an ADMIN of the app create accounts and reset passwords from inside the app.
// The service-role key never leaves the server. Every call is checked against the caller's own login (must be an active admin).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ROLES = ["admin", "sales", "operations", "warehouse", "shipping", "none"];
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";

    // 1) who is calling? must be a signed-in, active admin of the app
    const asUser = createClient(url, key, { global: { headers: { Authorization: auth } } });
    const me = await asUser.rpc("my_profile");
    if (me.error || !me.data || me.data.role !== "admin") return json({ error: "Admins only." }, 403);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const b = await req.json();

    if (b.action === "create") {
      const email = String(b.email ?? "").trim().toLowerCase();
      const password = String(b.password ?? "");
      const name = String(b.name ?? "").trim();
      const role = String(b.role ?? "none");
      if (!name) return json({ error: "Name is required." }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email." }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      if (!ROLES.includes(role)) return json({ error: "Unknown role." }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name },
      });
      if (error) return json({ error: error.message }, 400);

      // the database trigger already made the profile; set its name + role (runs as the admin, so the app's own rules apply)
      const r = await asUser.rpc("set_user", { p_id: data.user.id, p_name: name, p_role: role, p_active: true });
      if (r.error) {
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ error: r.error.message }, 400);
      }
      return json({ ok: true, id: data.user.id });
    }

    if (b.action === "reset_password") {
      const password = String(b.password ?? "");
      const id = String(b.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Bad account id." }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
