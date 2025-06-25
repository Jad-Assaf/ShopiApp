// app/routes/webhooks.orders.ts
import { json, type LoaderFunction, type ActionFunction } from "@remix-run/node";

export const loader: LoaderFunction = async () => {
  console.log("🔍 [loader] GET /webhooks/orders");
  return json({ message: "POST only" }, { status: 200 });
};

export const action: ActionFunction = async ({ request }) => {
  console.log("🔔 [action] POST /webhooks/orders start");
  const raw = await request.text();
  console.log("📥 Raw body:", raw);

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    console.error("❌ JSON parse error:", err);
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 1️⃣ Handle Quick Reply button events
  const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg?.interactive?.button_reply) {
    const payload = msg.interactive.button_reply.id;
    console.log("🛎️ Received payload:", payload);
    const [actionId, orderId] = payload.split("|");
    console.log("🔗 Action:", actionId, "Order ID:", orderId);
    await handleShopifyAction(actionId, orderId);
    return json({ handled: actionId }, { status: 200 });
  }

  // 2️⃣ Otherwise, treat as new order webhook
  const order = body;
  console.log("✅ New Shopify order:", order.id);

  const res = await sendToWhatsApp(order);
  console.log("📤 WhatsApp API response:", res.status, await res.text());
  return json({ success: true }, { status: 200 });
};

async function sendToWhatsApp(order: any) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const orderNumber = String(order.order_number);
  const customerName = `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim() || "Unknown";
  const email = order.email ?? "N/A";
  const phone = order.phone || order.shipping_address?.phone || order.billing_address?.phone || "N/A";
  const addr = order.shipping_address || order.billing_address || {};
  const address = [addr.address1, addr.address2, addr.city, addr.province, addr.country, addr.zip]
    .filter(Boolean).join(", ");
  const firstItem = order.line_items[0] || {};
  const itemName = firstItem.title || "N/A";
  const itemQty = String(firstItem.quantity ?? 0);
  const totalPrice = String(order.current_total_price);

  // payloads embed both action and order ID
  const buttons = [
    `FULFILL_ORDER|${order.id}`,
    `CANCEL_FULFILLMENT|${order.id}`,
    `CANCEL_ORDER|${order.id}`,
    `READY_FOR_PICKUP|${order.id}`,
  ];

  const payload = {
    messaging_product: "whatsapp",
    to: process.env.GROUP_WHATSAPP_NUMBER,
    type: "template" as const,
    template: {
      name: "new_order_notification",
      language: { code: "en" },
      components: [
        {
          type: "body" as const,
          parameters: [
            { type: "text" as const, text: orderNumber },
            { type: "text" as const, text: customerName },
            { type: "text" as const, text: email },
            { type: "text" as const, text: phone },
            { type: "text" as const, text: address },
            { type: "text" as const, text: itemName },
            { type: "text" as const, text: itemQty },
            { type: "text" as const, text: totalPrice }
          ]
        },
        {
          type: "button" as const,
          sub_type: "url" as const,
          index: 0,
          parameters: [
            { type: "text" as const, text: String(order.id) }
          ]
        },
        ...buttons.map((p, i) => ({
          type: "button" as const,
          sub_type: "quick_reply" as const,
          index: i + 1,
          parameters: [{ type: "payload" as const, payload: p }]
        }))
      ]
    }
  };

  console.log("🔗 WhatsApp payload:", JSON.stringify(payload));
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
    },
    body: JSON.stringify(payload)
  });
}

async function handleShopifyAction(actionId: string, orderId: string) {
  const endpoint = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-04/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN!
  };

  let query = "";
  let variables: any = {};

  switch (actionId) {
    case "FULFILL_ORDER":
      query = `
        mutation fulfillmentCreate($orderId: ID!) {
          fulfillmentCreate(fulfillment: {orderId: $orderId}) {
            fulfillment { id }
            userErrors { field message }
          }
        }`;
      variables = { orderId: `gid://shopify/Order/${orderId}` };
      break;

    case "CANCEL_FULFILLMENT":
      query = `
        mutation fulfillmentOrderCancel($id: ID!) {
          fulfillmentOrderCancel(id: $id) {
            fulfillmentOrder { id }
            userErrors { field message }
          }
        }`;
      variables = { id: `gid://shopify/Order/${orderId}` };
      break;

    case "CANCEL_ORDER":
      query = `
        mutation orderCancel($orderId: ID!) {
          orderCancel(id: $orderId) {
            order { id }
            userErrors { field message }
          }
        }`;
      variables = { orderId: `gid://shopify/Order/${orderId}` };
      break;

    case "READY_FOR_PICKUP":
      query = `
        mutation prepareForPickup($id: ID!) {
          fulfillmentOrderLineItemsPreparedForPickup(id: $id) {
            fulfillmentOrder { id }
            userErrors { field message }
          }
        }`;
      variables = { id: `gid://shopify/Order/${orderId}` };
      break;

    default:
      console.warn("⚠️ Unrecognized action:", actionId);
      return;
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables })
  });
  const result = await resp.json();
  console.log(`🔄 Shopify ${actionId} result:`, result);
}
