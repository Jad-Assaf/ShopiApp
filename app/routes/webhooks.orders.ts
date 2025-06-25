// app/routes/webhooks.orders.ts
import { json, type LoaderFunction, type ActionFunction } from "@remix-run/node";

export const loader: LoaderFunction = async () => {
  console.log("🔍 [loader] GET /webhooks/orders");
  return json({ message: "POST only" }, { status: 200 });
};

export const action: ActionFunction = async ({ request }) => {
  console.log("🔔 [action] POST /webhooks/orders start");
  try {
    // 1. Read & log the Shopify topic
    const headers = Object.fromEntries(request.headers);
    const topic = headers["x-shopify-topic"];
    console.log("📦 Shopify Topic:", topic);

    // 2. Read & log the raw body
    const raw = await request.text();
    console.log("📥 Raw body:", raw);

    // 3. Parse JSON
    let order: any;
    try {
      order = JSON.parse(raw);
      console.log("✅ Parsed body:", {
        id: order.id,
        order_number: order.order_number,
        customer: order.customer?.first_name,
        items: order.line_items.length
      });
    } catch (err) {
      console.error("❌ JSON parse error:", err);
      return json({ error: "Invalid JSON" }, { status: 400 });
    }

    // 4. Forward to WhatsApp
    try {
      const res = await sendToWhatsApp(order);
      const text = await res.text();
      console.log("📤 WhatsApp API response:", res.status, text);
    } catch (err) {
      console.error("❌ WhatsApp send error:", err);
      return json({ error: "WhatsApp send failed" }, { status: 502 });
    }

    console.log("✅ Webhook handled successfully.");
    return json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("❌ [action] Unhandled error:", err.stack || err);
    return json({ error: "Server error" }, { status: 500 });
  }
};

/** 
 * Helper to forward the order payload to WhatsApp Cloud API 
 * Assumes you have a pre-approved WhatsApp template with 8 placeholders:
 * {{1}} Order #, {{2}} Name, {{3}} Email, {{4}} Phone, 
 * {{5}} Address, {{6}} Item, {{7}} Quantity, {{8}} Total Items
 */
async function sendToWhatsApp(order: any) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  // Prepare values
  const orderNumber = String(order.order_number);
  const customerName = `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim() || "Unknown";
  const email = order.email ?? "N/A";
  const phone =
    order.phone ||
    order.shipping_address?.phone ||
    order.billing_address?.phone ||
    "N/A";
  const addressParts = order.shipping_address || order.billing_address || {};
  const address = [
    addressParts.address1,
    addressParts.address2,
    addressParts.city,
    addressParts.province,
    addressParts.country,
    addressParts.zip
  ]
    .filter(Boolean)
    .join(", ");
  const firstItem = order.line_items[0] || {};
  const itemName = firstItem.title || "N/A";
  const itemQty = String(firstItem.quantity ?? 0);
  const totalItems = String(
    order.line_items.reduce((sum: number, li: any) => sum + (li.quantity || 0), 0)
  );

  const payload = {
    messaging_product: "whatsapp",
    to: process.env.GROUP_WHATSAPP_NUMBER,
    type: "template" as const,
    template: {
      name: "new_order_notification", // your template name
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
            { type: "text" as const, text: totalItems }
          ]
        },
        {
          type: "button" as const,
          sub_type: "quick_reply" as const,
          index: "0",
          parameters: [
            {
              type: "payload" as const,
              payload: String(order.id)
            }
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
