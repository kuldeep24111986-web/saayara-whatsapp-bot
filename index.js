// index.js
// Minimal WhatsApp Cloud API + OpenAI + Shopify webhook handler
// Run: npm init -y
// npm i express body-parser axios dotenv

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN; // e.g. your-shop.myshopify.com
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Webhook receiver (POST)
app.post('/webhook', async (req, res) => {
  try {
    // Basic structure sanity check
    const entry = req.body.entry && req.body.entry[0];
    if (!entry) return res.status(200).send('no_entry');

    const changes = entry.changes && entry.changes[0];
    const value = changes && changes.value;
    const messages = value && value.messages && value.messages[0];

    if (!messages) {
      return res.status(200).send('no_messages');
    }

    const from = messages.from; // WhatsApp user id
    const msgBody = messages.text && messages.text.body;
    const messageType = messages.type;

    console.log('Incoming message from', from, 'type', messageType, 'body', msgBody);

    // Build context and call OpenAI
    const openaiReply = await handleMessageWithOpenAI(from, msgBody);

    // If OpenAI desires to call Shopify (we will allow the model to put special tags like [SHOPIFY:ORDER_STATUS order_id=12345]),
    // parse intent and call Shopify functions. For simplicity, check for special token
    let finalReply = openaiReply;

    // Example simple intent detection (you should replace with better NLU)
    if (/order\s*#?\d+/i.test(msgBody) || /where.*order/i.test(msgBody) || /status.*order/i.test(msgBody)) {
      // extract an order number if present
      const matched = msgBody.match(/#?(\d{3,20})/);
      if (matched) {
        const orderId = matched[1];
        try {
          const orderInfo = await getShopifyOrderByName(orderId);
          if (orderInfo) {
            finalReply = `Order ${orderInfo.name} is currently ${orderInfo.fulfillment_status || 'processing'}. Tracking: ${orderInfo.tracking_number || 'Not available'}. Shipping service: ${orderInfo.shipping_carrier || 'N/A'}. Expected delivery: ${orderInfo.expected_delivery || 'N/A'}.`;
          } else {
            finalReply = `I couldn't find order ${orderId}. Could you please share the email or phone used for the order?`;
          }
        } catch (err) {
          console.error('Shopify fetch error', err.message);
          finalReply = `Sorry, I couldn't fetch your order right now. Try again in a bit.`;
        }
      }
    }

    // Send reply back via WhatsApp Cloud API
    await sendWhatsAppTextMessage(from, finalReply);

    // respond to webhook
    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('Webhook handler error', err);
    res.sendStatus(500);
  }
});

async function sendWhatsAppTextMessage(to, text) {
  const url = `https://graph.facebook.com/v16.0/${META_PHONE_NUMBER_ID}/messages`;
  // v16.0 — update if Meta changes version
  const payload = {
    messaging_product: "whatsapp",
    to: to,
    text: { body: text }
  };

  await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${META_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

// OpenAI call
async function handleMessageWithOpenAI(userId, userText) {
  const systemPrompt = `You are a helpful, friendly bilingual (English and Hindi) assistant for Chandheri Fashion (owner: Sandeep). Use Hindi if the user writes in Hindi, otherwise use English. When a user asks order status, attempt to ask for order number or fetch from Shopify if available. Keep replies short and sales-focused but polite.`;

  const openaiUrl = 'https://api.openai.com/v1/chat/completions';

  const body = {
    model: 'gpt-4-turbo',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
    temperature: 0.2,
    max_tokens: 400
  };

  const resp = await axios.post(openaiUrl, body, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  const reply = resp.data.choices[0].message.content.trim();
  return reply;
}

// Shopify: get order by name (example uses Admin REST API)
async function getShopifyOrderByName(orderNumberOrName) {
  // Shopify orders endpoint - filter by name is not direct; we search orders with query param 'name' in GraphQL or filter in code.
  // We'll call the Orders endpoint and try to find the matching name/number (for large stores you should use GraphQL)
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/orders.json?limit=10&name=${encodeURIComponent(orderNumberOrName)}`;

  const resp = await axios.get(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
      'Content-Type': 'application/json'
    }
  });

  const orders = resp.data.orders || [];
  if (orders.length === 0) return null;
  const o = orders[0];

  // Simplify returned info:
  return {
    id: o.id,
    name: o.name,
    fulfillment_status: o.fulfillment_status,
    tracking_number: o.fulfillments && o.fulfillments[0] && o.fulfillments[0].tracking_numbers && o.fulfillments[0].tracking_numbers[0],
    shipping_carrier: o.fulfillments && o.fulfillments[0] && o.fulfillments[0].tracking_company,
    expected_delivery: null // not always available
  };
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
