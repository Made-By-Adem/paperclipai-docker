import { genericOAuth } from "better-auth/plugins";

export type CognitoSsoConfig = {
  region: string;
  userPoolId: string;
  domainPrefix: string;
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  adminVerifyUrl: string | undefined;
  adminVerifyToken: string | undefined;
  adminCheckMode: "allow_all" | "api_check" | "deny_default";
};

export function loadCognitoSsoConfig(env: NodeJS.ProcessEnv = process.env): CognitoSsoConfig | null {
  const clientId = env.COGNITO_CLIENT_ID?.trim();
  const clientSecret = env.COGNITO_CLIENT_SECRET?.trim();
  const userPoolId = env.COGNITO_USER_POOL_ID?.trim();
  const region = env.COGNITO_REGION?.trim();
  const domainPrefix = env.COGNITO_DOMAIN?.trim();
  const publicUrl = (env.PAPERCLIP_PUBLIC_URL ?? env.Agents_PUBLIC_URL)?.trim();

  if (!clientId || !clientSecret || !userPoolId || !region || !domainPrefix || !publicUrl) {
    return null;
  }

  const adminCheckModeRaw = env.COGNITO_ADMIN_CHECK_MODE?.trim();
  const adminCheckMode: CognitoSsoConfig["adminCheckMode"] =
    adminCheckModeRaw === "api_check" || adminCheckModeRaw === "deny_default"
      ? adminCheckModeRaw
      : "allow_all";

  return {
    region,
    userPoolId,
    domainPrefix,
    clientId,
    clientSecret,
    publicUrl,
    adminVerifyUrl: env.COGNITO_ADMIN_VERIFY_URL?.trim() || undefined,
    adminVerifyToken: env.COGNITO_ADMIN_VERIFY_TOKEN?.trim() || undefined,
    adminCheckMode,
  };
}

function cognitoUrls(config: CognitoSsoConfig) {
  const base = `https://${config.domainPrefix}.auth.${config.region}.amazoncognito.com`;
  return {
    authorizationUrl: `${base}/oauth2/authorize`,
    tokenUrl: `${base}/oauth2/token`,
    userInfoUrl: `${base}/oauth2/userInfo`,
    discoveryUrl: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}/.well-known/openid-configuration`,
  };
}

export type CognitoUserClaims = {
  sub: string;
  email: string;
  name?: string;
};

async function verifyAdminViaApi(
  claims: CognitoUserClaims,
  config: CognitoSsoConfig,
): Promise<boolean> {
  if (!config.adminVerifyUrl) return false;

  try {
    const response = await fetch(config.adminVerifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.adminVerifyToken ? { Authorization: `Bearer ${config.adminVerifyToken}` } : {}),
      },
      body: JSON.stringify({ sub: claims.sub, email: claims.email }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { allow?: boolean; role?: string };
    if (typeof body.allow === "boolean") return body.allow;
    return body.role === "admin" || body.role === "super_admin";
  } catch {
    return false;
  }
}

export async function isAdminAllowed(
  claims: CognitoUserClaims,
  config: CognitoSsoConfig,
): Promise<boolean> {
  if (config.adminCheckMode === "allow_all") return true;
  if (config.adminCheckMode === "deny_default") return false;
  return verifyAdminViaApi(claims, config);
}

export function buildCognitoPlugin(config: CognitoSsoConfig) {
  const urls = cognitoUrls(config);

  return genericOAuth({
    config: [
      {
        providerId: "cognito",
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authorizationUrl: urls.authorizationUrl,
        tokenUrl: urls.tokenUrl,
        userInfoUrl: urls.userInfoUrl,
        discoveryUrl: urls.discoveryUrl,
        scopes: ["openid", "email", "profile"],
        redirectURI: `${config.publicUrl.replace(/\/$/, "")}/api/auth/oauth2/callback/cognito`,
        mapProfileToUser: async (profile: Record<string, unknown>) => {
          const sub = String(profile.sub ?? "");
          const email = String(profile.email ?? "");
          const name = typeof profile.name === "string"
            ? profile.name
            : typeof profile["cognito:username"] === "string"
              ? String(profile["cognito:username"])
              : email.split("@")[0];

          if (!sub || !email) {
            throw new Error("Cognito profile missing sub or email");
          }

          const allowed = await isAdminAllowed({ sub, email, name }, config);
          if (!allowed) {
            throw new Error("Access denied: only cx-assist admins and super-admins may sign in to Agents");
          }

          return {
            id: sub,
            email,
            name,
            emailVerified: true,
          };
        },
      },
    ],
  });
}
