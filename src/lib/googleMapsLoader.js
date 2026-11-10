let googleMapsPromise = null;

export function loadGoogleMaps(apiKey) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps is available only in the browser."));
  }

  if (window.google?.maps?.importLibrary) {
    return Promise.resolve(window.google.maps);
  }

  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) {
    return Promise.reject(new Error("Google Maps is not configured."));
  }

  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = `__rgvGoogleMapsReady${Date.now()}`;
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: cleanKey,
      v: "weekly",
      loading: "async",
      callback: callbackName,
    });

    const cleanup = () => {
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    };

    window[callbackName] = () => {
      cleanup();
      if (window.google?.maps?.importLibrary) resolve(window.google.maps);
      else reject(new Error("Google Maps loaded without the required libraries."));
    };

    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.dataset.rgvGoogleMaps = "true";
    script.addEventListener("error", () => {
      cleanup();
      googleMapsPromise = null;
      reject(new Error("Google Maps could not be loaded."));
    }, { once: true });

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}
