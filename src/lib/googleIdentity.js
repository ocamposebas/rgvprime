import { OAuth2Client } from "google-auth-library";

const GOOGLE_CLIENT_ID = String(
  import.meta.env.GOOGLE_CLIENT_ID ||
    import.meta.env.PUBLIC_GOOGLE_CLIENT_ID ||
    "",
).trim();

let googleClient;

function getGoogleClient() {
  if (!GOOGLE_CLIENT_ID) {
    const error = new Error("Google sign-in is not configured.");
    error.status = 503;
    throw error;
  }

  if (!googleClient) {
    googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
  }

  return googleClient;
}

export async function verifyGoogleCredential(credential) {
  const idToken = String(credential || "").trim();

  if (!idToken || idToken.length > 12_000) {
    const error = new Error("Google did not return a valid sign-in credential.");
    error.status = 400;
    throw error;
  }

  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = String(payload?.email || "").trim().toLowerCase();
    const subject = String(payload?.sub || "").trim();

    if (!payload?.email_verified || !email || !subject) {
      const error = new Error(
        "Your Google account must have a verified email address.",
      );
      error.status = 403;
      throw error;
    }

    return {
      google_sub: subject,
      email,
      email_verified: true,
      first_name: String(payload?.given_name || "").trim().slice(0, 100),
      last_name: String(payload?.family_name || "").trim().slice(0, 100),
      display_name: String(payload?.name || "").trim().slice(0, 200),
    };
  } catch (error) {
    if (error?.status) throw error;

    const invalid = new Error(
      "Google sign-in could not be verified. Please try again.",
    );
    invalid.status = 401;
    throw invalid;
  }
}

export async function verifyGoogleAccessToken(accessToken) {
  const token = String(accessToken || "").trim();

  if (!token || token.length > 4096) {
    const error = new Error("Google did not return a valid access token.");
    error.status = 400;
    throw error;
  }

  try {
    getGoogleClient();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const tokenInfoResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
        { signal: controller.signal, cache: "no-store" },
      );
      const tokenInfo = await tokenInfoResponse.json().catch(() => ({}));
      const audience = String(tokenInfo?.aud || tokenInfo?.azp || "").trim();
      const expiresIn = Number(tokenInfo?.expires_in || 0);
      const scopes = new Set(String(tokenInfo?.scope || "").split(/\s+/).filter(Boolean));
      const hasEmailScope =
        scopes.has("email") ||
        scopes.has("https://www.googleapis.com/auth/userinfo.email");

      if (
        !tokenInfoResponse.ok ||
        audience !== GOOGLE_CLIENT_ID ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 0 ||
        !hasEmailScope
      ) {
        const error = new Error("Google sign-in could not be verified. Please try again.");
        error.status = 401;
        throw error;
      }

      const userInfoResponse = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
          cache: "no-store",
        },
      );
      const payload = await userInfoResponse.json().catch(() => ({}));
      const email = String(payload?.email || "").trim().toLowerCase();
      const subject = String(payload?.sub || "").trim();
      const emailVerified =
        payload?.email_verified === true || payload?.email_verified === "true";

      if (
        !userInfoResponse.ok ||
        !emailVerified ||
        !email ||
        !subject ||
        (tokenInfo?.sub && String(tokenInfo.sub) !== subject)
      ) {
        const error = new Error(
          "Your Google account must have a verified email address.",
        );
        error.status = 403;
        throw error;
      }

      return {
        google_sub: subject,
        email,
        email_verified: true,
        first_name: String(payload?.given_name || "").trim().slice(0, 100),
        last_name: String(payload?.family_name || "").trim().slice(0, 100),
        display_name: String(payload?.name || "").trim().slice(0, 200),
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error?.status) throw error;

    const invalid = new Error(
      "Google sign-in could not be verified. Please try again.",
    );
    invalid.status = 401;
    throw invalid;
  }
}
