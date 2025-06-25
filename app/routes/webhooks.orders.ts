// app/routes/webhooks.orders.ts
import { json, type ActionFunction } from "@remix-run/node";
import crypto from "crypto";

// 204 for GET/health-checks
export const loader = () => new Response(null, { status: 204 });

export const action: ActionFunction = async ({ request }) => {
  console.log("[webhooks.orders] ➡️ Incoming Shopify webhook");

  // 1. Read raw bytes
  const arrayBuffer = await request.arrayBuffer();
  const rawBodyBuf  = Buffer.from(arrayBuffer);
  console.log(
    "[webhooks.orders] 🔍 Raw body (first 200 bytes):",
    rawBodyBuf.slice(0, 200).toString("utf8")
  );

  // 2. Extract headers
  const hmacHeader  = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const topicHeader = request.headers.get("X-Shopify-Topic") || "";
  console.log("[webhooks.orders] 🏷️ Topic:", topicHeader);
  console.log("[webhooks.orders] 🏷️ Shopify HMAC:", hmacHeader);

  // 3. Compute HMAC
  const computedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_APP_SECRET!)
    .update(rawBodyBuf)
    .digest("base64");
  console.log("[webhooks.orders] 🔑 Computed HMAC:", computedHmac);

  // 4. Timing-safe compare
  const validSignature = crypto.timingSafeEqual(
    Buffer.from(computedHmac, "utf8"),
    Buffer.from(hmacHeader, "utf8")
  );
  console.log(`[webhooks.orders] ✔️ Signature valid? ${validSignature}`);

  if (!validSignature) {
    console.error("[webhooks.orders] ❌ Invalid signature. Aborting.");
    return json({ error: "Invalid HMAC signature" }, { status: 401 });
  }

  // 5. Parse JSON
  let order: any;
  try {
    order = JSON.parse(rawBodyBuf.toString("utf8"));
    console.log("[webhooks.orders] 🛎️ Parsed order:", {
      id: order.id,
      customer: order.customer?.first_name,
      total: order.total_price,
    });
  } catch (err) {
    console.error("[webhooks.orders] ❌ JSON parse error:", err);
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 6. Forward to WhatsApp (template name and components omitted for brevity)
  try {
    const result = await sendToWhatsApp(order);
    console.log(
      "[webhooks.orders] 📤 WhatsApp API response:",
      result.status,
      await result.text()
    );
  } catch (err) {
    console.error("[webhooks.orders] ❌ WhatsApp send error:", err);
    // Return 502 so Shopify may retry, if desired
    return json({ error: "WhatsApp send failed" }, { status: 502 });
  }

  console.log("[webhooks.orders] ✅ Webhook handled successfully.");
  return json({ received: true }, { status: 200 });
};

// Helper to forward the order to WhatsApp Cloud API
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
  console.log("[webhooks.orders] 🔗 WhatsApp payload:", payload);

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
}
