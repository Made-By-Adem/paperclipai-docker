# Cognito SSO — Setup & Handover

This guide explains how to wire the **Agents** deployment to the **cx-assist** platform's AWS Cognito User Pool so admins and super-admins log in once and are auto-authenticated into Agents.

---

## Architecture

```
Admin browser
      │
      │  https://app.cx-assist.io  (logs in once)
      ▼
┌────────────────────┐         ┌──────────────────────────┐
│ cx-assist platform │ ───────▶│ AWS Cognito User Pool    │
└────────────────────┘         │ eu-west-2_pgov6mOhU      │
                               └──────────────────────────┘
                                          ▲
                                          │  (admin clicks "Agents" tab)
                                          │
                               ┌──────────────────────────┐
                               │ agents.cx-assist.io      │
                               │  - sees Cognito session  │
                               │  - issues Agents session │
                               └──────────────────────────┘
```

The Agents server runs `better-auth` with a generic OIDC plugin configured against the cx-assist Cognito User Pool. When an admin lands on `agents.cx-assist.io`, BetterAuth redirects to Cognito's hosted UI; if Cognito already has a session for that user, the redirect happens silently and the admin is back in Agents within a second.

---

## What needs to happen on the AWS side

The Agents code already has the OIDC integration wired up. Before it can run, **someone with AWS Console access** needs to do the following in the existing Cognito User Pool (`eu-west-2_pgov6mOhU`):

### 1. Set up a Cognito Hosted UI domain (one-time)

Cognito's OAuth flow requires a Hosted UI domain. Skip this step if one already exists for the User Pool.

1. AWS Console → Cognito → User Pools → `eu-west-2_pgov6mOhU`
2. **App integration** tab → **Domain** → **Create Cognito domain**
3. Pick a prefix, e.g. `cx-assist-auth` → final domain becomes `cx-assist-auth.auth.eu-west-2.amazoncognito.com`
4. Save the prefix — you'll need it as `COGNITO_DOMAIN=cx-assist-auth`

> The hosted UI is free and doesn't need a custom domain to start. You can later add `auth.cx-assist.io` as a custom domain via ACM if desired.

### 2. Create a new App Client for Agents

Don't reuse the cx-assist platform's existing app client — create a dedicated one for Agents so its callback URLs and scopes are scoped correctly.

1. AWS Console → Cognito → User Pools → `eu-west-2_pgov6mOhU` → **App integration** tab
2. Scroll to **App clients and analytics** → **Create app client**
3. Settings:
   - **App client type:** Confidential client
   - **App client name:** `agents-cx-assist`
   - **Authentication flows:** check "ALLOW_USER_SRP_AUTH" (other defaults fine)
   - **Generate a client secret:** ✅ yes
4. **Hosted UI settings**:
   - **Allowed callback URLs:** `https://agents.cx-assist.io/api/auth/oauth2/callback/cognito`
   - **Allowed sign-out URLs:** `https://agents.cx-assist.io`
   - **OAuth 2.0 grant types:** ✅ Authorization code grant
   - **OpenID Connect scopes:** ✅ openid, ✅ email, ✅ profile
5. **Create app client** → copy the **Client ID** and **Client Secret** that appear

### 3. Put the values into the Agents `.env`

On the AWS host running the Agents Docker stack:

```bash
COGNITO_REGION=eu-west-2
COGNITO_USER_POOL_ID=eu-west-2_pgov6mOhU
COGNITO_DOMAIN=cx-assist-auth                        # the prefix from step 1
COGNITO_CLIENT_ID=<App client ID from step 2>
COGNITO_CLIENT_SECRET=<App client secret from step 2>
COGNITO_ADMIN_CHECK_MODE=allow_all                   # see "Admin role enforcement" below
```

Restart the stack: `docker compose up -d --build`

That's the minimum to make Cognito sign-in work. The "Sign in with cx-assist" button on the Agents login page will now redirect to Cognito.

---

## Admin role enforcement

Paul's requirement: only **admins and super-admins** of cx-assist may sign into Agents. Cognito itself does not store this distinction — per the user, roles live in the cx-assist platform's database. There are three modes for enforcing this; pick one via `COGNITO_ADMIN_CHECK_MODE`:

