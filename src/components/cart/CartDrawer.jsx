import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useCart } from "./CartContext";

function formatMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "$0";
  }

  return `$${number.toFixed(2).replace(".00", "")}`;
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function EmptyCartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6h15l-1.6 8.4a2 2 0 0 1-2 1.6H9a2 2 0 0 1-2-1.6L5 3H2" />
      <circle cx="9" cy="21" r="1" />
      <circle cx="18" cy="21" r="1" />
    </svg>
  );
}

export default function CartDrawer({ checkoutPath = "/checkout" }) {
  const {
    items,
    itemCount,
    subtotal,
    isCartOpen,
    closeCart,
    removeItem,
    updateQuantity,
    clearCart,
  } = useCart();

  const hasItems = items.length > 0;

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeCart();
      }
    }

    if (isCartOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCartOpen, closeCart]);

  return (
    <AnimatePresence>
      {isCartOpen && (
        <motion.div
          key="cart-drawer-root"
          className="fixed inset-0 z-[90]"
          initial="closed"
          animate="open"
          exit="closed"
        >
          {/* OVERLAY */}
          <motion.button
            type="button"
            aria-label="Close cart overlay"
            onClick={closeCart}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            variants={{
              closed: {
                opacity: 0,
                backdropFilter: "blur(0px)",
              },
              open: {
                opacity: 1,
                backdropFilter: "blur(6px)",
              },
            }}
            transition={{
              duration: 0.35,
              ease: [0.16, 1, 0.3, 1],
            }}
          />

          {/* DRAWER */}
          <motion.aside
            initial={{
              x: "110%",
              opacity: 0,
              scale: 0.985,
              filter: "blur(8px)",
            }}
            animate={{
              x: 0,
              opacity: 1,
              scale: 1,
              filter: "blur(0px)",
            }}
            exit={{
              x: "105%",
              opacity: 0,
              scale: 0.985,
              filter: "blur(8px)",
            }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 32,
              mass: 0.9,
            }}
            className="absolute right-0 top-0 flex h-[100dvh] w-full max-w-none transform-gpu flex-col overflow-hidden border-l border-white/10 bg-[#070707] text-white shadow-[0_0_90px_rgba(0,0,0,0.65)] will-change-transform sm:max-w-[440px]"
          >
            {/* SOFT BACKGROUND */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(220,38,38,0.12),transparent_32%),radial-gradient(circle_at_15%_75%,rgba(127,29,29,0.12),transparent_34%)]" />
            <div className="pointer-events-none absolute left-0 top-0 h-full w-px bg-gradient-to-b from-red-500/35 via-white/10 to-transparent" />

            <div className="relative z-10 flex min-h-0 flex-1 flex-col">
              {/* HEADER */}
              <div className="shrink-0 border-b border-white/10 px-4 py-4 sm:px-5 sm:py-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-red-500 sm:text-xs">
                      Your Cart
                    </p>

                    <h2 className="mt-1 text-2xl font-black tracking-[-0.04em] sm:text-3xl">
                      {itemCount} {itemCount === 1 ? "Item" : "Items"}
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={closeCart}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/80 transition hover:bg-red-600 hover:text-white"
                    aria-label="Close cart"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>

              {/* CONTENT */}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
                {!hasItems ? (
                  <motion.div
                    initial={{ opacity: 0, y: 18, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{
                      delay: 0.12,
                      duration: 0.45,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="flex min-h-full flex-col items-center justify-center py-10 text-center"
                  >
                    <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/65 shadow-[0_0_40px_rgba(220,38,38,0.08)]">
                      <EmptyCartIcon />
                    </div>

                    <p className="text-xl font-black tracking-[-0.03em] text-white sm:text-2xl">
                      Your cart is empty.
                    </p>

                    <p className="mt-2 max-w-xs text-sm leading-6 text-white/50">
                      Add a product to begin your order.
                    </p>

                    <a
                      href="/shop"
                      onClick={closeCart}
                      className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl bg-red-600 px-8 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-red-500"
                    >
                      Shop Products
                    </a>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: 0.1,
                      duration: 0.4,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="space-y-4"
                  >
                    {items.map((item) => (
                      <article
                        key={item.id}
                        className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"
                      >
                        <div className="flex gap-3 sm:gap-4">
                          <a
                            href={item.permalink}
                            onClick={closeCart}
                            className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-xl bg-[#101010] p-2 sm:h-24 sm:w-24"
                          >
                            <img
                              src={item.image}
                              alt={item.name}
                              className="h-full w-full object-contain"
                            />
                          </a>

                          <div className="min-w-0 flex-1">
                            <div className="flex gap-3">
                              <a
                                href={item.permalink}
                                onClick={closeCart}
                                className="line-clamp-2 flex-1 text-sm font-black leading-5 text-white transition hover:text-red-300"
                              >
                                {item.name}
                              </a>

                              <button
                                type="button"
                                onClick={() => removeItem(item.id)}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/45 transition hover:border-red-500/35 hover:bg-red-600 hover:text-white"
                                aria-label={`Remove ${item.name}`}
                              >
                                <TrashIcon />
                              </button>
                            </div>

                            <p className="mt-2 text-sm font-black text-white">
                              {formatMoney(item.price)}
                            </p>

                            <div className="mt-3 flex items-center justify-between gap-3">
                              <div className="flex h-10 items-center overflow-hidden rounded-xl border border-white/10 bg-black/35">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateQuantity(item.id, item.quantity - 1)
                                  }
                                  className="flex h-10 w-10 items-center justify-center text-lg font-black text-white/70 transition hover:bg-white/10 hover:text-white"
                                  aria-label="Decrease quantity"
                                >
                                  -
                                </button>

                                <span className="flex h-10 min-w-10 items-center justify-center text-sm font-black text-white">
                                  {item.quantity}
                                </span>

                                <button
                                  type="button"
                                  onClick={() =>
                                    updateQuantity(item.id, item.quantity + 1)
                                  }
                                  className="flex h-10 w-10 items-center justify-center text-lg font-black text-white/70 transition hover:bg-white/10 hover:text-white"
                                  aria-label="Increase quantity"
                                >
                                  +
                                </button>
                              </div>

                              <p className="text-sm font-black text-white/80">
                                {formatMoney(item.price * item.quantity)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </motion.div>
                )}
              </div>

              {/* FOOTER - SOLO SI HAY PRODUCTOS */}
              {hasItems && (
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.16,
                    duration: 0.4,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="shrink-0 border-t border-white/10 bg-black/45 px-4 py-4 sm:px-5 sm:py-5"
                  style={{
                    paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
                  }}
                >
                  <button
                    type="button"
                    onClick={clearCart}
                    className="mb-4 text-xs font-bold uppercase tracking-[0.12em] text-white/35 transition hover:text-red-300"
                  >
                    Clear Cart
                  </button>

                  <div className="mb-4 flex items-center justify-between gap-4">
                    <p className="text-sm font-bold uppercase tracking-[0.14em] text-white/45">
                      Subtotal
                    </p>

                    <p className="text-3xl font-black tracking-[-0.05em] text-white">
                      {formatMoney(subtotal)}
                    </p>
                  </div>

                  <a
                    href={checkoutPath}
                    onClick={closeCart}
                    className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-red-600 px-6 text-sm font-black uppercase tracking-[0.1em] text-white transition hover:bg-red-500"
                  >
                    Continue to Checkout
                  </a>

                  <p className="mt-4 text-center text-[11px] leading-5 text-white/35">
                    Products are intended strictly for laboratory research use
                    only. Not for human or animal use.
                  </p>
                </motion.div>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}