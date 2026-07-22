import type { APIRoute } from "astro";

export const prerender = false;

const OMNISEND_API_URL = "https://api.omnisend.com";
const OMNISEND_API_VERSION = "2026-03-15";

const CONTACT_TAGS = [
  "source:welcome-popup-10",
  "offer:welcome-10-eligible",
];

const RATE_LIMIT_WINDOW = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

type RateStore = Map<string, number[]>;

const globalRateStore = globalThis as typeof globalThis & {
  __rgvWelcomeRateStore?: RateStore;
};

const rateStore =
  globalRateStore.__rgvWelcomeRateStore ||
  new Map<string, number[]>();

globalRateStore.__rgvWelcomeRateStore = rateStore;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function json(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function cleanText(
  value: unknown,
  maxLength: number,
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(value: unknown): string {
  return cleanText(value, 254).toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get(
    "x-forwarded-for",
  );

  return (
    request.headers.get("cf-connecting-ip") ||
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    ""
  );
}

function rateLimitExceeded(
  identifier: string,
): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW;

  const previousRequests = (
    rateStore.get(identifier) || []
  ).filter(
    (timestamp) => timestamp > cutoff,
  );

  if (
    previousRequests.length >=
    RATE_LIMIT_MAX_REQUESTS
  ) {
    rateStore.set(
      identifier,
      previousRequests,
    );

    return true;
  }

  previousRequests.push(now);

  rateStore.set(
    identifier,
    previousRequests,
  );

  return false;
}

function extractErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  if (
    !payload ||
    typeof payload !== "object"
  ) {
    return fallback;
  }

  const object =
    payload as Record<string, unknown>;

  const candidate =
    object.detail ||
    object.message ||
    object.title ||
    object.error;

  return typeof candidate === "string"
    ? candidate.slice(0, 300)
    : fallback;
}

function extractContactId(
  payload: unknown,
): string {
  if (
    !payload ||
    typeof payload !== "object"
  ) {
    return "";
  }

  const object =
    payload as Record<string, any>;

  return String(
    object.id ||
      object.contactID ||
      object.contactId ||
      object.contact?.id ||
      object.data?.id ||
      "",
  ).trim();
}

async function parseResponse(
  response: Response,
): Promise<any> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Origin validation                                                          */
/* -------------------------------------------------------------------------- */

function isAllowedOrigin(
  request: Request,
): boolean {
  const origin =
    request.headers.get("origin");

  /*
   * Some same-origin requests may not include
   * an Origin header. We allow those.
   */
  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);

    const configuredOrigins =
      String(
        import.meta.env.ALLOWED_ORIGINS || "",
      )
        .split(",")
        .map((value) =>
          value.trim().replace(/\/$/, ""),
        )
        .filter(Boolean);

    const allowedOrigins =
      configuredOrigins.length > 0
        ? configuredOrigins
        : [
            "https://rgvprimellc.com",
            "https://www.rgvprimellc.com",
          ];

    const normalizedOrigin =
      originUrl.origin.replace(/\/$/, "");

    const isAllowed =
      allowedOrigins.includes(
        normalizedOrigin,
      );

    if (!isAllowed) {
      console.warn(
        "Rejected request origin:",
        origin,
      );
    }

    return isAllowed;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Omnisend API                                                               */
/* -------------------------------------------------------------------------- */

async function omnisendRequest(
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(
    `${OMNISEND_API_URL}${path}`,
    {
      ...init,
      headers: {
        Authorization:
          `Omnisend-API-Key ${apiKey}`,

        "Omnisend-Version":
          OMNISEND_API_VERSION,

        Accept: "application/json",

        "Content-Type":
          "application/json",

        ...(init.headers || {}),
      },
    },
  );
}

async function findContactIdByEmail(
  apiKey: string,
  email: string,
): Promise<string> {
  const response =
    await omnisendRequest(
      apiKey,
      `/api/contacts?email=${encodeURIComponent(
        email,
      )}&limit=1`,
      {
        method: "GET",
      },
    );

  const payload =
    await parseResponse(response);

  if (!response.ok) {
    console.error(
      "Omnisend contact lookup error:",
      response.status,
      payload,
    );

    return "";
  }

  const contacts =
    payload?.contacts ||
    payload?.data ||
    payload?.items ||
    [];

  if (
    !Array.isArray(contacts) ||
    contacts.length === 0
  ) {
    return "";
  }

  return extractContactId(
    contacts[0],
  );
}

/* -------------------------------------------------------------------------- */
/* POST                                                                       */
/* -------------------------------------------------------------------------- */

