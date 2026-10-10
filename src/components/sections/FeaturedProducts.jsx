import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ProductCard, requestVariationSummaryBatch } from "../catalog/ProductCatalog";
import { isProductAvailable } from "../../lib/inventory";
import {
  getProductCreatedTime,
  isProductNew,
} from "../../lib/productNewness";

const EMPTY_PRODUCTS = [];

function prioritizeHomeProducts(items = []) {
  return [...items]
    .filter(isProductAvailable)
    .sort((a, b) => {
      const newA = isProductNew(a);
      const newB = isProductNew(b);

      if (newA !== newB) return newA ? -1 : 1;
      if (newA && newB) {
        const createdDifference =
          getProductCreatedTime(b) - getProductCreatedTime(a);

        if (createdDifference !== 0) return createdDifference;
      }
      if (a.featured !== b.featured) return a.featured ? -1 : 1;

      return getProductCreatedTime(b) - getProductCreatedTime(a);
    })
    .slice(0, 4);
}

export default function FeaturedProducts({ initialProducts = EMPTY_PRODUCTS }) {
  const [products, setProducts] = useState(() => prioritizeHomeProducts(initialProducts));
  const [status, setStatus] = useState(initialProducts.length ? "success" : "loading");
  const [variationSummaries, setVariationSummaries] = useState({});
  const [variationStatuses, setVariationStatuses] = useState({});

  useEffect(() => {
    if (initialProducts.length) {
      setProducts(prioritizeHomeProducts(initialProducts));
      setStatus("success");
      return;
    }
    const controller = new AbortController();
    fetch("/api/products?limit=70", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.success !== true) throw new Error("Products unavailable");
        setProducts(
          Array.isArray(data.products) ? prioritizeHomeProducts(data.products) : [],
        );
        setStatus("success");
      })
      .catch((error) => {
        if (error.name !== "AbortError") setStatus("error");
      });
    return () => controller.abort();
  }, [initialProducts]);

  useEffect(() => {
    const ids = products
      .filter((product) => product.type === "variable")
      .map((product) => String(product.id));
    if (!ids.length) return;

    let active = true;
    setVariationStatuses(Object.fromEntries(ids.map((id) => [id, "loading"])));
    requestVariationSummaryBatch(ids)
      .then(({ summaries, failedIds }) => {
        if (!active) return;
        const failed = new Set(failedIds.map(String));
        setVariationSummaries(summaries);
        setVariationStatuses(Object.fromEntries(ids.map((id) => [
          id,
          failed.has(id) || !Array.isArray(summaries[id]) ? "error" : "success",
        ])));
      })
      .catch(() => {
        if (active) setVariationStatuses(Object.fromEntries(ids.map((id) => [id, "error"])));
      });
    return () => {
      active = false;
    };
  }, [products]);

  const hasNewProducts = products.some(isProductNew);

  return (
    <section id="featured-products" className="rgv-home-collection rgv-home-section" aria-labelledby="home-collection-title">
      <div className="rgv-home-shell">
        <div className="rgv-home-section-heading">
          <div>
            <p className="rgv-home-kicker"><span>01</span> NEW & FEATURED</p>
            <h2 id="home-collection-title">
              {hasNewProducts ? "New arrivals, shown first." : "The current selection."}
            </h2>
          </div>
          <div className="rgv-home-section-heading-aside">
            <p>Recent arrivals and selected products from the RGVPRIME catalog.</p>
            <a className="rgv-home-text-link" href="/shop">View all products <ArrowUpRight size={16} aria-hidden="true" /></a>
          </div>
        </div>

        {status === "loading" && (
          <div className="rgv-home-products" aria-busy="true" aria-label="Loading featured products">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="rgv-product-card rgv-home-product--loading" aria-hidden="true">
                <div className="rgv-card-media" />
                <div className="rgv-card-body"><span /><span /><span /></div>
              </div>
            ))}
          </div>
        )}

        {status !== "loading" && !products.length && (
          <div className="rgv-home-empty" role="status">
            <p>{status === "error" ? "The selection is temporarily unavailable." : "Explore the complete collection in the catalog."}</p>
            <a className="rgv-home-button" href="/shop">Open the catalog <ArrowUpRight size={16} aria-hidden="true" /></a>
          </div>
        )}

        {products.length > 0 && (
          <div className="rgv-home-products">
            {products.map((product, index) => (
              <ProductCard
                key={product.id || product.slug}
                product={product}
                sequence={index + 1}
                priority={index < 2}
                variations={variationSummaries[String(product.id)] || []}
                variationStatus={
                  variationStatuses[String(product.id)] ||
                  (product.type === "variable" ? "loading" : "success")
                }
              />
            ))}
          </div>
        )}

        <div className="rgv-home-collection__footnote">
          <p>Laboratory research products. Product specifications and format availability are listed in the catalog.</p>
          <a href="/shop">Explore the full lineup <ArrowUpRight size={14} aria-hidden="true" /></a>
        </div>
      </div>
    </section>
  );
}
