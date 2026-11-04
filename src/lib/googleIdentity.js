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