export const POST: APIRoute = async ({
  request,
}) => {
  const apiKey = String(
    import.meta.env.OMNISEND_API_KEY ||
      "",
  ).trim();

  if (!apiKey) {
    console.error(
      "OMNISEND_API_KEY is not configured.",
    );

    return json(
      {
        success: false,
        message:
          "The welcome offer is temporarily unavailable.",
      },
      503,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Origin protection                                                        */
  /* ------------------------------------------------------------------------ */

  if (!isAllowedOrigin(request)) {
    return json(
      {
        success: false,
        message:
          "Request origin was rejected.",
      },
      403,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Content type                                                             */
  /* ------------------------------------------------------------------------ */

  const contentType =
    request.headers.get(
      "content-type",
    ) || "";

  if (
    !contentType.includes(
      "application/json",
    )
  ) {
    return json(
      {
        success: false,
        message:
          "Invalid request format.",
      },
      415,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Rate limiting                                                            */
  /* ------------------------------------------------------------------------ */

  const clientIp =
    getClientIp(request);

  const rateIdentifier =
    clientIp || "unknown-client";

  if (
    rateLimitExceeded(
      rateIdentifier,
    )
  ) {
    return json(
      {
        success: false,
        message:
          "Too many attempts. Please wait a few minutes and try again.",
      },
      429,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Parse body                                                               */
  /* ------------------------------------------------------------------------ */

  let body: Record<
    string,
    unknown
  >;

  try {
    body =
      await request.json();
  } catch {
    return json(
      {
        success: false,
        message:
          "Invalid form information.",
      },
      400,
    );
  }

  const firstName =
    cleanText(
      body.firstName,
      80,
    );

  const email =
    normalizeEmail(
      body.email,
    );

  const consent =
    body.consent === true;

  const company =
    cleanText(
      body.company,
      100,
    );

  const source =
    cleanText(
      body.source ||
        "welcome-popup-10",
      100,
    );

  const pagePath =
    cleanText(
      body.pagePath ||
        "/",
      500,
    );

  /* ------------------------------------------------------------------------ */
  /* Honeypot                                                                 */
  /* ------------------------------------------------------------------------ */

  if (company) {
    return json({
      success: true,
      message:
        "Your welcome offer is being prepared.",
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Validation                                                               */
  /* ------------------------------------------------------------------------ */

  if (
    !isValidEmail(email)
  ) {
    return json(
      {
        success: false,
        message:
          "Please enter a valid email address.",
      },
      400,
    );
  }

  if (!consent) {
    return json(
      {
        success: false,
        message:
          "Please confirm that you agree to receive the welcome email.",
      },
      400,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Consent metadata                                                         */
  /* ------------------------------------------------------------------------ */

  const now =
    new Date().toISOString();

  const userAgent =
    cleanText(
      request.headers.get(
        "user-agent",
      ),
      500,
    );

  const consentInformation: Record<
    string,
    string
  > = {
    source:
      "RGVPRIME website welcome popup",

    createdAt: now,
  };

  if (clientIp) {
    consentInformation.ip =
      clientIp;
  }

  if (userAgent) {
    consentInformation.userAgent =
      userAgent;
  }

  /* ------------------------------------------------------------------------ */
  /* Contact payload                                                          */
  /* ------------------------------------------------------------------------ */

  const contactPayload = {
    ...(firstName
      ? {
          firstName,
        }
      : {}),

    identifiers: [
      {
        type: "email",

        id: email,

        channels: {
          email: {
            status: "subscribed",

            statusChangedAt: now,
          },
        },

        consent:
          consentInformation,

        sendWelcomeMessage:
          false,
      },
    ],

    customProperties: {
      welcome_offer:
        "10_percent",

      welcome_popup_source:
        source,

      welcome_popup_page:
        pagePath,

      welcome_popup_subscribed_at:
        now,
    },
  };

  try {
    /* ---------------------------------------------------------------------- */
    /* Create/update contact                                                  */
    /* ---------------------------------------------------------------------- */

    const contactResponse =
      await omnisendRequest(
        apiKey,
        "/api/contacts",
        {
          method: "POST",

          body: JSON.stringify(
            contactPayload,
          ),
        },
      );

    const contactData =
      await parseResponse(
        contactResponse,
      );

    if (
      !contactResponse.ok
    ) {
      console.error(
        "Omnisend contact error:",
        contactResponse.status,
        contactData,
      );

      return json(
        {
          success: false,

          message:
            extractErrorMessage(
              contactData,
              "We could not activate your offer. Please try again.",
            ),
        },
        502,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Get contact ID                                                         */
    /* ---------------------------------------------------------------------- */

    let contactId =
      extractContactId(
        contactData,
      );

    if (!contactId) {
      contactId =
        await findContactIdByEmail(
          apiKey,
          email,
        );
    }

    if (!contactId) {
      console.error(
        "Omnisend contact was created but no contact ID was returned.",
      );

      return json(
        {
          success: false,

          message:
            "Your contact was saved, but the welcome offer could not be activated.",
        },
        502,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Apply tags                                                             */
    /* ---------------------------------------------------------------------- */

    const tagResponse =
      await omnisendRequest(
        apiKey,
        "/api/contacts/tags",
        {
          method: "POST",

          body: JSON.stringify({
            contactIDs: [
              contactId,
            ],

            tags:
              CONTACT_TAGS,
          }),
        },
      );

    const tagData =
      await parseResponse(
        tagResponse,
      );

    if (
      !tagResponse.ok
    ) {
      console.error(
        "Omnisend tag error:",
        tagResponse.status,
        tagData,
      );

      return json(
        {
          success: false,

          message:
            extractErrorMessage(
              tagData,
              "Your email was saved, but the offer could not be activated. Please try again.",
            ),
        },
        502,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Success                                                                */
    /* ---------------------------------------------------------------------- */

    return json({
      success: true,

      message:
        "Your 10% welcome offer is on its way.",
    });
  } catch (error) {
    console.error(
      "Omnisend welcome popup error:",
      error,
    );

    return json(
      {
        success: false,

        message:
          "The welcome offer is temporarily unavailable. Please try again.",
      },
      502,
    );
  }
};