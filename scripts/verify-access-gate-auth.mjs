import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  ageGate,
  botProtection,
  googleIdentity,
  googleEndpoint,
  loginEndpoint,
  registerEndpoint,
  forgotEndpoint,
  resetEndpoint,
  wordpressBridge,
  envExample,
  packageJson,
] = await Promise.all([
  read("src/components/agegate/AgeGate.jsx"),
  read("src/lib/botProtection.js"),
  read("src/lib/googleIdentity.js"),
  read("src/pages/api/account/google.js"),
  read("src/pages/api/account/login.js"),
  read("src/pages/api/account/register.js"),
  read("src/pages/api/account/forgot-password.js"),
  read("src/pages/api/account/reset-password.js"),
  read("wordpress-plugin/rgv-google-login/rgv-google-login.php"),
  read(".env.example"),
  read("package.json"),
]);

assert(ageGate.includes("GoogleAccessButton"), "the gate must render Google sign-in");
assert(ageGate.includes("accounts.google.com/gsi/client"), "the official Google Identity script must be used");
assert(ageGate.includes("accounts.oauth2.initTokenClient"), "Google OAuth must use the official token client");
assert(ageGate.includes("requestAccessToken"), "Google OAuth must start from an explicit user action");
assert(ageGate.includes("appearance: \"interaction-only\""), "Turnstile should stay unobtrusive for legitimate visitors");
assert(ageGate.includes("turnstileToken"), "the browser must submit the Turnstile token");
assert(
  ageGate.includes('!confirmationsComplete') && ageGate.includes('!botReady'),
  "Google sign-in must wait for compliance and bot checks",
);

assert.match(packageJson, /"google-auth-library"/);
assert(googleIdentity.includes("verifyIdToken"), "the Google ID token must be verified server-side");
assert(googleIdentity.includes("audience: GOOGLE_CLIENT_ID"), "the Google token audience must be pinned");
assert(googleIdentity.includes("tokenInfo?.aud"), "Google access-token audience must be pinned");
assert(googleIdentity.includes("openidconnect.googleapis.com/v1/userinfo"), "Google user info must come from the verified access token");
assert(googleIdentity.includes("email_verified"), "Google email verification must be enforced");
assert(
  googleEndpoint.indexOf("verifyGoogleCredential") <
    googleEndpoint.indexOf('portalRequest("google-login"'),
  "WordPress must only receive a server-verified Google identity",
);
assert(
  googleEndpoint.indexOf("verifyGoogleAccessToken") <
    googleEndpoint.indexOf('portalRequest("google-login"'),
  "WordPress must only receive a server-verified Google access identity",
);

for (const [name, endpoint] of Object.entries({
  googleEndpoint,
  loginEndpoint,
  registerEndpoint,
  forgotEndpoint,
  resetEndpoint,
})) {
  assert(
    endpoint.includes("verifyBotProtection"),
    `${name} must enforce server-side bot verification`,
  );
}

assert(botProtection.includes("/turnstile/v0/siteverify"), "Turnstile Siteverify is required");
assert(botProtection.includes("result?.success !== true"), "failed Turnstile results must be rejected");
assert(botProtection.includes("result.action === expectedAction"), "Turnstile action binding must be checked");

assert(wordpressBridge.includes("get_user_by( 'email', $email )"), "existing WordPress users must be found by verified email");
assert(wordpressBridge.includes("RGVGL_GOOGLE_SUB_META"), "the stable Google subject must be linked to the WordPress user");
assert(wordpressBridge.includes("rgvp_create_session"), "Google login must reuse the normal portal session");
assert(wordpressBridge.includes("'linked_existing' => $linked_existing"), "the bridge must report existing-account linking");
assert(
  wordpressBridge.indexOf("get_user_by( 'email', $email )") <
    wordpressBridge.indexOf("wp_insert_user("),
  "a new WordPress customer must not be created before checking the existing email",
);

for (const key of [
  "PUBLIC_GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
]) {
  assert(envExample.includes(`${key}=`), `.env.example is missing ${key}`);
}

console.log("Access gate authentication checks passed (Google linking and Turnstile). ");
