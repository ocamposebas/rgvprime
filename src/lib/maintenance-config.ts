const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

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
