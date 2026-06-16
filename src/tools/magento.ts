import type { Env, OrderDetails } from "../types";

const MAGENTO_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": "OAuth gem v0.5.8",
};

export async function lookupOrderStatus(env: Env, orderNumber: string): Promise<OrderDetails> {
  const cleanOrderNumber = orderNumber.trim();
  if (!cleanOrderNumber) {
    return { orderNumber: "", status: "", trackingNumbers: [] };
  }

  const baseUrl = env.MAGENTO_API_URL.replace(/\/$/, "");
  const ordersUrl =
    `${baseUrl}/rest/V1/orders?` +
    new URLSearchParams({
      "searchCriteria[filterGroups][0][filters][0][field]": "increment_id",
      "searchCriteria[filterGroups][0][filters][0][value]": cleanOrderNumber,
      "searchCriteria[filterGroups][0][filters][0][condition_type]": "eq",
    }).toString();

  try {
    const orderResponse = await fetch(ordersUrl, {
      headers: {
        ...MAGENTO_HEADERS,
        Authorization: `Bearer ${env.MAGENTO_API_TOKEN}`,
      },
    });

    if (!orderResponse.ok) {
      return {
        orderNumber: cleanOrderNumber,
        status: "",
        trackingNumbers: [],
        error: `Magento order lookup failed with status ${orderResponse.status}.`,
      };
    }

    const orderData = (await orderResponse.json()) as {
      items?: Array<{ entity_id: number | string; increment_id: string; status: string }>;
    };
    const order = orderData.items?.[0];
    if (!order) {
      return { orderNumber: cleanOrderNumber, status: "", trackingNumbers: [] };
    }

    const trackingNumbers = await getTrackingNumbers(env, String(order.entity_id));
    return {
      orderNumber: order.increment_id,
      status: order.status,
      trackingNumbers,
    };
  } catch (error) {
    console.error("Magento order lookup failed", error);
    return {
      orderNumber: cleanOrderNumber,
      status: "",
      trackingNumbers: [],
      error: "Magento order lookup failed before a response was returned.",
    };
  }
}

async function getTrackingNumbers(env: Env, orderId: string): Promise<string[]> {
  const baseUrl = env.MAGENTO_API_URL.replace(/\/$/, "");
  const shipmentsUrl =
    `${baseUrl}/rest/V1/shipments?` +
    new URLSearchParams({
      "searchCriteria[filterGroups][0][filters][0][field]": "order_id",
      "searchCriteria[filterGroups][0][filters][0][value]": orderId,
    }).toString();

  const shipmentResponse = await fetch(shipmentsUrl, {
    headers: {
      ...MAGENTO_HEADERS,
      Authorization: `Bearer ${env.MAGENTO_API_TOKEN}`,
    },
  });

  if (!shipmentResponse.ok) return [];

  const data = (await shipmentResponse.json()) as {
    items?: Array<{ tracks?: Array<{ track_number?: string }> }>;
  };

  return (
    data.items
      ?.flatMap((shipment) => shipment.tracks || [])
      .map((track) => track.track_number)
      .filter((value): value is string => Boolean(value)) || []
  );
}
