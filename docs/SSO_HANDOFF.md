# SSO Handoff — cx-assist → Agents

This is the active SSO mechanism. It connects two apps living on **different top-level domains**:

- `app.cx-assist.com` (the cx-assist platform — login, admin, all existing features)
- `agents.cx-assist.io` (Agents — the AI orchestration feature)

Because these are different TLDs (`.com` vs `.io`), browsers will not share cookies between them. So we use a **signed one-time token** in a redirect URL instead.

---

## Flow

```
1. Admin logs into app.cx-assist.com (existing flow, unchanged)
2. Admin clicks "Agents" tab in the cx-assist sidebar
3. cx-assist backend issues a one-time SSO token (60-second JWT)
   payload: { userId, email, role, name, typ: "agents_sso" }
4. Browser redirects to: agents.cx-assist.io/api/auth/sso/handoff?token=<jwt>
5. Agents backend:
   a. Verifies JWT signature with shared secret
   b. Confirms typ === "agents_sso" and exp not past
   c. Confirms role is admin / super_admin
   d. Find-or-create user in BetterAuth
   e. Create BetterAuth session, set session cookie
   f. Redirect to /
6. Admin sees Agents dashboard. No login screen.
```

If the admin opens `agents.cx-assist.io` **directly** (without going through cx-assist), they will see the normal Agents login page — they need to start at cx-assist for the seamless flow.

---

## Files changed

### cx-assist backend (`N:\projects\OkraDatacom\backendserver`)

| File | What changed |
|---|---|
| `src/utils/sso/agents-sso.js` | New helper — `generateAgentsSsoToken()`, `buildAgentsHandoffUrl()` |
| `src/controllers/auth.controller.js` | New `startAgentsSso` controller — auth-protected endpoint that returns `{ url }` |
| `src/routes/v1/auth.routes.js` | New route — `POST /api/v1/auth/sso/agents` |

### cx-assist frontend (`N:\projects\OkraDatacom\frontend`)

| File | What changed |
|---|---|
| `src/layout/AppSidebar.tsx` | New "Agents" nav item (super_admin/admin roles only) — clicking it POSTs to `/auth/sso/agents` and redirects to the returned URL |

### Agents (this repo)

| File | What changed |
|---|---|
| `agents-ai/server/src/auth/cx-assist-sso.ts` | New module — verifies SSO JWT, find-or-creates BetterAuth user, creates session |
| `agents-ai/server/src/app.ts` | Registers `/api/auth/sso/handoff` route before BetterAuth's catch-all |
| `docker-compose.yaml` | Passes `JWT_SECRET` and `AGENTS_SSO_SECRET` to the server |
| `.env.example` | Documents the shared secret variable |

---

## Required environment variables

### Both apps must share the same secret

The signing secret must be **identical** on cx-assist (signing) and Agents (verifying).

#### Cx-assist `.env`
```bash
# Either reuses JWT_SECRET (default) or has a dedicated AGENTS_SSO_SECRET.
# AGENTS_SSO_SECRET takes precedence if both are set.
JWT_SECRET=<existing>
# AGENTS_SSO_SECRET=<optional, recommended for production isolation>

AGENTS_PUBLIC_URL=https://agents.cx-assist.io
```

#### Agents `.env`
```bash
# Same value as cx-assist's JWT_SECRET (or AGENTS_SSO_SECRET if set there).
JWT_SECRET=<must match cx-assist>
# AGENTS_SSO_SECRET=<optional, recommended for production isolation>
```

> **Recommendation:** Use `AGENTS_SSO_SECRET` (a dedicated random value) instead of reusing `JWT_SECRET`. If `JWT_SECRET` ever has to be rotated for the platform, you don't want SSO breaking simultaneously. Generate with `openssl rand -hex 64`.

### ⚠️ Rotation requirement

The `JWT_SECRET` value previously appeared in chat. **Before deploying, rotate it.** Steps:

1. Generate new value: `openssl rand -hex 64`
2. Update cx-assist production `.env` → restart cx-assist API
3. (Optional but recommended) Generate a separate `AGENTS_SSO_SECRET` and put the same value on both sides
4. Update Agents production `.env` → restart Agents

Until rotation is done, anyone with the leaked value could mint a token that Agents would accept as valid.

---

## Security notes

- **Token TTL is 60 seconds.** A handoff URL is unusable a minute after issue. There's no refresh — a stale link forces the admin to click "Agents" again.
- **Role gate enforced twice** — once in cx-assist before issuing the token (only admin/super_admin gets a URL) and once in Agents before creating the session (defense in depth).
- **Token type tag** — every SSO JWT carries `typ: "agents_sso"` so a regular access/refresh token can't be reused as an SSO handoff.
- **Tokens travel in the URL** — they appear in browser history, server logs, and Referer headers. The 60-second TTL limits the damage if a log gets leaked, but for highest assurance, switch to POST-form handoff (see "Future hardening" below).
- **HTTPS only in production** — never disable TLS on either side; the token is sensitive in transit.

---

## Test plan (manual smoke test)

After both apps are deployed with matching secrets:

1. Open an incognito window. Go to `https://app.cx-assist.com/login`
2. Log in as an admin or super-admin user
3. Sidebar should show an **Agents** item with a bot icon
4. Click it
5. Expected: page redirects through `agents.cx-assist.io/api/auth/sso/handoff?token=...`, then lands on `agents.cx-assist.io/` showing the Agents dashboard. No login form.
6. Refresh the Agents page — you should stay logged in (BetterAuth session persists).
7. Open another incognito window. Log in as a non-admin user (e.g. `agent`, `business_admin`).
8. The Agents item should NOT appear in the sidebar (filtered by role).
9. Manually navigate to `https://agents.cx-assist.io` — you should see the normal Agents login screen, not auto-signed-in.

### Common failures and what they mean

| Symptom | Likely cause |
|---|---|
| `SSO failed: invalid signature` | `JWT_SECRET` differs between cx-assist and Agents |
| `SSO failed: jwt expired` | Took >60s between issue and click; click "Agents" again |
| `SSO failed: Wrong token type` | Someone tried to reuse a regular login JWT — working as intended |
| `SSO failed: Only admins...` | User has neither admin nor super_admin role; Agents refuses |
| `403` from cx-assist `/auth/sso/agents` | User isn't authenticated at cx-assist or lacks admin role |
| Cookie not set after redirect | Agents `PAPERCLIP_PUBLIC_URL` doesn't start with `https://` in prod |

---

## Future hardening (not blocking initial rollout)

- **POST-form handoff** instead of URL-encoded token. Use a tiny auto-submitting HTML form so the token never appears in the URL bar / browser history / Referer.
- **One-shot consumption** — store an issued token's `jti` in Redis; reject the second use. Today, a leaked token within its 60s window can be replayed once.
- **IP binding** — encode the requesting IP into the token; require Agents to see the same IP at the handoff endpoint. Blocks token-passing attacks if Wi-Fi is sniffed.
- **Audit log on Agents side** — record every successful handoff with `userId`, IP, UA, timestamp. Useful when something looks off.
