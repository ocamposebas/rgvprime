import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import coaData from "../data/coas.json";

const steps = [
  {
    number: "01",
    title: "Search",
    text: "Use a product name, SKU, or lot number.",
  },
  {
    number: "02",
    title: "Match",
    text: "Find the certificate connected to your product.",
  },
  {
    number: "03",
    title: "Verify",
    text: "Open the COA and review the available details.",
  },
];

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export default function COASection() {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");

    if (q) {
      setQuery(q);
    }
  }, []);

  const allCoas = useMemo(() => {
    return coaData.companies.flatMap((company) =>
      company.files.map((file) => ({
        ...file,
        company: company.name,
        aliases: company.aliases || [],
      }))
    );
  }, []);

  const compoundFilters = useMemo(() => {
    const products = allCoas.map((file) => file.product).filter(Boolean);
    return [...new Set(products)].sort((a, b) => a.localeCompare(b));
  }, [allCoas]);

  const filteredCoas = useMemo(() => {
    const search = normalize(query);

    if (!search) return allCoas;

    return allCoas.filter((file) => {
      const searchableText = [
        file.company,
        ...(file.aliases || []),
        file.code,
        file.lot,
        file.product,
        file.sku,
      ]
        .map(normalize)
        .join(" ");

      return searchableText.includes(search);
    });
  }, [allCoas, query]);

  function updateUrlQuery(value) {
    const params = new URLSearchParams(window.location.search);
    const cleanValue = value.trim();

    if (cleanValue) {
      params.set("q", cleanValue);
    } else {
      params.delete("q");
    }

    const nextUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;

    window.history.replaceState({}, "", nextUrl);
  }

  function handleSubmit(event) {
    event.preventDefault();
    updateUrlQuery(query);
  }

  function handleFilterClick(value) {
    setQuery(value);
    updateUrlQuery(value);
  }

  function clearSearch() {
    setQuery("");
    updateUrlQuery("");
  }

  return (
    <section
      id="coa"
      className="relative w-full overflow-x-hidden bg-[#030303] px-3 pb-14 pt-[108px] text-white sm:px-4 sm:pb-16 sm:pt-[118px] lg:px-6 lg:pb-20 lg:pt-[132px]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(220,38,38,0.13),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] bg-[size:44px_44px] opacity-[0.16] [mask-image:linear-gradient(to_bottom,black,transparent_72%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[-120px] h-[320px] w-[82vw] max-w-[760px] -translate-x-1/2 rounded-full bg-red-600/10 blur-[110px]" />

      <div className="relative z-10 mx-auto w-full max-w-[1080px]">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-[760px] text-center"
        >
          <div className="mx-auto mb-4 inline-flex max-w-full items-center gap-2 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1.5 sm:px-4 sm:py-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.7)]" />
            <span className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-red-300 sm:text-[10px] sm:tracking-[0.22em]">
              Certificate Lookup
            </span>
          </div>

          <h1 className="text-[2.4rem] font-black uppercase leading-[0.88] tracking-[-0.07em] text-white xs:text-[2.7rem] sm:text-6xl lg:text-7xl">
            COA Lookup
          </h1>

          <p className="mx-auto mt-4 max-w-[560px] text-sm leading-6 text-white/55 sm:mt-5 sm:text-base sm:leading-7">
            Find available Certificates of Analysis by product name, SKU, or lot
            number.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.1,
            duration: 0.7,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mx-auto mt-7 w-full max-w-[720px] sm:mt-9"
        >
          <form
            onSubmit={handleSubmit}
            className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-2 shadow-[0_22px_70px_rgba(0,0,0,0.38)] backdrop-blur sm:rounded-[1.7rem]"
          >
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
              <label className="relative block min-w-0">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35">
                  <SearchIcon />
                </span>

                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search product, SKU, or lot..."
                  className="h-12 w-full min-w-0 rounded-[1.15rem] border border-white/0 bg-black/25 pl-11 pr-4 text-sm font-semibold text-white outline-none transition placeholder:text-white/30 focus:border-red-500/35 focus:bg-white/[0.035] sm:h-14 sm:rounded-[1.25rem]"
                />
              </label>

              <button
                type="submit"
                className="h-12 rounded-[1.15rem] bg-red-600 px-5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-500 active:scale-[0.98] sm:h-14 sm:rounded-[1.25rem]"
              >
                Search
              </button>
            </div>
          </form>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.16,
            duration: 0.65,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mx-auto mt-6 w-full max-w-[920px]"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
              Filter by compound
            </p>

            {query && (
              <button
                type="button"
                onClick={clearSearch}
                className="shrink-0 text-[10px] font-black uppercase tracking-[0.12em] text-red-300 transition hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          <div className="-mx-1 overflow-hidden">
            <div className="flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] md:flex-wrap md:justify-center md:overflow-visible [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={clearSearch}
                aria-pressed={!query}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-2 text-[9px] font-black uppercase leading-none tracking-[0.11em] transition sm:px-4 sm:text-[10px]",
                  !query
                    ? "border-red-500 bg-red-600 text-white shadow-[0_12px_30px_rgba(220,38,38,0.22)]"
                    : "border-white/10 bg-white/[0.035] text-white/50 hover:border-red-500/35 hover:text-white"
                )}
              >
                All COAs
              </button>

              {compoundFilters.map((compound) => {
                const isActive = normalize(query) === normalize(compound);

                return (
                  <button
                    key={compound}
                    type="button"
                    onClick={() => handleFilterClick(compound)}
                    aria-pressed={isActive}
                    className={cn(
                      "max-w-[210px] shrink-0 truncate rounded-full border px-3.5 py-2 text-[9px] font-black uppercase leading-none tracking-[0.11em] transition sm:max-w-[260px] sm:px-4 sm:text-[10px]",
                      isActive
                        ? "border-red-500 bg-red-600 text-white shadow-[0_12px_30px_rgba(220,38,38,0.22)]"
                        : "border-white/10 bg-white/[0.035] text-white/50 hover:border-red-500/35 hover:text-white"
                    )}
                  >
                    {compound}
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.22,
            duration: 0.7,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mx-auto mt-9 w-full max-w-[900px] sm:mt-12"
        >
          <div className="mb-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-300">
                Available Certificates
              </p>

              <h2 className="mt-2 break-words text-xl font-black tracking-[-0.04em] text-white sm:text-2xl">
                {query ? `Results for "${query}"` : "All COAs"}
              </h2>
            </div>

            <span className="w-fit rounded-full border border-white/10 bg-white/[0.035] px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white/50">
              {filteredCoas.length} result{filteredCoas.length === 1 ? "" : "s"}
            </span>
          </div>

          {filteredCoas.length > 0 ? (
            <div className="grid gap-3">
              {filteredCoas.map((file) => (
                <div
                  key={`${file.code}-${file.lot || file.url}`}
                  className="group grid min-w-0 gap-4 rounded-[1.35rem] border border-white/10 bg-white/[0.025] p-3.5 transition hover:border-red-500/35 hover:bg-white/[0.045] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 hidden h-10 w-10 shrink-0 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300 sm:grid">
                        <FileIcon />
                      </div>

                      <div className="min-w-0">
                        <h3 className="break-words text-base font-black tracking-[-0.02em] text-white">
                          {file.product || file.code}
                        </h3>

                        <div className="mt-2 flex max-w-full flex-wrap gap-1.5">
                          {file.lot && (
                            <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/45 sm:px-3 sm:text-[10px]">
                              Lot: {file.lot}
                            </span>
                          )}

                          {file.code && (
                            <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/45 sm:px-3 sm:text-[10px]">
                              Code: {file.code}
                            </span>
                          )}

                          {file.sku && (
                            <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/45 sm:px-3 sm:text-[10px]">
                              SKU: {file.sku}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <a
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-[10px] font-black uppercase tracking-[0.14em] text-white no-underline transition hover:bg-red-500 active:scale-[0.98] sm:w-auto"
                  >
                    Open PDF
                    <ArrowIcon />
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.025] p-6 text-center sm:p-7">
              <h3 className="text-lg font-black text-white">No COAs found</h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/45">
                Try searching by the exact product name, SKU, or lot number
                printed on the vial or packaging.
              </p>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.28,
            duration: 0.7,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mx-auto mt-10 grid w-full max-w-[900px] gap-3 sm:mt-14 sm:grid-cols-3"
        >
          {steps.map((step) => (
            <div
              key={step.number}
              className="rounded-[1.35rem] border border-white/10 bg-white/[0.025] p-4 text-center transition-colors hover:bg-white/[0.05] sm:p-5"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-400">
                {step.number}
              </p>

              <h3 className="mt-3 text-sm font-black uppercase tracking-[0.12em] text-white">
                {step.title}
              </h3>

              <p className="mx-auto mt-2 max-w-[220px] text-sm leading-6 text-white/45">
                {step.text}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}