export const CATALOG_PAGE_SIZE = 16;

export function readCatalogPage(value) {
  if (!/^\d+$/.test(value ?? "")) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function catalogPagePath(page) {
  return page === 1 ? "/shop" : `/shop?page=${page}`;
}