| Mode | Behavior | When to use |
|---|---|---|
| `allow_all` | Anyone Cognito authenticates is allowed in | Initial rollout / staging — get the flow working first |
| `api_check` | Agents calls `COGNITO_ADMIN_VERIFY_URL` after Cognito login. If the response says `allow=false` (or no `super_admin`/`admin` role), login is rejected with "Access denied" | Production |
| `deny_default` | All logins refused | Maintenance window |

### Wiring up `api_check`

This requires a small change on the **cx-assist platform side** (not in this repo). The platform needs to expose an internal endpoint:

```
POST https://api.cx-assist.io/internal/cognito/verify-admin
Authorization: Bearer <shared-secret-token>
Content-Type: application/json

{ "sub": "<cognito user sub>", "email": "<user email>" }
```

Response body (either form is accepted):

```jsonc
// Form A — explicit allow flag
{ "allow": true }

// Form B — role-based (Agents accepts "admin" or "super_admin")
{ "role": "super_admin" }
```

Once that endpoint exists on the platform, set on the Agents host:

```bash
COGNITO_ADMIN_CHECK_MODE=api_check
COGNITO_ADMIN_VERIFY_URL=https://api.cx-assist.io/internal/cognito/verify-admin
COGNITO_ADMIN_VERIFY_TOKEN=<shared bearer token>
```

The token should be a high-entropy random string shared only between the platform and the Agents host (use AWS Secrets Manager in production).

---

## True "already logged in" SSO — what it requires

The "click Agents tab → already logged in, no login screen" UX only works if **the cx-assist platform's own login also goes through Cognito's Hosted UI**. Looking at the platform's current `.env`, it uses Cognito's admin SDK (`AWS_COGNITO_ACCESS_KEY` + admin API calls), which means there is no Cognito session cookie in the browser today.

**Two paths forward:**

### Path A — Migrate the platform login to Cognito Hosted UI (recommended, requires platform work)

Have the cx-assist Node/React app redirect users to Cognito's Hosted UI instead of running its own email/password form against the Cognito admin API. Once the user has a valid Cognito session cookie at `*.amazoncognito.com`, navigating to `agents.cx-assist.io` will silently roundtrip through Cognito and be back in Agents within ~1 second — no extra login.

This is a significant change to the platform but is the standard pattern Paul described.

### Path B — Token forwarding (faster but custom)

Have the platform issue a short-lived JWT (signed with a shared secret) and set it as a cookie at `.cx-assist.io` (parent domain so `agents.cx-assist.io` can read it). Add a small middleware in Agents that, when this cookie is present, treats it as a valid Cognito identity and creates an Agents session without redirecting.

Less standard, but works without changing the platform's existing login flow. Document this as a follow-up if Path A is too disruptive.

---

## Files touched in this repo

- [agents-ai/server/src/auth/cognito-sso.ts](../agents-ai/server/src/auth/cognito-sso.ts) — Cognito provider config + admin role gate
- [agents-ai/server/src/auth/better-auth.ts](../agents-ai/server/src/auth/better-auth.ts) — registers the plugin when env vars are set
- [agents-ai/ui/src/pages/Auth.tsx](../agents-ai/ui/src/pages/Auth.tsx) — adds "Sign in with cx-assist" button
- [docker-compose.yaml](../docker-compose.yaml) — passes `COGNITO_*` env vars to the server
- [.env.example](../.env.example) — Cognito placeholders + comments

If `COGNITO_CLIENT_ID` or `COGNITO_CLIENT_SECRET` is unset, the Cognito plugin is **not** registered and Agents falls back to email/password sign-in. Safe to deploy without Cognito set up first; flip on later by populating the env vars.

---

## Open items / follow-ups

- [ ] AWS Console: create Hosted UI domain + Agents app client (steps 1–2 above)
- [ ] Populate `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET` in production `.env`
- [ ] cx-assist platform team: expose `/internal/cognito/verify-admin` endpoint
- [ ] Switch `COGNITO_ADMIN_CHECK_MODE` from `allow_all` → `api_check` once the endpoint is live
- [ ] Decide between Path A (platform migration to Hosted UI) and Path B (token forwarding) for true seamless SSO
- [ ] Add a dedicated AWS Secrets Manager entry for `COGNITO_ADMIN_VERIFY_TOKEN`
