/* eslint-disable @typescript-eslint/no-require-imports */
// Game server.
// Runs Next.js (the TV page at / and the phone controller at /play) and
// relays WebSocket messages between phones and the TV. The TV runs the game
// simulation; the server is only a switchboard.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const next = require('next');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 8;
const dev = process.env.NODE_ENV !== 'production';
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// First non-internal IPv4 address, so phones on the same Wi-Fi can reach us.
function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return 'localhost';
}

// PUBLIC_URL overrides the auto-detected address (useful behind Docker/VMs).
function joinUrl() {
  const base = process.env.PUBLIC_URL || `http://${lanAddress()}:${PORT}`;
  return base.replace(/\/$/, '') + '/play';
}

async function handleInfo(res) {
  const url = joinUrl();
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 512 });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ joinUrl: url, qr }));
}

// Next only hot-reloads its own page. public/tv.js is built separately, so keep it
// rebuilding as the game code changes, or the old-TV page runs stale code.
if (dev) {
  const { spawn } = require('child_process');
  const tv = spawn(process.execPath, [path.join(__dirname, 'scripts/build-tv.mjs'), '--watch'], { stdio: 'inherit' });
  process.on('exit', () => tv.kill());
}

const app = next({ dev });
const handle = app.getRequestHandler();

// ---- Settings ----------------------------------------------------------------
// The TV owns the settings (src/game/settings.ts) and checks them. The server just
// keeps the last ones it was sent, on disk, and hands them to every new TV screen.

let savedSettings = null; // { values, defaults }
try { savedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}

let saveTimer = null;
function saveSettings(values, defaults) {
  savedSettings = { values, defaults };
  // A slider sends lots of changes; write once it settles.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(SETTINGS_FILE, JSON.stringify(savedSettings, null, 2), (e) => {
      if (e) console.error('Could not save settings:', e.message);
    });
  }, 500);
}

// ---- WebSocket relay -------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

let host = null; // the TV socket
const players = new Map(); // player id -> { ws, name }

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function attachHost(ws) {
  if (host) host.close(4000, 'replaced by a new screen');
  host = ws;
  if (savedSettings) send(host, { t: 'savedSettings', ...savedSettings });
  // Tell the new screen about everyone already holding a controller.
  for (const [id, p] of players) send(host, { t: 'join', id, name: p.name });
  for (const p of players.values()) send(p.ws, { t: 'host', online: true });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    // Host -> one player, or host -> everyone.
    if (msg.t === 'to') send(players.get(msg.id)?.ws, msg.msg);
    else if (msg.t === 'all') for (const p of players.values()) send(p.ws, msg.msg);
    else if (msg.t === 'saveSettings') saveSettings(msg.values, msg.defaults);
  });

  ws.on('close', () => {
    if (host !== ws) return;
    host = null;
    for (const p of players.values()) send(p.ws, { t: 'host', online: false });
  });
}

function attachPlayer(ws) {
  let id = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join') {
      const wantId = String(msg.id || '').slice(0, 40);
      const name = String(msg.name || 'Player').trim().slice(0, 12) || 'Player';
      if (!wantId) return;
      const existing = players.get(wantId);
      if (!existing && players.size >= MAX_PLAYERS) {
        send(ws, { t: 'full' });
        ws.close();
        return;
      }
      // Same phone reconnecting: drop the stale socket, keep the player slot.
      if (existing && existing.ws !== ws) {
        existing.ws.removeAllListeners('close');
        existing.ws.close(4001, 'reconnected elsewhere');
      }
      id = wantId;
      players.set(id, { ws, name });
      send(ws, { t: 'host', online: !!host });
      send(host, { t: 'join', id, name });
      return;
    }

    if (!id) return;
    // Everything else from a player is forwarded to the TV, stamped with
    // the server-side id so phones can't impersonate each other.
    send(host, { ...msg, id });
  });

  ws.on('close', () => {
    if (!id || players.get(id)?.ws !== ws) return;
    players.delete(id);
    send(host, { t: 'leave', id });
  });
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const role = new URL(req.url, 'http://x').searchParams.get('role');
  if (role === 'host') attachHost(ws);
  else attachPlayer(ws);
});

// Keep idle connections alive through phone sleep / Wi-Fi power saving.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 10000);

// ---- HTTP ------------------------------------------------------------------

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/info') {
      handleInfo(res).catch((e) => {
        res.writeHead(500).end(String(e));
      });
      return;
    }
    handle(req, res);
  });

  // /ws is ours; every other upgrade (Next's hot reload in dev) goes to Next.
  const nextUpgrade = app.getUpgradeHandler();
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      nextUpgrade(req, socket, head);
    }
  });

  server.listen(PORT, () => {
    console.log(`Game running${dev ? ' (dev)' : ''}.`);
    console.log(`  TV screen:   http://localhost:${PORT}/  (open this on the TV / big screen)`);
    console.log(`  Phones join: ${joinUrl()}  (or scan the QR code on the TV)`);
  });
});
