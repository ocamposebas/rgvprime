let mePromise = null;

export function getMeOnce() {
  if (!mePromise) {
    mePromise = fetch("/account/me", {
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .catch(() => null);
  }

  return mePromise;
}

export function resetMeCache() {
  mePromise = null;
}