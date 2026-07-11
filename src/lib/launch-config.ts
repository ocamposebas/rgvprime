export const OPEN_COOKIE_NAME = "rgvprime_store_open";

const DEFAULT_LAUNCH_DATE = "2026-07-11T14:00:00-05:00";

export function getLaunchDate() {
  return import.meta.env.PUBLIC_LAUNCH_DATE?.trim() || DEFAULT_LAUNCH_DATE;
}

export function getLaunchTimestamp() {
  return new Date(getLaunchDate()).getTime();
}

export function isStoreOpen(now = Date.now()) {
  const launchTimestamp = getLaunchTimestamp();
  return Number.isFinite(launchTimestamp) && now >= launchTimestamp;
}