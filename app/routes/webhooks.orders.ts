import { json, type ActionFunction } from "@remix-run/node";
import crypto from "crypto";

export const loader = () => new Response(null, { status: 204 });

export const action: ActionFunction = async ({ request }) => {
  // 1. Read and verify Shopify’s HMAC header
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const rawBody   = await request.text();
  const computedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_APP_SECRET!)
    .update(rawBody, "utf8")
    .digest("base64");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(computedHmac),
      Buffer.from(hmacHeader)
    )
  ) {
    // Wrap error response
    return json({ error: "Invalid HMAC signature" }, { status: 401 });
  }

  // 2. Parse the order and forward to WhatsApp
  const order = JSON.parse(rawBody);
  console.log("🛎️ Shopify order event:", order);
  await sendToWhatsApp(order);

  // 3. Wrap success response
  return json({ received: true });
};

// helper can stay the same
async function sendToWhatsApp(order: any) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: process.env.GROUP_WHATSAPP_NUMBER,
    type: "template",
    template: {
      name: "order_notification",
      language: { code: "en_US" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: order.name },
            { type: "text", text: order.customer?.first_name ?? "N/A" },
          ],
        },
      ],
    },
  };

  await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      Authorization:    `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
}
