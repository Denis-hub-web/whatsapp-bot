require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const AUTH_DIR = process.env.AUTH_DIR || './auth_info';

// Ensure auth directory exists
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// ─── Express + Socket.io setup ─────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
  res.json({ status: botStatus });
});

// ─── API Endpoints ──────────────────────────────────────────────────────────
app.post('/api/send', async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ error: 'Missing phone or message in request body' });
  }

  if (botStatus !== 'authenticated' || !waSocket) {
    return res.status(503).json({ error: 'WhatsApp bot is not authenticated' });
  }

  try {
    // Format phone number to JID (assuming user provides numbers like 1234567890)
    // We append @s.whatsapp.net if not already present
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;

    await waSocket.sendMessage(jid, { text: message });
    console.log(`[API] Message sent to ${jid}`);
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    console.error('[API] Error sending message:', err);
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
});

// ─── State ─────────────────────────────────────────────────────────────────
let botStatus = 'disconnected'; // 'disconnected' | 'waiting_qr' | 'authenticated'
let currentQR = null;
let waSocket = null;

// ─── WhatsApp Client ────────────────────────────────────────────────────────
async function startWhatsApp() {
  const logger = pino({ level: 'silent' });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`[WhatsApp] Using Baileys version: ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    browser: ['WhatsApp Bot', 'Chrome', '120.0.0'],
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  waSocket = sock;

  // ── QR Code ──────────────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('[WhatsApp] QR code received — scan with your phone');
      botStatus = 'waiting_qr';
      currentQR = qr;

      try {
        const qrImage = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'H',
          type: 'image/png',
          margin: 2,
          width: 300,
          color: { dark: '#000000', light: '#ffffff' },
        });
        io.emit('qr', { qrImage });
        io.emit('status', { status: 'waiting_qr', message: 'Scan the QR code with your WhatsApp' });
      } catch (err) {
        console.error('[WhatsApp] QR generation failed:', err);
      }
    }

    if (connection === 'open') {
      console.log('[WhatsApp] ✅ Connected & authenticated!');
      botStatus = 'authenticated';
      currentQR = null;
      io.emit('authenticated', { message: '✅ WhatsApp connected successfully!' });
      io.emit('status', { status: 'authenticated', message: 'Bot is live and running' });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[WhatsApp] Connection closed (code: ${statusCode}). Reconnect: ${shouldReconnect}`);
      botStatus = 'disconnected';
      io.emit('status', { status: 'disconnected', message: 'Connection lost. Reconnecting...' });

      if (shouldReconnect) {
        console.log('[WhatsApp] Reconnecting in 3 seconds...');
        setTimeout(startWhatsApp, 3000);
      } else {
        // Logged out — clear session so user can re-scan QR
        console.log('[WhatsApp] Logged out. Clearing session...');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        io.emit('status', { status: 'logged_out', message: 'Logged out. Please refresh and scan QR again.' });
        setTimeout(startWhatsApp, 2000);
      }
    }
  });

  // ── Save credentials on update ────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Message Handler ───────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip broadcast lists and status messages
      if (isJidBroadcast(msg.key.remoteJid)) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.fromMe) continue; // skip messages sent by the bot

      const from = msg.key.remoteJid;
      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      if (!body) continue;

      console.log(`[Message] From: ${from} — "${body}"`);

      // ── Bot Logic ──────────────────────────────────────────────────────────
      await handleMessage(sock, from, body, msg);
    }
  });
}

// ─── Bot Logic ──────────────────────────────────────────────────────────────
async function handleMessage(sock, from, body, rawMsg) {
  const text = body.trim().toLowerCase();

  try {
    // Typing indicator
    await sock.sendPresenceUpdate('composing', from);

    // ── Commands ─────────────────────────────────────────────────────────────
    if (text === '!ping') {
      await sendReply(sock, from, rawMsg, '🏓 Pong! Bot is alive.');

    } else if (text === '!help') {
      const helpText = `🤖 *WhatsApp Bot Commands*\n\n` +
        `!ping — Check if bot is online\n` +
        `!help — Show this menu\n` +
        `!time — Get current server time\n` +
        `!echo <text> — Bot repeats your message\n` +
        `\n_Send any message and the bot will echo it back._`;
      await sendReply(sock, from, rawMsg, helpText);

    } else if (text === '!time') {
      const now = new Date().toLocaleString('en-US', { timeZone: 'UTC' });
      await sendReply(sock, from, rawMsg, `🕐 Server time (UTC): ${now}`);

    } else if (text.startsWith('!echo ')) {
      const echoText = body.slice(6).trim();
      await sendReply(sock, from, rawMsg, `🔁 ${echoText}`);

    } else {
      // Default: echo back
      await sendReply(sock, from, rawMsg, `You said: "${body}"\n\n_Type !help for commands._`);
    }

    // Stop typing indicator
    await sock.sendPresenceUpdate('paused', from);

  } catch (err) {
    console.error('[Bot] Error sending message:', err);
  }
}

// ─── Send a quoted reply ─────────────────────────────────────────────────────
async function sendReply(sock, to, quotedMsg, text) {
  await sock.sendMessage(to, {
    text,
    quoted: quotedMsg,
  });
}

// ── Socket.io connection: send current state to new browsers ──────────────────
io.on('connection', async (socket) => {
  console.log('[Socket] Browser connected');

  // Send current status immediately
  socket.emit('status', {
    status: botStatus,
    message:
      botStatus === 'authenticated' ? 'Bot is live and running' :
        botStatus === 'waiting_qr' ? 'Scan the QR code with your WhatsApp' :
          'Connecting to WhatsApp...',
  });

  // If QR is already available, send it
  if (currentQR && botStatus === 'waiting_qr') {
    try {
      const qrImage = await QRCode.toDataURL(currentQR, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        margin: 2,
        width: 300,
        color: { dark: '#000000', light: '#ffffff' },
      });
      socket.emit('qr', { qrImage });
    } catch (err) {
      console.error('[Socket] QR resend error:', err);
    }
  }

  socket.on('disconnect', () => {
    console.log('[Socket] Browser disconnected');
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 WhatsApp Bot running at http://localhost:${PORT}`);
  console.log(`📁 Session stored at: ${path.resolve(AUTH_DIR)}\n`);
  startWhatsApp();
});
