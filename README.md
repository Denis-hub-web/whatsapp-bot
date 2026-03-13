# 🤖 WhatsApp Bot

A WhatsApp automation bot built with **Baileys** (no Puppeteer/Chrome needed), deployable on [Render](https://render.com).

## Features
- 🌐 **Web QR Login** — Scan QR via browser to authenticate
- 💾 **Session Persistence** — Stays logged in across restarts
- 💬 **Bot Commands** — `!ping`, `!help`, `!time`, `!echo`
- ☁️ **Render Ready** — One-click deploy with `render.yaml`

---

## Local Development

```bash
# 1. Clone / enter the project
cd whatsapp-bot

# 2. Install dependencies
npm install

# 3. Copy environment file
copy .env.example .env

# 4. Start the bot
npm start
```

Open **http://localhost:3000** and scan the QR code with your WhatsApp.

---

## Deploy to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New** → **Web Service**
3. Connect your GitHub repo
4. Render will auto-detect `render.yaml` and configure everything
5. Add a **Persistent Disk** (mounted at `/data`) — required to keep session
6. Deploy → Open your Render URL → Scan the QR

> ⚠️ **Persistent Disk** is required. Without it, you'll need to re-scan QR on every restart.

---

## Bot Commands

| Command | Response |
|---|---|
| `!ping` | 🏓 Pong! Bot is alive. |
| `!help` | Shows command list |
| `!time` | Current server time |
| `!echo <text>` | Echoes your text back |
| (anything else) | Echoes the message |

---

## Project Structure

```
whatsapp-bot/
├── server.js         # Main server (Baileys + Express + Socket.io)
├── public/
│   └── index.html    # QR login web UI
├── package.json
├── render.yaml       # Render deployment config
├── .env.example      # Environment variable template
└── .gitignore
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `AUTH_DIR` | `./auth_info` | Session storage path |

On Render, set `AUTH_DIR=/data/auth_info` (auto-set by `render.yaml`).
