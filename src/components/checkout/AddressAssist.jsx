import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  LoaderCircle,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  formatCheckoutAddress,
  getAddressSignature,
  getAddressValidationDecision,
  getLatLngLiteral,
  normalizeAddress,
  parseGooglePlace,
} from "../../lib/addressAssist";
import { loadGoogleMaps } from "../../lib/googleMapsLoader";
import "./AddressAssist.css";

const GOOGLE_MAPS_API_KEY = String(
  import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY || "",
).trim();
const MIN_QUERY_LENGTH = 3;
const AUTOCOMPLETE_DELAY_MS = 240;

function suggestionLabel(suggestion) {
  return String(suggestion?.placePrediction?.text?.toString?.() || "").trim();
}

function AddressChoice({ label, address, accent = false }) {
  return (
    <div className={`rgvx-address-choice ${accent ? "is-recommended" : ""}`}>
      <span>{label}</span>
      <strong>{formatCheckoutAddress(address) || "Address details unavailable"}</strong>
    </div>
  );
}

export default function AddressAssist({
  form,
  onFieldChange,
  onAddressPatch,
  disabled = false,
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const placesLibraryRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const newestRequestRef = useRef(0);
  const skipResetSignatureRef = useRef("");
  const previousSignatureRef = useRef("");
  const [focused, setFocused] = useState(false);
  const [mapsStatus, setMapsStatus] = useState(
    GOOGLE_MAPS_API_KEY ? "idle" : "unconfigured",
  );
  const [suggestions, setSuggestions] = useState([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validation, setValidation] = useState(null);
  const [location, setLocation] = useState(null);
  const [selectedFormattedAddress, setSelectedFormattedAddress] = useState("");
  const address = useMemo(() => normalizeAddress(form), [form]);
  const addressSignature = useMemo(() => getAddressSignature(address), [address]);
  const canValidate = Boolean(
    address.address1 && address.city && address.state && address.postcode,
  );
  const smartAssistAvailable = Boolean(GOOGLE_MAPS_API_KEY);

  const ensureMaps = useCallback(async () => {
    if (!GOOGLE_MAPS_API_KEY) throw new Error("Google Maps is not configured.");

    setMapsStatus((current) => current === "ready" ? current : "loading");

    try {
      const maps = await loadGoogleMaps(GOOGLE_MAPS_API_KEY);
      setMapsStatus("ready");
      return maps;
    } catch (error) {
      setMapsStatus("error");
      throw error;
    }
  }, []);

  const ensurePlaces = useCallback(async () => {
    if (placesLibraryRef.current) return placesLibraryRef.current;

    const maps = await ensureMaps();
    placesLibraryRef.current = await maps.importLibrary("places");
    return placesLibraryRef.current;
  }, [ensureMaps]);

  const createSessionToken = useCallback(async () => {
    const { AutocompleteSessionToken } = await ensurePlaces();
    sessionTokenRef.current = new AutocompleteSessionToken();
    return sessionTokenRef.current;
  }, [ensurePlaces]);

  const applyAddress = useCallback((nextAddress) => {
    const normalized = normalizeAddress({ ...address, ...nextAddress, country: "US" });
    skipResetSignatureRef.current = getAddressSignature(normalized);
    onAddressPatch(normalized);
  }, [address, onAddressPatch]);

  const validateAddress = useCallback(async (
    addressToValidate = address,
    { locationFallback = null } = {},
  ) => {
    const enteredAddress = normalizeAddress(addressToValidate);
    if (!enteredAddress.address1 || !enteredAddress.city || !enteredAddress.state || !enteredAddress.postcode) {
      setValidation({
        kind: "incomplete",
        message: "Complete the street, city, state, and ZIP before checking the address.",
      });
      return null;
    }

    setValidationLoading(true);
    setSuggestions([]);
    setActiveSuggestion(-1);

    try {
      const maps = await ensureMaps();
      const { AddressValidation } = await maps.importLibrary("addressValidation");
      const result = await AddressValidation.fetchAddressValidation({
        address: {
          regionCode: "US",
          languageCode: "en",
          addressLines: [enteredAddress.address1, enteredAddress.address2].filter(Boolean),
          locality: enteredAddress.city,
          administrativeArea: enteredAddress.state,
          postalCode: enteredAddress.postcode,
        },
      });
      const decision = getAddressValidationDecision(result, enteredAddress);
      const validatedLocation = getLatLngLiteral(result?.geocode?.location) || locationFallback;

      setValidation(decision);
      setSelectedFormattedAddress(
        decision.formattedAddress || formatCheckoutAddress(decision.suggestedAddress),
      );
      if (validatedLocation) setLocation(validatedLocation);

      return decision;
    } catch (error) {
      setValidation({
        kind: "error",
        message: "We could not check this address right now. You can still keep it and confirm it manually below.",
      });
      return null;
    } finally {
      setValidationLoading(false);
    }
  }, [address, ensureMaps]);

  const selectSuggestion = useCallback(async (suggestion) => {
    const prediction = suggestion?.placePrediction;
    if (!prediction) return;

    setSelectionLoading(true);
    setSuggestions([]);
    setActiveSuggestion(-1);

    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ["addressComponents", "formattedAddress", "location", "viewport"],
      });
      const selectedAddress = parseGooglePlace(place, address);
      const selectedLocation = getLatLngLiteral(place.location);

      applyAddress(selectedAddress);
      setSelectedFormattedAddress(
        String(place.formattedAddress || formatCheckoutAddress(selectedAddress)),
      );
      if (selectedLocation) setLocation(selectedLocation);
      sessionTokenRef.current = null;
      await validateAddress(selectedAddress, { locationFallback: selectedLocation });
    } catch (error) {
      setValidation({
        kind: "error",
        message: "That suggestion could not be loaded. Keep typing or enter the address manually.",
      });
    } finally {
      setSelectionLoading(false);
    }
  }, [address, applyAddress, validateAddress]);

  useEffect(() => {
    if (!previousSignatureRef.current) {
      previousSignatureRef.current = addressSignature;
      return;
    }

    if (previousSignatureRef.current === addressSignature) return;
    previousSignatureRef.current = addressSignature;

    if (skipResetSignatureRef.current === addressSignature) {
      skipResetSignatureRef.current = "";
      return;
    }

    setValidation(null);
    setSelectedFormattedAddress("");
  }, [addressSignature]);

  useEffect(() => {
    if (!focused || !smartAssistAvailable || disabled) return undefined;

    const query = String(address.address1 || "").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setActiveSuggestion(-1);
      return undefined;
    }

    const requestId = newestRequestRef.current + 1;
    newestRequestRef.current = requestId;
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);

      try {
        const { AutocompleteSuggestion } = await ensurePlaces();
        const sessionToken = sessionTokenRef.current || await createSessionToken();
        const { suggestions: nextSuggestions = [] } =
          await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: [query, address.city, address.state, address.postcode]
              .filter(Boolean)
              .join(", "),
            includedRegionCodes: ["us"],
            language: "en-US",
            region: "us",
            sessionToken,
          });

        if (requestId !== newestRequestRef.current) return;
        const addressSuggestions = nextSuggestions
          .filter((item) => item?.placePrediction)
          .slice(0, 5);
        setSuggestions(addressSuggestions);
        setActiveSuggestion(addressSuggestions.length ? 0 : -1);
      } catch (error) {
        if (requestId === newestRequestRef.current) {
          setSuggestions([]);
          setActiveSuggestion(-1);
        }
      } finally {
        if (requestId === newestRequestRef.current) setSuggestionsLoading(false);
      }
    }, AUTOCOMPLETE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [
    address.address1,
    address.city,
    address.postcode,
    address.state,
    createSessionToken,
    disabled,
    ensurePlaces,
    focused,
    smartAssistAvailable,
  ]);

  useEffect(() => {
    if (!location || !mapContainerRef.current || !smartAssistAvailable) return undefined;

    let cancelled = false;

    ensureMaps()
      .then(async (maps) => {
        const { Map } = await maps.importLibrary("maps");
        if (cancelled || !mapContainerRef.current) return;

        if (!mapInstanceRef.current) {
          mapInstanceRef.current = new Map(mapContainerRef.current, {
            center: location,
            zoom: 16,
            disableDefaultUI: true,
            clickableIcons: false,
            keyboardShortcuts: false,
            gestureHandling: "cooperative",
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
        } else {
          mapInstanceRef.current.setCenter(location);
          mapInstanceRef.current.setZoom(16);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [ensureMaps, location, smartAssistAvailable]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setFocused(false);
        setSuggestions([]);
        setActiveSuggestion(-1);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  const handleKeyDown = (event) => {
    if (!suggestions.length) {
      if (event.key === "Escape") setFocused(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && activeSuggestion >= 0) {
      event.preventDefault();
      void selectSuggestion(suggestions[activeSuggestion]);
    } else if (event.key === "Escape") {
      setSuggestions([]);
      setActiveSuggestion(-1);
    }
  };

  const useRecommendedAddress = () => {
    if (!validation?.suggestedAddress) return;
    applyAddress(validation.suggestedAddress);
    setValidation({
      ...validation,
      kind: "verified",
      enteredAddress: validation.suggestedAddress,
      message: "Google's recommended format is now in the shipping form.",
    });
  };

  const keepEnteredAddress = () => {
    setValidation((current) => ({
      ...current,
      kind: "manual",
      message: "Your address was kept exactly as entered. Confirm it below before payment.",
    }));
  };

  const showSuggestions = focused && suggestions.length > 0;
  const busy = suggestionsLoading || selectionLoading;
  const mapQuery = location ? `${location.lat},${location.lng}` : "";

  return (
    <div className="rgvx-field wide rgvx-address-assist" ref={rootRef}>
      <span className="rgvx-address-assist__label">
        <span>Address</span>
        {smartAssistAvailable && (
          <em><Sparkles size={12} /> Smart address</em>
        )}
      </span>

      <div className="rgvx-address-search">
        <Search size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          id="rgvx-shipping-address"
          type="text"
          value={address.address1}
          onChange={(event) => {
            onFieldChange("address1", event.target.value);
            setFocused(true);
            setValidation(null);
          }}
          onFocus={() => {
            setFocused(true);
            if (smartAssistAvailable && mapsStatus === "idle") {
              void ensurePlaces().catch(() => {});
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Start typing your street address"
          autoComplete="shipping address-line1"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls="rgvx-address-suggestions"
          aria-activedescendant={
            showSuggestions && activeSuggestion >= 0
              ? `rgvx-address-suggestion-${activeSuggestion}`
              : undefined
          }
          disabled={disabled}
        />
        {busy && <LoaderCircle className="rgvx-address-search__spinner" size={17} aria-label="Searching addresses" />}
      </div>

      {showSuggestions && (
        <div className="rgvx-address-suggestions" id="rgvx-address-suggestions" role="listbox">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestionLabel(suggestion)}-${index}`}
              id={`rgvx-address-suggestion-${index}`}
              type="button"
              role="option"
              aria-selected={activeSuggestion === index}
              className={activeSuggestion === index ? "is-active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveSuggestion(index)}
              onClick={() => void selectSuggestion(suggestion)}
            >
              <MapPin size={16} aria-hidden="true" />
              <span>{suggestionLabel(suggestion)}</span>
            </button>
          ))}
          <footer>Powered by Google</footer>
        </div>
      )}

      <div className="rgvx-address-assist__hint">
        <span>
          {smartAssistAvailable
            ? "Choose a suggestion to fill city, state, and ZIP automatically — or keep typing manually."
            : "Enter the delivery address exactly as it should appear on the label."}
        </span>
        {smartAssistAvailable && (
          <button
            type="button"
            onClick={() => void validateAddress()}
            disabled={!canValidate || validationLoading || selectionLoading || disabled}
          >
            {validationLoading
              ? <><LoaderCircle size={13} className="is-spinning" /> Checking…</>
              : <><ShieldCheck size={13} /> Check address</>}
          </button>
        )}
      </div>

      {mapsStatus === "error" && (
        <p className="rgvx-address-assist__service-note" role="status">
          Smart suggestions are temporarily unavailable. Manual address entry still works.
        </p>
      )}

      {validation && (
        <section className={`rgvx-address-verification is-${validation.kind}`} aria-live="polite">
          <header>
            {validation.kind === "verified" ? <Check size={17} /> : validation.kind === "manual" ? <ShieldCheck size={17} /> : <AlertTriangle size={17} />}
            <div>
              <strong>
                {validation.kind === "verified"
                  ? "Address matched"
                  : validation.kind === "manual"
                    ? "Using your address"
                    : validation.kind === "review"
                      ? "Review Google's suggestion"
                      : "Address check unavailable"}
              </strong>
              <small>
                {validation.message || (
                  validation.kind === "verified"
                    ? "Google found a complete match. Confirm it below before payment."
                    : "A small correction may help the carrier find this destination."
                )}
              </small>
            </div>
          </header>

          {validation.kind === "review" && validation.enteredAddress && validation.suggestedAddress && (
            <>
              <div className="rgvx-address-choices">
                <AddressChoice label="You entered" address={validation.enteredAddress} />
                <AddressChoice label="Recommended" address={validation.suggestedAddress} accent />
              </div>
              <div className="rgvx-address-verification__actions">
                <button type="button" className="primary" onClick={useRecommendedAddress}>
                  <Check size={14} /> Use recommended
                </button>
                <button type="button" onClick={keepEnteredAddress}>Keep my address</button>
              </div>
            </>
          )}

          {["error", "incomplete"].includes(validation.kind) && (
            <div className="rgvx-address-verification__actions">
              <button type="button" onClick={() => inputRef.current?.focus()}>Edit address</button>
              <button type="button" onClick={keepEnteredAddress}>Keep my address</button>
            </div>
          )}
        </section>
      )}

      {location && (
        <section className="rgvx-address-map-card">
          <div
            ref={mapContainerRef}
            className="rgvx-address-map"
            role="img"
            aria-label={`Map location for ${selectedFormattedAddress || formatCheckoutAddress(address)}`}
          />
          <span className="rgvx-address-map__pin" aria-hidden="true"><MapPin size={21} /></span>
          <footer>
            <div>
              <span>Map preview</span>
              <strong>{selectedFormattedAddress || formatCheckoutAddress(address)}</strong>
            </div>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
              target="_blank"
              rel="noopener noreferrer"
            >Open map</a>
          </footer>
        </section>
      )}
    </div>
  );
}
