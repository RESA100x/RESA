// End-to-end smoke test for the RESA sync stack.
//   node scripts/smoke.mjs <anon-key> [base-url]
const anon = process.argv[2];
const base = process.argv[3] ?? "http://localhost:8000";
if (!anon) { console.error("usage: node scripts/smoke.mjs <anon-key> [base]"); process.exit(1); }

const stamp = Date.now();
const mk = (n) => `resa_test_${stamp}_${n}@example.com`;
const H = (token) => ({ apikey: anon, "Content-Type": "application/json", Prefer: "return=representation", ...(token ? { Authorization: `Bearer ${token}` } : {}) });

async function call(method, path, body, token) {
  const res = await fetch(`${base}${path}`, { method, headers: H(token), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const ok = (label, cond, extra) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + JSON.stringify(extra) : ""}`); if (!cond) process.exitCode = 1; };

async function signup(email) {
  const r = await call("POST", "/auth/v1/signup", { email, password: "Passw0rd!234" });
  if (r.status >= 400) throw new Error(`signup ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function signin(email) {
  const r = await call("POST", "/auth/v1/token?grant_type=password", { email, password: "Passw0rd!234" });
  if (r.status >= 400) throw new Error(`signin ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

const a = mk("a"), b = mk("b");
await signup(a); await signup(b);
const sa = await signin(a); const sb = await signin(b);
ok("sign in returns access_token", !!sa.access_token && !!sb.access_token);
ok("two users have different ids", sa.user.id !== sb.user.id);

// A: push a task into the personal workspace
const push1 = await call("POST", "/rest/v1/rpc/sync_push", {
  items: [{ entity: "tasks", record_id: "t1", payload: { title: "کار تست", assignee_user_id: sb.user.id }, updated_at: new Date().toISOString() }],
}, sa.access_token);
ok("A push accepted", push1.status === 200 && push1.data?.accepted === 1, push1.data);
const wsA = push1.data?.workspace;

// A can read it, B cannot (separate workspaces)
const pullA = await call("GET", "/rest/v1/sync_records?select=entity,record_id,payload&entity=eq.tasks", null, sa.access_token);
ok("A sees own record", pullA.status === 200 && pullA.data?.length === 1, pullA.data);
const pullB = await call("GET", "/rest/v1/sync_records?select=entity,record_id&entity=eq.tasks", null, sb.access_token);
ok("B sees nothing before invite", pullB.status === 200 && pullB.data?.length === 0, pullB.data);

// A invites B, B accepts
const inv = await call("POST", "/rest/v1/workspace_invites", { workspace_id: wsA, email: b, role: "member" }, sa.access_token);
ok("A creates invite", inv.status === 201 && !!inv.data?.[0]?.token, inv.data);
const token = inv.data[0].token;
const acc = await call("POST", "/rest/v1/rpc/accept_invite", { p_token: token }, sb.access_token);
ok("B accepts invite", acc.status === 200 && acc.data === wsA, acc.data);

// Now B sees the shared record
const pullB2 = await call("GET", "/rest/v1/sync_records?select=entity,record_id,payload&entity=eq.tasks", null, sb.access_token);
ok("B sees shared record", pullB2.status === 200 && pullB2.data?.length === 1, pullB2.data);

// B updates the task (status change) in the same workspace
const push2 = await call("POST", "/rest/v1/rpc/sync_push", {
  items: [{ entity: "tasks", record_id: "t1", payload: { title: "کار تست", status: "done", assignee_user_id: sb.user.id }, updated_at: new Date(Date.now() + 1000).toISOString() }],
  p_workspace: wsA,
}, sb.access_token);
ok("B pushes update to shared workspace", push2.status === 200 && push2.data?.accepted === 1, push2.data);

const pullA2 = await call("GET", "/rest/v1/sync_records?select=entity,record_id,payload,updated_by&entity=eq.tasks", null, sa.access_token);
ok("A sees B's update", pullA2.data?.[0]?.payload?.status === "done", pullA2.data);
ok("A can see who updated", pullA2.data?.[0]?.updated_by === sb.user.id, pullA2.data?.[0]?.updated_by);

// Outsider cannot read the workspace
const c = mk("c"); await signup(c); const sc = await signin(c);
const pullC = await call("GET", "/rest/v1/sync_records?select=record_id", null, sc.access_token);
ok("outsider sees no records", pullC.status === 200 && pullC.data?.length === 0, pullC.data);
const pushC = await call("POST", "/rest/v1/rpc/sync_push", { items: [], p_workspace: wsA }, sc.access_token);
ok("outsider cannot push into workspace", pushC.status >= 400, pushC.status);

// Members list
const mem = await call("GET", `/rest/v1/workspace_members?select=user_id,role,display_name&workspace_id=eq.${wsA}`, null, sa.access_token);
ok("workspace has 2 members", mem.status === 200 && mem.data?.length === 2, mem.data);
