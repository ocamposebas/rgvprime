let mePromise = null;
let lastMeData = null;
let lastMeAt = 0;

const CACHE_TIME = 1000 * 30;

export function getMeOnce({ force = false } = {}) {
  const now = Date.now();

  if (!force && lastMeData && now - lastMeAt < CACHE_TIME) {
    return Promise.resolve(lastMeData);
  }

  if (!force && mePromise) {
    return mePromise;
  }

  mePromise = fetch("/api/account/me", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    credentials: "same-origin",
  })
    .then(async (response) => {
      const text = await response.text();

      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      const payload = {
        ok: response.ok,
        data,
      };

      lastMeData = payload;
      lastMeAt = Date.now();

      return payload;
    })
    .catch(() => {
      const payload = {
        ok: false,
        data: {
          success: false,
          user: null,
          orders: [],
        },
      };

      lastMeData = payload;
      lastMeAt = Date.now();

      return payload;
    })
    .finally(() => {
      mePromise = null;
    });

  return mePromise;
}

export function resetMeCache() {
  mePromise = null;
  lastMeData = null;
  lastMeAt = 0;
}