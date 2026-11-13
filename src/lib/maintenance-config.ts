const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const DEFAULT_CONTROL = {
  enabled: false,
  headline: "We’ll be back shortly.",
  message:
    "RGVPRIME is completing scheduled improvements to deliver the dependable experience you expect. Thank you for your patience while we finish up.",
  buttonLabel: "Contact support",
  buttonUrl: "mailto:sales@rgvprimellc.com",
  updatedAt: 0,
};

let controlCache: {
  value: typeof DEFAULT_CONTROL;
  expiresAt: number;
} | null = null;

function readRuntimeEnv(name: string) {
  if (typeof process !== "undefined" && process.env?.[name] !== undefined) {
    return process.env[name];
  }

  return import.meta.env[name];
}

export function isMaintenanceModeEnabled() {
  const value = String(readRuntimeEnv("MAINTENANCE_MODE") || "")
    .trim()
    .toLowerCase();

  return ENABLED_VALUES.has(value);
}

export async function getMaintenanceControl() {
  const now = Date.now();

  if (controlCache && controlCache.expiresAt > now) {
    return controlCache.value;
  }

  const fallback = {
    ...DEFAULT_CONTROL,
    enabled: isMaintenanceModeEnabled(),
  };
  const baseUrl = String(
    readRuntimeEnv("MAILER_BASE_URL") || "https://mailer.rgvprimellc.com",
  ).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${baseUrl}/api/storefront/control`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const data = await response.json();

    if (!response.ok || typeof data !== "object" || !data) {
      throw new Error("Storefront control returned an invalid response.");
    }

    const value = {
      enabled: fallback.enabled || data.maintenance_enabled === true,
      headline: String(data.headline || fallback.headline).slice(0, 90),
      message: String(data.message || fallback.message).slice(0, 500),
      buttonLabel: String(data.button_label || "").slice(0, 50),
      buttonUrl: String(data.button_url || "").slice(0, 500),
      updatedAt: Number(data.updated_at || 0),
    };

    controlCache = { value, expiresAt: now + 10_000 };
    return value;
  } catch {
    controlCache = { value: fallback, expiresAt: now + 5_000 };
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

export function getMaintenanceBypassToken() {
  return String(readRuntimeEnv("MAINTENANCE_BYPASS_TOKEN") || "").trim();
}

export function getMaintenanceDurationHours() {
  const configuredHours = Number(
    readRuntimeEnv("MAINTENANCE_DURATION_HOURS") || "2",
  );

  return Number.isFinite(configuredHours) && configuredHours > 0
    ? configuredHours
    : 2;
}

export function getMaintenanceRetryAfterSeconds() {
  return Math.round(getMaintenanceDurationHours() * 60 * 60);
}
