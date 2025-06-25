// app/routes/webhooks.orders.ts
import { json, type ActionFunction } from "@remix-run/node";
import crypto from "crypto";

// Respond to GET (health checks, etc.) with 204 No Content
export const loader = () => new Response(null, { status: 204 });

export const action: ActionFunction = async ({ request }) => {
  // 1. Read raw body and headers
  const hmacHeader   = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const topicHeader  = request.headers.get("X-Shopify-Topic") || "";
  const rawBody      = await request.text();
  console.log("[webhooks.orders] ❇️ Received Shopify webhook");
  console.log("[webhooks.orders] → Topic:", topicHeader);
  console.log("[webhooks.orders] → Raw body:", rawBody);

  // 2. Compute HMAC
  const computedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_APP_SECRET!)
    .update(rawBody, "utf8")
    .digest("base64");
  console.log("[webhooks.orders] 🔑 Computed HMAC:", computedHmac);
  console.log("[webhooks.orders] 🔐 Shopify HMAC:", hmacHeader);

  // 3. Verify signature
  const hmacBuffer       = Buffer.from(computedHmac, "utf8");
  const headerBuffer     = Buffer.from(hmacHeader, "utf8");
  const isValidSignature = crypto.timingSafeEqual(hmacBuffer, headerBuffer);
  console.log(
    `[webhooks.orders] ✔️ Signature valid? ${isValidSignature}`
  );
  if (!isValidSignature) {
    console.error(
      "[webhooks.orders] ⚠️ Invalid HMAC signature. Rejecting request."
    );
    return json({ error: "Invalid HMAC signature" }, { status: 401 });
  }

  // 4. Parse payload
  let order: any;
  try {
    order = JSON.parse(rawBody);
    console.log("[webhooks.orders] 🛎️ Parsed order:", order);
  } catch (err) {
    console.error(
      "[webhooks.orders] ❌ Failed to parse JSON payload:",
      err
    );
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 5. Forward to WhatsApp
  try {
    const result = await sendToWhatsApp(order);
    console.log(
      "[webhooks.orders] 📤 WhatsApp send result:",
      result.status,
      await result.text()
    );
  } catch (err) {
    console.error(
      "[webhooks.orders] ❌ Error sending to WhatsApp:",
      err
    );
    // You might still return 200 to acknowledge the webhook,
    // or choose to retry later depending on your needs.
    return json({ error: "WhatsApp send failed" }, { status: 502 });
  }

  // 6. Acknowledge Shopify
  console.log("[webhooks.orders] ✅ Webhook processed successfully.");
  return json({ received: true }, { status: 200 });
};

// Helper: send the template message to WhatsApp Cloud API
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
            {
              type: "text" as const,
              text: order.customer?.first_name ?? "N/A",
            },
          ],
        },
      ],
    },
  };

  console.log("[webhooks.orders] 🔗 WhatsApp payload:", payload);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  return response;
}
