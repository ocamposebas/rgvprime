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
  buildOpenStreetMapUrls,
  formatCheckoutAddress,
  getAddressSignature,
  getGeoapifyValidationDecision,
  getLatLngLiteral,
  normalizeAddress,
  parseGeoapifySuggestion,
} from "../../lib/addressAssist";
import "./AddressAssist.css";

const GEOAPIFY_API_KEY = String(
  import.meta.env.PUBLIC_GEOAPIFY_API_KEY || "",
).trim();
const MIN_QUERY_LENGTH = 4;
const AUTOCOMPLETE_DELAY_MS = 360;

function suggestionLabel(suggestion) {
  return String(
    suggestion?.formatted ||
    [suggestion?.address_line1, suggestion?.address_line2].filter(Boolean).join(", "),
  ).trim();
}

function buildLookupText(address) {
  return [
    address.address1,
    address.address2,
    address.city,
    address.state,
    address.postcode,
    "USA",
  ].filter(Boolean).join(", ");
}

async function fetchGeoapifySuggestions(text, { limit = 5, signal } = {}) {
  if (!GEOAPIFY_API_KEY) throw new Error("Geoapify is not configured.");

  const params = new URLSearchParams({
    text,
    format: "json",
    filter: "countrycode:us",
    lang: "en",
    limit: String(limit),
    apiKey: GEOAPIFY_API_KEY,
  });
  const response = await fetch(
    `https://api.geoapify.com/v1/geocode/autocomplete?${params.toString()}`,
    { signal, headers: { Accept: "application/json" } },
  );

  if (!response.ok) {
    throw new Error(`Geoapify request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
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
  const newestRequestRef = useRef(0);
  const suggestionCacheRef = useRef(new Map());
  const skipResetSignatureRef = useRef("");
  const previousSignatureRef = useRef("");
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [validationLoading, setValidationLoading] = useState(false);
  const [providerError, setProviderError] = useState(false);
  const [validation, setValidation] = useState(null);
  const [location, setLocation] = useState(null);
  const [selectedFormattedAddress, setSelectedFormattedAddress] = useState("");
  const address = useMemo(() => normalizeAddress(form), [form]);
  const addressSignature = useMemo(() => getAddressSignature(address), [address]);
  const canValidate = Boolean(
    address.address1 && address.city && address.state && address.postcode,
  );
  const smartAssistAvailable = Boolean(GEOAPIFY_API_KEY);
  const mapUrls = useMemo(() => buildOpenStreetMapUrls(location), [location]);

  const applyAddress = useCallback((nextAddress) => {
    const normalized = normalizeAddress({ ...address, ...nextAddress, country: "US" });
    skipResetSignatureRef.current = getAddressSignature(normalized);
    onAddressPatch(normalized);
  }, [address, onAddressPatch]);

  const validateAddress = useCallback(async (addressToValidate = address) => {
    const enteredAddress = normalizeAddress(addressToValidate);
    if (!enteredAddress.address1 || !enteredAddress.city || !enteredAddress.state || !enteredAddress.postcode) {
      setValidation({
        kind: "incomplete",
        message: "Complete the street, city, state, and ZIP before checking the address.",
      });
      return null;
    }

    setValidationLoading(true);
    setProviderError(false);
    setSuggestions([]);
    setActiveSuggestion(-1);

    try {
      const [bestMatch] = await fetchGeoapifySuggestions(buildLookupText(enteredAddress), {
        limit: 1,
      });

      if (!bestMatch) {
        setValidation({
          kind: "error",
          message: "We could not find a close match. You can edit the address or keep it exactly as entered.",
        });
        return null;
      }

      const decision = getGeoapifyValidationDecision(bestMatch, enteredAddress);
      const validatedLocation = getLatLngLiteral(bestMatch);

      setValidation(decision);
      setSelectedFormattedAddress(
        decision.formattedAddress || formatCheckoutAddress(decision.suggestedAddress),
      );
      if (validatedLocation) setLocation(validatedLocation);
      return decision;
    } catch (error) {
      setProviderError(true);
      setValidation({
        kind: "error",
        message: "We could not check this address right now. You can still keep it and confirm it manually below.",
      });
      return null;
    } finally {
      setValidationLoading(false);
    }
  }, [address]);

  const selectSuggestion = useCallback(async (suggestion) => {
    if (!suggestion) return;

    setSelectionLoading(true);
    setFocused(false);
    setSuggestions([]);
    setActiveSuggestion(-1);
    setProviderError(false);

    try {
      const selectedAddress = parseGeoapifySuggestion(suggestion, address);
      const selectedLocation = getLatLngLiteral(suggestion);

      applyAddress(selectedAddress);
      setSelectedFormattedAddress(
        suggestionLabel(suggestion) || formatCheckoutAddress(selectedAddress),
      );
      if (selectedLocation) setLocation(selectedLocation);
      setValidation({
        kind: "verified",
        source: "selection",
        enteredAddress: selectedAddress,
        suggestedAddress: selectedAddress,
        formattedAddress: suggestionLabel(suggestion),
        message: "This address was selected from the suggestions. Confirm the delivery location below.",
      });
    } catch (error) {
      setValidation({
        kind: "error",
        message: "That suggestion could not be loaded. Keep typing or enter the address manually.",
      });
    } finally {
      setSelectionLoading(false);
    }
  }, [address, applyAddress]);

  const selectTypedAddressWithKeyboard = useCallback(async () => {
    const selectedIndex = activeSuggestion >= 0 ? activeSuggestion : 0;
    const visibleSuggestion = suggestions[selectedIndex] || suggestions[0];

    if (visibleSuggestion) {
      await selectSuggestion(visibleSuggestion);
      return;
    }

    const streetQuery = String(address.address1 || "").trim();
    if (!smartAssistAvailable || disabled || streetQuery.length < MIN_QUERY_LENGTH) return;

    const lookupText = buildLookupText(address);
    const cacheKey = lookupText.toLowerCase();
    const cached = suggestionCacheRef.current.get(cacheKey);

    setFocused(false);
    setSuggestions([]);
    setActiveSuggestion(-1);
    setSuggestionsLoading(true);
    setProviderError(false);

    try {
      const matches = cached || await fetchGeoapifySuggestions(lookupText, { limit: 5 });
      suggestionCacheRef.current.set(cacheKey, matches);

      if (!matches.length) {
        setValidation({
          kind: "incomplete",
          message: "We could not find a matching suggestion. Continue entering the address manually or use Check address after completing the form.",
        });
        return;
      }

      await selectSuggestion(matches[0]);
    } catch (error) {
      setProviderError(true);
      setValidation({
        kind: "error",
        message: "Address suggestions are temporarily unavailable. You can continue entering the address manually.",
      });
    } finally {
      setSuggestionsLoading(false);
    }
  }, [
    activeSuggestion,
    address,
    disabled,
    selectSuggestion,
    smartAssistAvailable,
    suggestions,
  ]);

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
    setLocation(null);
  }, [addressSignature]);

  useEffect(() => {
    if (!focused || !smartAssistAvailable || disabled) return undefined;

    const streetQuery = String(address.address1 || "").trim();
    if (streetQuery.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setActiveSuggestion(-1);
      return undefined;
    }

    const lookupText = buildLookupText(address);
    const cacheKey = lookupText.toLowerCase();
    const cached = suggestionCacheRef.current.get(cacheKey);
    if (cached) {
      setSuggestions(cached);
      setActiveSuggestion(cached.length ? 0 : -1);
      return undefined;
    }

    const requestId = newestRequestRef.current + 1;
    newestRequestRef.current = requestId;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      setProviderError(false);

      try {
        const nextSuggestions = await fetchGeoapifySuggestions(lookupText, {
          limit: 5,
          signal: controller.signal,
        });
        if (requestId !== newestRequestRef.current) return;

        suggestionCacheRef.current.set(cacheKey, nextSuggestions);
        if (suggestionCacheRef.current.size > 40) {
          const oldestKey = suggestionCacheRef.current.keys().next().value;
          suggestionCacheRef.current.delete(oldestKey);
        }
        setSuggestions(nextSuggestions);
        setActiveSuggestion(nextSuggestions.length ? 0 : -1);
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (requestId === newestRequestRef.current) {
          setProviderError(true);
          setSuggestions([]);
          setActiveSuggestion(-1);
        }
      } finally {
        if (requestId === newestRequestRef.current) setSuggestionsLoading(false);
      }
    }, AUTOCOMPLETE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    address.address1,
    address.address2,
    address.city,
    address.postcode,
    address.state,
    disabled,
    focused,
    smartAssistAvailable,
  ]);

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
    if (event.key === "Enter" && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      void selectTypedAddressWithKeyboard();
      return;
    }

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
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveSuggestion(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveSuggestion(suggestions.length - 1);
    } else if (event.key === "Escape") {
      setFocused(false);
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
      message: "The recommended format is now in the shipping form.",
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
            setProviderError(false);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Start typing your street address"
          autoComplete="shipping address-line1"
          enterKeyHint="search"
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
              key={`${suggestion.place_id || suggestionLabel(suggestion)}-${index}`}
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
          <footer>
            Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a>
            <span aria-hidden="true">·</span>
            © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
          </footer>
        </div>
      )}

      <div className="rgvx-address-assist__hint">
        <span>
          {smartAssistAvailable
            ? "Choose a suggestion or press Enter to use the best match. You can still enter the address manually."
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

      {providerError && (
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
                  ? validation.source === "selection" ? "Address selected" : "Address matched"
                  : validation.kind === "manual"
                    ? "Using your address"
                    : validation.kind === "review"
                      ? "Review this suggestion"
                      : "Address check unavailable"}
              </strong>
              <small>{validation.message}</small>
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

      {location && mapUrls.embedUrl && (
        <section className="rgvx-address-map-card">
          <iframe
            className="rgvx-address-map"
            src={mapUrls.embedUrl}
            title={`Map location for ${selectedFormattedAddress || formatCheckoutAddress(address)}`}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <span className="rgvx-address-map__pin" aria-hidden="true"><MapPin size={21} /></span>
          <footer>
            <div>
              <span>OpenStreetMap preview</span>
              <strong>{selectedFormattedAddress || formatCheckoutAddress(address)}</strong>
            </div>
            <a href={mapUrls.openUrl} target="_blank" rel="noopener noreferrer">Open map</a>
          </footer>
        </section>
      )}
    </div>
  );
}
