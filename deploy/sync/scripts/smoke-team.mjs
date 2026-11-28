// Second half of the smoke test: the exact calls the desktop app makes for
// accounts and team workspaces.
//   node scripts/smoke-team.mjs <anon-key> [base-url]
const anon = process.argv[2];
const base = process.argv[3] ?? "http://localhost:8000";
if (!anon) { console.error("usage: node scripts/smoke-team.mjs <anon-key> [base]"); process.exit(1); }

const stamp = Date.now();
const mk = (n) => `resa_team_${stamp}_${n}@example.com`;
const H = (token) => ({ apikey: anon, "Content-Type": "application/json", Prefer: "return=representation", ...(token ? { Authorization: `Bearer ${token}` } : {}) });

async function call(method, path, body, token) {
  const res = await fetch(`${base}${path}`, { method, headers: H(token), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const ok = (label, cond, extra) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`); if (!cond) process.exitCode = 1; };

async function account(email) {
  const up = await call("POST", "/auth/v1/signup", { email, password: "Passw0rd!234" });
  if (up.status >= 400) throw new Error(`signup ${email}: ${up.status} ${JSON.stringify(up.data)}`);
  const inn = await call("POST", "/auth/v1/token?grant_type=password", { email, password: "Passw0rd!234" });
  if (inn.status >= 400) throw new Error(`signin ${email}: ${inn.status} ${JSON.stringify(inn.data)}`);
  return inn.data;
}

const a = await account(mk("a"));
const b = await account(mk("b"));

// ensure_personal_workspace returns a bare uuid, as the client expects.
const ws = await call("POST", "/rest/v1/rpc/ensure_personal_workspace", {}, a.access_token);
ok("ensure_personal_workspace returns a uuid", ws.status === 200 && typeof ws.data === "string" && ws.data.length === 36, ws.data);
const wsId = ws.data;
const again = await call("POST", "/rest/v1/rpc/ensure_personal_workspace", {}, a.access_token);
ok("it is idempotent", again.data === wsId, again.data);

// The embedded select the workspace list uses.
const list = await call("GET", "/rest/v1/workspace_members?select=role,workspace_id,workspaces(id,name)&order=created_at.asc", null, a.access_token);
ok("embedded workspaces select works", list.status === 200 && Array.isArray(list.data) && list.data[0]?.workspaces?.id === wsId, list.data);

// Creating a second workspace (owner insert policy + member bootstrap).
const created = await call("POST", "/rest/v1/workspaces", { name: "تیم تست", owner_id: a.user.id }, a.access_token);
ok("owner can create a workspace", created.status === 201 && !!created.data?.[0]?.id, created.data);
const teamId = created.data?.[0]?.id;
const joined = await call("POST", "/rest/v1/workspace_members", { workspace_id: teamId, user_id: a.user.id, role: "owner" }, a.access_token);
ok("owner bootstraps their own membership", joined.status === 201, joined.data);

// Display name: a member may rename themselves.
const named = await call("PATCH", `/rest/v1/workspace_members?workspace_id=eq.${wsId}&user_id=eq.${a.user.id}`, { display_name: "رضا" }, a.access_token);
ok("member can set their display name", named.status === 200 && named.data?.[0]?.display_name === "رضا", named.data);

// Invite, re-invite (must replace, not fail), accept.
const inv1 = await call("POST", "/rest/v1/workspace_invites", { workspace_id: wsId, email: mk("b"), role: "member" }, a.access_token);
ok("first invite", inv1.status === 201 && !!inv1.data?.[0]?.token, inv1.data);
const bEmail = mk("b2");
await call("POST", "/rest/v1/workspace_invites", { workspace_id: wsId, email: bEmail, role: "member" }, a.access_token);
const del = await call("DELETE", `/rest/v1/workspace_invites?workspace_id=eq.${wsId}&email=eq.${encodeURIComponent(bEmail)}&accepted_at=is.null`, null, a.access_token);
const inv2 = await call("POST", "/rest/v1/workspace_invites", { workspace_id: wsId, email: bEmail, role: "member" }, a.access_token);
ok("re-invite after delete works", del.status === 204 || del.status === 200, del.status);
ok("second invite has a fresh token", inv2.status === 201 && !!inv2.data?.[0]?.token, inv2.data);

const acc = await call("POST", "/rest/v1/rpc/accept_invite", { p_token: inv2.data[0].token }, b.access_token);
ok("invitee joins", acc.status === 200 && acc.data === wsId, acc.data);

// A plain member cannot invite (managers only).
const bInvite = await call("POST", "/rest/v1/workspace_invites", { workspace_id: wsId, email: mk("c"), role: "member" }, b.access_token);
ok("a plain member cannot invite", bInvite.status >= 400, bInvite.status);

// A plain member cannot promote themselves to owner.
const promote = await call("PATCH", `/rest/v1/workspace_members?workspace_id=eq.${wsId}&user_id=eq.${b.user.id}`, { role: "owner" }, b.access_token);
const roles = await call("GET", `/rest/v1/workspace_members?select=user_id,role&workspace_id=eq.${wsId}`, null, a.access_token);
const bRole = roles.data?.find((row) => row.user_id === b.user.id)?.role;
ok("a member cannot promote themselves", bRole === "member", { patch: promote.status, role: bRole });
