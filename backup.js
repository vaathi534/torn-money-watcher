require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FRIENDS = JSON.parse(process.env.FRIENDS || "[]");

let lastSeenTimestamp = {};
let uiLogs = [];
let clients = []; // SSE connections

app.get("/", (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Torn Money Watcher</title>
      <style>
        body { font-family: Arial; background: #111; color: #fff; }
        h1 { color: #0f0; }
        .log { margin-bottom: 8px; padding: 6px; background: #222; border-radius: 4px; }
        .time { color: #888; font-size: 0.85em; }
      </style>
    </head>
    <body>
      <h1>Torn Money Watcher</h1>
      <div id="logs"></div>
      <script>
        const logsDiv = document.getElementById("logs");
        const evtSource = new EventSource("/events");

        evtSource.onmessage = function(event) {
          const data = JSON.parse(event.data);
          const logEl = document.createElement("div");
          logEl.className = "log";
          logEl.innerHTML = "<div>" + data.text + "</div>" +
                            "<div class='time'>" + new Date(data.timestamp * 1000).toLocaleString() + "</div>";
          logsDiv.insertBefore(logEl, logsDiv.firstChild);
        };
      </script>
    </body>
    </html>
  `);
});

// SSE endpoint
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.push(res);

  req.on("close", () => {
    clients = clients.filter(client => client !== res);
  });
});

async function sendTelegramMessage(text) {
  try {
    const resp = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text
    });
    console.log("[TELEGRAM] Sent:", resp.data);
  } catch (err) {
    if (err.response) {
      console.error("[TELEGRAM ERROR]", err.response.data);
    } else {
      console.error("[TELEGRAM ERROR]", err.message);
    }
  }
}
async function getUserNameById(userId, apiKey) {
  try {
    const url = `https://api.torn.com/user/${userId}?selections=profile&key=${apiKey}`;
    const { data } = await axios.get(url);
    return `${data.name} [${userId}]`;
  } catch (err) {
    console.error(`[ERROR] Fetching username for ${userId}:`, err.message);
    return `Unknown [${userId}]`;
  }
}

async function fetchFriendLogs(friend) {
  try {
    const url = `https://api.torn.com/user/?selections=log&key=${friend.apiKey}`;
    const { data } = await axios.get(url);

    if (!data?.log) return;

    const latest = Object.values(data.log)
      .filter(l => l.title === "Money receive")
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (!latest) return;
    if (lastSeenTimestamp[friend.name] === latest.timestamp) return;

    lastSeenTimestamp[friend.name] = latest.timestamp;
    const senderName = await getUserNameById(latest.data.sender, friend.apiKey);

    const msg = `💰 ${friend.name} just received $${latest.data.money} from ${senderName}`;
    console.log(`[NOTIFY] ${msg}`);

    uiLogs.unshift({ text: msg, timestamp: latest.timestamp });
    if (uiLogs.length > 50) uiLogs.pop();

    // Push to all connected browsers
    clients.forEach(client => {
      client.write(`data: ${JSON.stringify({ text: msg, timestamp: latest.timestamp })}\n\n`);
    });

    await sendTelegramMessage(msg);
  } catch (err) {
    console.error(`[ERROR] Fetching logs for ${friend.name}: ${err.message}`);
  }
}

function startPolling() {
  console.log(`[Torn Money Watcher] Running at http://localhost:${PORT}`);
  console.log(`Polling interval: 15s`);
  FRIENDS.forEach(friend => {
    setInterval(() => fetchFriendLogs(friend), 15000);
  });
}

app.listen(PORT, startPolling);
