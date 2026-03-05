// app/utils/logistics-token.server.js
import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET || "dev-secret";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sign(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function createLogisticsToken(userId) {
  const payload = {
    uid: String(userId),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(data);
  return `${data}.${signature}`;
}

export function verifyLogisticsToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, signature] = parts;
  if (!data || !signature) return null;
  if (sign(data) !== signature) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
    if (!payload || typeof payload.uid !== "string") return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
