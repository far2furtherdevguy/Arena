// Neon Arena multiplayer server: serves public/index.html and runs 1v1 + Battle Royale rooms over WebSocket.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000, GOAL = 11;
const SP = [[-40,-40],[40,-40],[-40,40],[40,40],[-40,-6],[40,6],[-16,-41],[16,41]];
const WEAP = { ar: { d: 18, r: 100 }, smg: { d: 12, r: 60 }, mk: { d: 45, r: 500 } }; // damage, fire interval ms
const zoneR = t => t < 20 ? 70 : Math.max(12, 70 - (t - 20) * 0.35);
let nextId = 1; const rooms = new Map(), open = { duel: null, br: null };

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, d) => {
    if (e) { res.writeHead(404); return res.end('public/index.html missing'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });
const send = (p, o) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); };
const bcast = (r, o, except) => { for (const p of r.players.values()) if (p !== except) send(p, o); };
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : 0));

function newRoom(mode, code) {
  const r = { id: nextId++, mode, cap: mode === 'br' ? 8 : 2, code, players: new Map(), started: false, over: false, t0: 0, timer: null, lt: null, zi: null, startAt: 0 };
  rooms.set(r.id, r); return r;
}
function farthest(placed) {
  let best = SP[0], bd = -1;
  for (const s of SP) { let m = 1e9; for (const q of placed) m = Math.min(m, Math.hypot(q[0] - s[0], q[1] - s[1])); if (m > bd) { bd = m; best = s; } }
  return best;
}
function spawnPick(r, self) {
  const others = [...r.players.values()].filter(p => p !== self && !p.dead).map(p => [p.x, p.z]);
  return others.length ? farthest(others) : SP[Math.floor(Math.random() * SP.length)];
}
function join(p, mode, code) {
  leave(p); let r;
  if (code && mode === 'duel') r = [...rooms.values()].find(x => x.code === code && !x.started && x.players.size < x.cap) || newRoom('duel', code);
  else { r = open[mode]; if (!r || r.started || r.players.size >= r.cap) r = open[mode] = newRoom(mode); }
  p.room = r; r.players.set(p.id, p); lobby(r);
}
function lobby(r) {
  const n = r.players.size;
  if (n >= r.cap) return start(r);
  if (r.mode === 'br' && n >= 2 && !r.timer) {
    r.startAt = Date.now() + 15000; r.timer = setTimeout(() => start(r), 15000);
    r.lt = setInterval(() => { if (!r.started) bcast(r, { t: 'wait', n: r.players.size, cap: r.cap, in: Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000)) }); }, 1000);
  }
  bcast(r, { t: 'wait', n, cap: r.cap, in: r.timer ? Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000)) : undefined });
}
function start(r) {
  if (r.started) return;
  clearTimeout(r.timer); clearInterval(r.lt); r.started = true; if (open[r.mode] === r) open[r.mode] = null; r.t0 = Date.now();
  const placed = [];
  for (const p of r.players.values()) {
    const s = placed.length ? farthest(placed) : SP[Math.floor(Math.random() * SP.length)]; placed.push(s);
    Object.assign(p, { x: s[0], y: 0, z: s[1], hp: 100, kills: 0, dead: false, heals: 2, prot: Date.now() + 3000, nextHit: 0 });
  }
  const list = [...r.players.values()].map(p => ({ id: p.id, name: p.name, x: p.x, z: p.z }));
  for (const p of r.players.values()) send(p, { t: 'go', you: p.id, mode: r.mode, goal: GOAL, players: list });
  if (r.mode === 'br') r.zi = setInterval(() => zoneTick(r), 1000);
}
function zoneTick(r) {
  if (r.over) return;
  const zr = zoneR((Date.now() - r.t0) / 1000), now = Date.now();
  for (const p of [...r.players.values()]) {
    if (p.dead || now < p.prot || Math.hypot(p.x, p.z) <= zr) continue;
    p.hp -= 4;
    if (p.hp <= 0) die(r, null, p, 0); else { send(p, { t: 'hp', hp: p.hp, from: 0 }); bcast(r, { t: 'oh', id: p.id, hp: p.hp }, p); }
  }
}
function die(r, k, v, hd) {
  v.dead = true; v.hp = 0; if (k) k.kills++;
  bcast(r, { t: 'k', k: k ? k.id : -1, v: v.id, hd: hd ? 1 : 0 });
  bcast(r, { t: 'sc', s: [...r.players.values()].map(p => [p.id, p.kills]) });
  if (k && k.kills >= GOAL) return endRoom(r, k.id);
  setTimeout(() => {
    if (r.over || !r.players.has(v.id)) return;
    const s = spawnPick(r, v); v.x = s[0]; v.z = s[1]; v.y = 0; v.hp = 100; v.dead = false; v.heals = 2; v.prot = Date.now() + 3000;
    send(v, { t: 'rs', x: s[0], z: s[1] }); bcast(r, { t: 'ro', id: v.id, x: s[0], z: s[1] }, v);
  }, 3000);
}
function endRoom(r, winner) {
  if (r.over) return; r.over = true; clearInterval(r.zi); clearTimeout(r.timer); clearInterval(r.lt);
  bcast(r, { t: 'end', w: winner });
  setTimeout(() => { for (const p of r.players.values()) p.room = null; rooms.delete(r.id); if (open[r.mode] === r) open[r.mode] = null; }, 8000);
}
function leave(p) {
  const r = p.room; if (!r) return;
  r.players.delete(p.id); p.room = null;
  if (!r.started) {
    if (r.players.size === 0) { clearTimeout(r.timer); clearInterval(r.lt); rooms.delete(r.id); if (open[r.mode] === r) open[r.mode] = null; return; }
    if (r.mode === 'br' && r.players.size < 2) { clearTimeout(r.timer); clearInterval(r.lt); r.timer = null; r.lt = null; }
    return lobby(r);
  }
  bcast(r, { t: 'l', id: p.id });
  if (r.mode === 'duel' && !r.over) { const o = [...r.players.values()][0]; if (o) endRoom(r, o.id); }
  if (r.players.size === 0) { clearInterval(r.zi); rooms.delete(r.id); if (open[r.mode] === r) open[r.mode] = null; }
}

