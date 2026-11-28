// Prints the two API keys the stack needs, signed with JWT_SECRET.
//
//   node scripts/keys.mjs <jwt-secret>
//
// `anon` goes into the desktop build (RESA_SYNC_ANON_KEY); `service_role` is
// only for server-side maintenance and must never ship.
import { createHmac } from "node:crypto";

const secret = process.argv[2] ?? process.env.JWT_SECRET;
if (!secret) {
  console.error("usage: node scripts/keys.mjs <jwt-secret>");
  process.exit(1);
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function sign(role) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ role, iss: "resa", iat: now, exp: now + 60 * 60 * 24 * 365 * 10 });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

console.log(`ANON_KEY=${sign("anon")}`);
console.log(`SERVICE_KEY=${sign("service_role")}`);
