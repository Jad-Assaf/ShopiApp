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

  // WhatsApp interactive button reply
  const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg?.interactive?.button_reply) {
    const replyId = msg.interactive.button_reply.id;
    // retrieve order ID from context if you stored it when sending (not shown here)
    const orderId = msg.context?.id /* or however you persist mapping */;
    console.log("🛎️ Button reply:", replyId, "for order", orderId);
    await handleShopifyAction(replyId, orderId);
    return json({ handled: replyId }, { status: 200 });
  }

  // New Shopify order webhook
  const order = body;
  console.log("✅ Parsed order:", {
    id: order.id,
    order_number: order.order_number,
    customer: order.customer?.first_name,
    items: order.line_items.length,
  });

  try {
    const res = await sendToWhatsApp(order);
    console.log("📤 WhatsApp API response:", res.status, await res.text());
  } catch (err) {
    console.error("❌ WhatsApp send error:", err);
    return json({ error: "WhatsApp send failed" }, { status: 502 });
  }

  return json({ success: true }, { status: 200 });
};

async function sendToWhatsApp(order: any) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  // Prepare parameters
  const orderNumber = String(order.order_number);
  const customerName = `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim() || "Unknown";
  const email = order.email ?? "N/A";
  const phone =
    order.phone ||
    order.shipping_address?.phone ||
    order.billing_address?.phone ||
    "N/A";
  const addrParts = order.shipping_address || order.billing_address || {};
  const address = [
    addrParts.address1,
    addrParts.address2,
    addrParts.city,
    addrParts.province,
    addrParts.country,
    addrParts.zip
  ].filter(Boolean).join(", ");
  const firstItem = order.line_items[0] || {};
  const itemName = firstItem.title || "N/A";
  const itemQty = String(firstItem.quantity ?? 0);
  const totalPrice = String(order.current_total_price);

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
        {
          type: "button" as const,
          sub_type: "quick_reply" as const,
          index: 1,
          parameters: [
            { type: "payload" as const, payload: "Fulfill Order" }
          ]
        },
        {
          type: "button" as const,
          sub_type: "quick_reply" as const,
          index: 2,
          parameters: [
            { type: "payload" as const, payload: "Cancel Fulfillment" }
          ]
        },
        {
          type: "button" as const,
          sub_type: "quick_reply" as const,
          index: 3,
          parameters: [
            { type: "payload" as const, payload: "Cancel Order" }
          ]
        },
        {
          type: "button" as const,
          sub_type: "quick_reply" as const,
          index: 4,
          parameters: [
            { type: "payload" as const, payload: "Ready For Pickup" }
          ]
        }
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
  const endpoint = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN!
  };
  let query = "";
  let variables: any = {};

  switch (actionId) {
    case "Fulfill Order":
      query = `mutation fulfillmentCreate($orderId: ID!) {
        fulfillmentCreate(fulfillment: {orderId: $orderId}) {
          fulfillment { id }
          userErrors { field message }
        }
      }`;
      variables = { orderId };
      break;
    case "Cancel Fulfillment":
      query = `mutation fulfillmentOrderCancel($id: ID!) {
        fulfillmentOrderCancel(id: $id) {
          fulfillmentOrder { id }
          userErrors { field message }
        }
      }`;
      variables = { id: orderId };
      break;
    case "Cancel Order":
      query = `mutation orderCancel($orderId: ID!) {
        orderCancel(id: $orderId) {
          order { id }
          userErrors { field message }
        }
      }`;
      variables = { orderId };
      break;
    case "Ready For Pickup":
      query = `mutation prepareForPickup($id: ID!) {
        fulfillmentOrderLineItemsPreparedForPickup(id: $id) {
          fulfillmentOrder { id }
          userErrors { field message }
        }
      }`;
      variables = { id: orderId };
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
