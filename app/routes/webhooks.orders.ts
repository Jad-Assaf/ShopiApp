// app/routes/webhooks.orders.ts
import { json, type LoaderFunction, type ActionFunction } from "@remix-run/node";

export const loader: LoaderFunction = async () => {
  console.log("🔍 [loader] GET /webhooks/orders");
  return json({ message: "POST only" }, { status: 200 });
};

export const action: ActionFunction = async ({ request }) => {
  console.log("🔔 [action] POST /webhooks/orders start");
  try {
    // 1. Log the Shopify topic header
    const headers = Object.fromEntries(request.headers);
    const topic   = headers["x-shopify-topic"];
    console.log("📦 Shopify Topic:", topic);

    // 2. Read & log the raw body
    const raw = await request.text();
    console.log("📥 Raw body:", raw);

    // 3. Parse JSON and log it
    let body: any;
    try {
      body = JSON.parse(raw);
      console.log("✅ Parsed body:", body);
    } catch (err) {
      console.error("❌ JSON parse error:", err);
      return json({ error: "Invalid JSON" }, { status: 400 });
    }

    // 4. Forward to WhatsApp
    try {
      const res = await sendToWhatsApp(body);
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

// Helper to forward the order payload to WhatsApp Cloud API
async function sendToWhatsApp(order: any) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: process.env.GROUP_WHATSAPP_NUMBER,
    type: "template" as const,
    template: {
      name: "order_notification",
      language: { code: "en_US" },
      components: [
        {
          type: "body" as const,
          parameters: [
            { type: "text" as const, text: order.name },
            { type: "text" as const, text: order.customer?.first_name ?? "N/A" },
          ],
        },
      ],
    },
  };
  console.log("🔗 WhatsApp payload:", JSON.stringify(payload));

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      Authorization:    `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
}
