import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useCart } from "./CartContext";
import "./CartDrawer.css";

function formatMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "$0";
  }

  return `$${number.toFixed(2).replace(".00", "")}`;
}

function getProductUrl(item = {}) {
  const slug = String(item?.slug || "")
    .replace(/^\/+|\/+$/g, "")
    .trim();

  return slug ? `/product/${slug}` : "/shop";
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

const CartItem = memo(function CartItem({
  item,
  closeCart,
  removeItem,
  updateQuantity,
}) {
  const itemTotal = useMemo(() => {
    return Number(item.price || 0) * Number(item.quantity || 1);
  }, [item.price, item.quantity]);
  const productUrl = getProductUrl(item);

  const handleRemove = useCallback(() => {
    removeItem(item.id);
  }, [removeItem, item.id]);

  const handleDecrease = useCallback(() => {
    updateQuantity(item.id, Number(item.quantity || 1) - 1);
  }, [updateQuantity, item.id, item.quantity]);

  const handleIncrease = useCallback(() => {
    updateQuantity(item.id, Number(item.quantity || 1) + 1);
  }, [updateQuantity, item.id, item.quantity]);

  return (
    <article className="rgv-cart-item">
      <a href={productUrl} onClick={closeCart} className="rgv-cart-item__image">
        <img src={item.image} alt={item.name} loading="lazy" decoding="async" draggable="false" />
      </a>
      <div className="rgv-cart-item__body">
        <div className="rgv-cart-item__heading">
          <a href={productUrl} onClick={closeCart}>{item.name}</a>
          <button type="button" onClick={handleRemove} className="rgv-cart-item__remove" aria-label={`Remove ${item.name}`}><TrashIcon /></button>
        </div>
        <p className="rgv-cart-item__unit">{formatMoney(item.price)} <span>/ each</span></p>
        <div className="rgv-cart-item__bottom">
          <div className="rgv-cart-quantity" role="group" aria-label={`Quantity of ${item.name}`}>
            <button type="button" onClick={handleDecrease} aria-label={`Decrease quantity of ${item.name}`}>−</button>
            <span aria-live="polite">{item.quantity}</span>
            <button type="button" onClick={handleIncrease} aria-label={`Increase quantity of ${item.name}`}>+</button>
          </div>
          <p className="rgv-cart-item__total">{formatMoney(itemTotal)}</p>
        </div>
      </div>
    </article>
  );
});

function CartDrawer({ checkoutPath = "/checkout" }) {
  const dialogRef = useRef(null);
  const {
    items,
    itemCount,
    subtotal,
    isCartOpen,
    closeCart,
    removeItem,
    updateQuantity,
    clearCart,
    cartNotice,
    isCheckingStock,
    persistCart,
    validateStock,
  } = useCart();

  const safeItems = useMemo(() => {
    return Array.isArray(items) ? items : [];
  }, [items]);

  const hasItems = safeItems.length > 0;

  const formattedSubtotal = useMemo(() => {
    return formatMoney(subtotal);
  }, [subtotal]);

  const handleOverlayClose = useCallback(() => {
    closeCart();
  }, [closeCart]);

  const handleClearCart = useCallback(() => {
    clearCart();
  }, [clearCart]);

  const handleCheckoutClick = useCallback(
    async (event) => {
      event.preventDefault();

      const validation = await validateStock(safeItems, { reconcile: true });

      if (!validation.success || !validation.valid) return;

      persistCart(safeItems);
      closeCart();
      window.location.assign(checkoutPath);
    },
    [checkoutPath, closeCart, persistCart, safeItems, validateStock],
  );

  useEffect(() => {
    if (!isCartOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );

    const previousFocus = document.activeElement;
    const panel = dialogRef.current;
    panel?.querySelector(".rgv-cart-close")?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCart();
      }
      if (event.key === "Tab") {
        const controls = [...(panel?.querySelectorAll('a[href],button:not(:disabled)') || [])]
          .filter((node) => node.getClientRects().length && node.getAttribute("aria-disabled") !== "true");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(
        window.getComputedStyle(document.body).paddingRight,
      );
      document.body.style.paddingRight = `${
        (Number.isFinite(currentPadding) ? currentPadding : 0) + scrollbarWidth
      }px`;
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isCartOpen, closeCart]);

  if (!isCartOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="rgv-cart-overlay" role="dialog" aria-modal="true" aria-label="Shopping cart">
      <button type="button" aria-label="Close cart overlay" aria-hidden="true" tabIndex={-1} onClick={handleOverlayClose} className="rgv-cart-scrim" />
      <aside ref={dialogRef} className="rgv-cart-panel">
        <header className="rgv-cart-header">
          <div>
            <p>RGVPRIME / YOUR SELECTION</p>
            <h2>Your cart <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span></h2>
          </div>
          <button type="button" onClick={closeCart} className="rgv-cart-close" aria-label="Close cart"><CloseIcon /></button>
        </header>
        <div className={`rgv-cart-content${!hasItems ? " is-empty" : ""}`}>
          {!hasItems ? (
            <div className="rgv-cart-empty">
              <div className="rgv-cart-empty__icon"><EmptyCartIcon /></div>
              <h3>Your cart is empty</h3>
              <p>Explore the collection and add your first selection.</p>
            </div>
          ) : (
            <div className="rgv-cart-items">{safeItems.map((item) => <CartItem key={item.id} item={item} closeCart={closeCart} removeItem={removeItem} updateQuantity={updateQuantity} />)}</div>
          )}
        </div>
        {!hasItems && (
          <footer className="rgv-cart-footer rgv-cart-footer--empty">
            <a href="/shop" onClick={closeCart} className="rgv-cart-button">Explore the collection <span aria-hidden="true">↗</span></a>
            <div className="rgv-cart-footer__links">
              <button type="button" onClick={closeCart}>Continue browsing</button>
            </div>
          </footer>
        )}
        {hasItems && (
          <footer className="rgv-cart-footer">
            <div className="rgv-cart-summary"><span>Subtotal</span><strong>{formattedSubtotal}</strong></div>
            <p className="rgv-cart-shipping-note">Shipping and any applicable taxes are calculated at checkout.</p>
            {cartNotice && <p role="alert" className="rgv-cart-notice">{cartNotice}</p>}
            <a href={checkoutPath} onClick={handleCheckoutClick} aria-disabled={isCheckingStock} className="rgv-cart-button">
              {isCheckingStock ? "Checking stock…" : "Continue to checkout"}<span aria-hidden="true">↗</span>
            </a>
            <div className="rgv-cart-footer__links">
              <button type="button" onClick={closeCart}>Continue shopping</button>
              <button type="button" onClick={handleClearCart}>Clear cart</button>
            </div>
            <p className="rgv-cart-disclaimer">Strictly for laboratory research use. Not for human or animal use.</p>
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  );
}

export default memo(CartDrawer);
