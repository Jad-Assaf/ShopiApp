// app/routes/webhooks/orders.ts
import { data, type ActionFunction } from "@remix-run/node";
import crypto from "crypto";

export const action: ActionFunction = async ({ request }) => {
  const hmac   = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const body   = await request.text();
  const hash   = crypto
    .createHmac("sha256", process.env.SHOPIFY_APP_SECRET!)
    .update(body, "utf8")
    .digest("base64");

  // 401 on invalid signature
  if (
    !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac))
  ) {
    return data(
      { error: "Invalid HMAC signature" },
      { status: 401 }
    );
  }

  const order = JSON.parse(body);
  console.log("🛎️ Shopify order event:", order);

  // forward to WhatsApp…
  await sendToWhatsApp(order);

  // 200 OK with a simple object
  return { received: true };
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
