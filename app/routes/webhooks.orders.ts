// app/routes/webhooks.orders.ts
import { json, type LoaderFunction, type ActionFunction } from "@remix-run/node";

// Your Meta webhook verify token
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!;

// 1️⃣ GET: Meta verification handshake
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  console.log("🔍 Webhook verification:", { mode, token });
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
};

// 2️⃣ POST: Handle both Shopify order events and WhatsApp interactive replies
export const action: ActionFunction = async ({ request }) => {
  const raw = await request.text();
  console.log("📥 Raw webhook payload:", raw);

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    console.error("❌ Invalid JSON:", err);
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 2a️⃣ WhatsApp Quick Reply button tapped?
  const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg?.interactive?.button_reply) {
    const payload = msg.interactive.button_reply.id;          // "ACTION|orderId"
    console.log("🛎️ Button reply payload:", payload);
    const [actionId, orderId] = payload.split("|");
    console.log("🔗 Action:", actionId, "Order ID:", orderId);
    await handleShopifyAction(actionId, orderId);
    return json({ handled: actionId }, { status: 200 });
  }

  // 2b️⃣ Otherwise it’s a new Shopify order event
  const order = body;
  console.log("✅ New Shopify order received:", order.id);

  const res = await sendToWhatsApp(order);
  console.log("📤 WhatsApp API response:", res.status, await res.text());
  return json({ success: true }, { status: 200 });
};

// 3️⃣ Send WhatsApp notification with buttons
async function sendToWhatsApp(order: any) {
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
      language: { code: "en" },              // 🔄 reverted to "en"
      components: [
        {
          type: "body" as const,
          parameters: [
            { type: "text" as const, text: String(order.order_number) },
            { type: "text" as const, text: `${order.customer?.first_name} ${order.customer?.last_name}`.trim() },
            { type: "text" as const, text: order.email },
            { type: "text" as const, text: order.phone || order.shipping_address?.phone || order.billing_address?.phone || "N/A" },
            { type: "text" as const, text: [order.shipping_address.address1, order.shipping_address.city, order.shipping_address.country, order.shipping_address.zip].filter(Boolean).join(", ") },
            { type: "text" as const, text: order.line_items[0]?.title || "N/A" },
            { type: "text" as const, text: String(order.line_items[0]?.quantity || 0) },
            { type: "text" as const, text: String(order.current_total_price) }
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
        // Quick Replies with payloads matching your Button Text in Meta UI
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
  return fetch(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
      },
      body: JSON.stringify(payload),
    }
  );
}

// 4️⃣ Invoke Shopify GraphQL based on button action
async function handleShopifyAction(actionId: string, orderId: string) {
  const endpoint = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN!
  };

  let query = "", variables: any = {};

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
    method: "POST", headers,
    body: JSON.stringify({ query, variables })
  });
  const result = await resp.json();
  console.log(`🔄 Shopify ${actionId} result:`, result);
}
