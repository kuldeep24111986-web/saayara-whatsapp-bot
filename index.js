import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// ✅ Step 1: Webhook verification (Meta GET request)
app.get("/webhook", (req, res) => {
  const verify_token = process.env.META_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("✅ WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// ✅ Step 2: Handle incoming messages (Meta POST request)
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message) {
      const from = message.from; // sender phone number
      const text = message.text?.body || "Hi";

      console.log("📩 Received:", text);

      // simple auto reply
      const reply = `Hello from Saayara Fashion 👗\nYou said: "${text}"`;

      await axios.post(
        `https://graph.facebook.com/v17.0/${process.env.META_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: reply },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("💬 Reply sent!");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error handling webhook:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// ✅ Step 3: Keepalive route (optional)
app.get("/", (req, res) => {
  res.send("Saayara WhatsApp Bot is running ✅");
});

// ✅ Step 4: Start server on Render port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