wss.on('connection', ws => {
  const p = { id: nextId++, ws, name: 'Player', room: null, msgs: 0, lastG: 0 };
  ws.p = p; ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {}); ws.on('close', () => leave(p));
  ws.on('message', raw => {
    if (++p.msgs > 150) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const r = p.room, live = r && r.started && !r.over;
    switch (m.t) {
      case 'q': {
        const mode = m.mode === 'br' ? 'br' : 'duel';
        p.name = String(m.name || 'Player').replace(/[^\w \-]/g, '').slice(0, 14) || 'Player';
        join(p, mode, String(m.code || '').replace(/[^\w\-]/g, '').slice(0, 12)); break;
      }
      case 'u': if (live && !p.dead) {
        p.x = num(m.x, -44, 44); p.y = num(m.y, 0, 15); p.z = num(m.z, -44, 44);
        bcast(r, { t: 's', id: p.id, x: p.x, y: p.y, z: p.z, w: num(m.w, -20, 20), p: num(m.p, -2, 2) }, p);
      } break;
      case 'f': if (live && !p.dead) bcast(r, { t: 'f', id: p.id }, p); break;
      case 'h': {
        if (!live || p.dead) break;
        const t = r.players.get(m.id), W = WEAP[m.wp], now = Date.now();
        if (!t || t === p || t.dead || !W || now < p.nextHit || now < t.prot) break;
        if (Math.hypot(p.x - t.x, p.z - t.z) > 130) break;
        p.nextHit = now + W.r * 0.8;
        const hd = m.hd ? 1 : 0; t.hp -= Math.round(W.d * (hd ? 2.2 : 1));
        if (t.hp <= 0) die(r, p, t, hd); else { send(t, { t: 'hp', hp: t.hp, from: p.id }); bcast(r, { t: 'oh', id: t.id, hp: t.hp }, t); }
      } break;
      case 'm': if (live && !p.dead && p.heals > 0 && p.hp < 100) {
        p.heals--; p.hp = Math.min(100, p.hp + 50); send(p, { t: 'hp', hp: p.hp, from: 0 }); bcast(r, { t: 'oh', id: p.id, hp: p.hp }, p);
      } break;
      case 'g': if (live && !p.dead && Date.now() - p.lastG > 2500) {
        p.lastG = Date.now(); bcast(r, { t: 'g', x: num(m.x, -44, 44), z: num(m.z, -44, 44), w: num(m.w, .4, 3.6), d: num(m.d, .4, 3.6) }, p);
      } break;
    }
  });
});
const resetT = setInterval(() => { for (const c of wss.clients) if (c.p) c.p.msgs = 0; }, 1000);
const hb = setInterval(() => { for (const c of wss.clients) { if (!c.isAlive) { c.terminate(); continue; } c.isAlive = false; c.ping(); } }, 30000);
wss.on('close', () => { clearInterval(hb); clearInterval(resetT); });
server.listen(PORT, () => console.log('Neon Arena server on port ' + PORT));
