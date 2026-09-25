import {
  PORTAL_COOKIE,
  clearCookieOptions,
  getCookieOptions,
  json,
  portalRequest,
} from "../../../lib/portalApi";
import { listCardWalletOrdersForUser } from "../../../lib/cardWalletCheckout";
import { filterVisibleAccountOrders } from "../../../lib/accountOrderVisibility";

export const prerender = false;

function noStore(response) {
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function clearPortalCookie(cookies, url) {
  cookies.set(PORTAL_COOKIE, "", clearCookieOptions(url));

  try {
    cookies.delete(PORTAL_COOKIE, {
      path: "/",
    });
  } catch {}
}

export async function GET({ cookies, url }) {
  const token = cookies.get(PORTAL_COOKIE)?.value || "";

  if (!token) {
    return noStore(
      json(
        {
          success: false,
          user: null,
          orders: [],
        },
        401
      )
    );
  }

  try {
    const data = await portalRequest("me", {
      method: "GET",
      token,
    });

    // Keep active customers signed in for 30 days from their latest visit.
    cookies.set(PORTAL_COOKIE, token, getCookieOptions(url));

    const portalOrders = Array.isArray(data.orders) ? data.orders : [];
    let cardWalletOrders = [];
    try {
      cardWalletOrders = await listCardWalletOrdersForUser(data.user);
    } catch (orderError) {
      console.error("CARD WALLET ACCOUNT ORDERS ERROR:", orderError?.code || orderError?.message || orderError);
    }
    const mergedOrders = [...portalOrders];
    const knownOrderIds = new Set(portalOrders.map((order) => Number(order?.id || order?.order_id || 0)));
    cardWalletOrders.forEach((order) => {
      if (!knownOrderIds.has(Number(order.id))) mergedOrders.push(order);
    });
    const visibleOrders = filterVisibleAccountOrders(mergedOrders);
    visibleOrders.sort((left, right) => {
      const leftDate = Date.parse(left?.date_created || left?.date || 0) || 0;
      const rightDate = Date.parse(right?.date_created || right?.date || 0) || 0;
      return rightDate - leftDate;
    });

    return noStore(
      json({
        success: true,
        user: data.user,
        orders: visibleOrders,
      })
    );
  } catch (error) {
    console.error("ME API ERROR:", error);

    clearPortalCookie(cookies, url);

    return noStore(
      json(
        {
          success: false,
          user: null,
          orders: [],
        },
        401
      )
    );
  }
}
