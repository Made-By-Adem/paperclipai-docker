import { Router, type Request, type Response } from "express";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@agentsai/db";
import { authUsers, authSessions } from "@agentsai/db";
import { deriveAuthCookiePrefix } from "./better-auth.js";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_ROLES = new Set(["admin", "super_admin", "superadmin", "super-admin"]);

type SsoTokenPayload = {
  userId: string | number;
  email: string;
  name: string | null;
  role: string;
  typ: string;
  iat?: number;
  exp?: number;
};

function getSsoSecret(): string | null {
  return (process.env.AGENTS_SSO_SECRET || process.env.JWT_SECRET || "").trim() || null;
}

function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(String(role).toLowerCase().replace(/\s+/g, "_"));
}

function base64UrlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function verifyJwtHs256(token: string, secret: string): { ok: true; payload: SsoTokenPayload } | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid header" };
  }
  if (header.alg !== "HS256") return { ok: false, reason: `unsupported alg: ${header.alg}` };

  const expected = createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest();
  let provided: Buffer;
  try {
    provided = base64UrlDecode(signatureB64);
  } catch {
    return { ok: false, reason: "invalid signature encoding" };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "invalid signature" };
  }

  let payload: SsoTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as SsoTokenPayload;
  } catch {
    return { ok: false, reason: "invalid payload" };
  }

  if (typeof payload.exp === "number") {
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) return { ok: false, reason: "jwt expired" };
  }

  return { ok: true, payload };
}

function verifySsoToken(token: string): { ok: true; claims: SsoTokenPayload } | { ok: false; reason: string } {
  const secret = getSsoSecret();
  if (!secret) return { ok: false, reason: "SSO not configured (AGENTS_SSO_SECRET unset)" };

  const result = verifyJwtHs256(token, secret);
  if (!result.ok) return result;

  const decoded = result.payload;
  if (decoded.typ !== "agents_sso") return { ok: false, reason: "Wrong token type" };
  if (!decoded.email || !decoded.userId) return { ok: false, reason: "Token missing required claims" };
  if (!decoded.role || !isAdminRole(decoded.role)) {
    return { ok: false, reason: "Only admins and super-admins may sign in to Agents" };
  }
  return { ok: true, claims: decoded };
}

async function findOrCreateUser(db: Db, claims: SsoTokenPayload): Promise<string> {
  const existing = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.email, claims.email))
    .then((rows) => rows[0] ?? null);

  if (existing) return existing.id;

  const id = randomUUID();
  const now = new Date();
  await db.insert(authUsers).values({
    id,
    name: claims.name ?? claims.email.split("@")[0],
    email: claims.email,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createSession(
  db: Db,
  userId: string,
  req: Request,
): Promise<string> {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  await db.insert(authSessions).values({
    id,
    token,
    userId,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  });
  return token;
}

function setBetterAuthSessionCookie(res: Response, token: string, secure: boolean): void {
  const prefix = deriveAuthCookiePrefix();
  const cookieName = secure ? `__Secure-${prefix}.session_token` : `${prefix}.session_token`;
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS,
  });
}

export function cxAssistSsoRoutes(db: Db) {
  const router = Router();

  router.get("/handoff", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : null;
    if (!token) {
      res.status(400).send("Missing token");
      return;
    }

    const verification = verifySsoToken(token);
    if (!verification.ok) {
      res.status(401).send(`SSO failed: ${verification.reason}`);
      return;
    }

    const userId = await findOrCreateUser(db, verification.claims);
    const sessionToken = await createSession(db, userId, req);

    const publicUrl = (process.env.PAPERCLIP_PUBLIC_URL ?? "").trim();
    const secure = publicUrl.startsWith("https://");
    setBetterAuthSessionCookie(res, sessionToken, secure);

    res.redirect(303, "/");
  });

  return router;
}
