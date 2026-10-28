import { CELL_SPEED, Course, H, W } from "./course";

// ---- Tuning -------------------------------------------------------------------

const COUNTDOWN = 3;
const LEVEL_OVER_TIME = 3.5;
const RESULTS_TIME = 8;
const LOBBY_RESPAWN = 1.5;

// Time limit = trip to the nearest goal at normal speed × this factor (+ a little).
const TIME_FACTOR_START = 3.2;
const TIME_FACTOR_STEP = 0.2; // shaved off each level
const TIME_FACTOR_MIN = 1.6;

const SHIP_TURN = 3.4; // rad/s. No drift: the ship always moves where its nose points.
const SHIP_RADIUS = 13;
const SPAWN_RING = 45; // players start on a small ring around the middle
const SLOT_GAP = 26; // spacing of ships lined up in a start or goal cell
const PARK_EASE = 6; // how quickly a finished ship glides into its spot in the goal

const FIRE_COOLDOWN = 2; // s between shots; both buttons still stop the ship meanwhile
const BULLET_SPEED = 340;
const BULLET_LIFE = 2.6;
const SHRAPNEL_LIFE = 1.2; // a dying ship throws 8 of these, and they kill like bullets

const TRAIL_LIFE = 4; // seconds before a bit of a ship's track has faded out
const TRAIL_STEP = 6; // px between trail points
const TRAIL_JUMP = 40; // a gap this big is a respawn, not flight: don't connect it

// No green: that's the goal colour.
const COLORS = ["#ff4757", "#1e90ff", "#ffa502", "#a55eea", "#00d2d3", "#ff6b81", "#eccc68", "#f368e0"];

// ---- Types --------------------------------------------------------------------

export type Phase = "lobby" | "countdown" | "race" | "levelover" | "results";

interface Input { l: boolean; r: boolean }

interface Ship {
  x: number; y: number; a: number;
  alive: boolean;
  finished: boolean; // reached the green cell this level, parked there
  parkX: number; parkY: number; // where it parks inside the goal
  stopped: boolean; // both buttons held
  fireCd: number;
  respawnT: number;
}

interface Player {
  id: string; name: string; color: string;
  levels: number; kills: number;
  out: boolean; // knocked out of the current match
  input: Input;
  ship: Ship | null; // null = not on the field this level
  trail: TrailPoint[]; // where the ship has been lately, oldest first
}

interface TrailPoint { x: number; y: number; t: number; cut: boolean } // cut: don't connect to the previous point
// owner: whose colour it is and who it can't hit. credit: who gets the kill.
interface Bullet { x: number; y: number; a: number; owner: Player; credit: Player | null; life: number; shrapnel: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string }

export interface UiState {
  phase: Phase;
  players: { id: string; name: string; color: string; levels: number; kills: number }[];
  joinUrl: string;
  qr: string;
  matchWinner: string | null;
  soloLevels: number | null;
  banner: string | null;
}

const KEYBOARD = [
  { id: "keyboard", name: "Keys", key: "k", left: "ArrowLeft", right: "ArrowRight" },
  { id: "keyboard2", name: "AD", key: "j", left: "a", right: "d" },
];

// Probe points around the hull that must stay on screen.
const HULL = [[0, 0], [16, 0], [-10, -10], [-10, 10]];

// ---- Game ---------------------------------------------------------------------

export class Game {
  private ctx: CanvasRenderingContext2D;
  private course = new Course();
  private players = new Map<string, Player>();
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private phase: Phase = "lobby";
  private phaseT = 0;
  private time = 0;
  private level = 0;
  private timeLeft = 0;
  private outcome = ""; // headline shown between levels
  private retry = false; // nobody made it: replay with the same players
  private matchWinner: Player | null = null;
  private soloLevels: number | null = null;
  private keys = new Set<string>();

  private ws: WebSocket | null = null;
  private stopped = false;
  private raf = 0;
  private lastFrame = 0;
  private statusTimer = 0;
  private joinUrl = "";
  private qr = "";
  private banner: string | null = null;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  constructor(private canvas: HTMLCanvasElement, private onUi: (ui: UiState) => void) {
    this.ctx = canvas.getContext("2d")!;
  }

  start() {
    this.course.build();
    this.course.setup(1, -1);
    addEventListener("resize", this.resize);
    addEventListener("keydown", this.keyDown);
    addEventListener("keyup", this.keyUp);
    this.resize();
    this.connect();
    this.loadJoinInfo();
    this.emitUi();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.resize);
    removeEventListener("keydown", this.keyDown);
    removeEventListener("keyup", this.keyUp);
    this.ws?.close();
  }

  // ---- Networking -------------------------------------------------------------

  private connect() {
    if (this.stopped) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?role=host`);
    this.ws = ws;
    ws.onopen = () => this.setBanner(null);
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      if (this.stopped || this.ws !== ws) return;
      if (e.code === 4000) return this.setBanner("This game was opened on another screen.");
      this.setBanner("Lost connection to the server — retrying…");
      setTimeout(() => this.connect(), 1000);
    };
  }

  private setBanner(text: string | null) {
    this.banner = text;
    this.emitUi();
  }

  private sendTo(id: string, msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "to", id, msg }));
  }

  private async loadJoinInfo() {
    try {
      const info = await (await fetch("/api/info")).json();
      this.joinUrl = info.joinUrl;
      this.qr = info.qr;
      this.emitUi();
    } catch {
      setTimeout(() => this.loadJoinInfo(), 2000);
    }
  }

  private onMessage(msg: { t: string; id: string; name?: string; l?: number; r?: number }) {
    switch (msg.t) {
      case "join": {
        const p = this.players.get(msg.id);
        if (p) p.name = msg.name || p.name;
        else this.addPlayer(msg.id, msg.name || "Player");
        this.sendTo(msg.id, { t: "welcome", color: this.players.get(msg.id)!.color });
        this.sendStatus(this.players.get(msg.id)!);
        break;
      }
      case "leave":
        this.removePlayer(msg.id);
        break;
      case "input": {
        const p = this.players.get(msg.id);
        if (p) p.input = { l: !!msg.l, r: !!msg.r };
        break;
      }
      case "start":
        if (this.phase === "lobby") this.startMatch();
        break;
    }
  }

  private sendStatus(p: Player) {
    if (p.id.startsWith("keyboard")) return;
    this.sendTo(p.id, {
      t: "status",
      phase: this.phase,
      level: this.level,
      inLevel: !!p.ship,
      alive: !!p.ship?.alive,
      finished: !!p.ship?.finished,
      out: p.out,
      timeLeft: Math.ceil(this.timeLeft),
      outcome: this.outcome,
      matchWinner: this.matchWinner?.name ?? null,
    });
  }

  private broadcastStatus() {
    for (const p of this.players.values()) this.sendStatus(p);
  }

  private emitUi() {
    this.onUi({
      phase: this.phase,
      players: [...this.players.values()].map(({ id, name, color, levels, kills }) => ({ id, name, color, levels, kills })),
      joinUrl: this.joinUrl,
      qr: this.qr,
      matchWinner: this.matchWinner?.name ?? null,
      soloLevels: this.soloLevels,
      banner: this.banner,
    });
  }

  // ---- Keyboard players (testing without phones) --------------------------------

  private keyDown = (e: KeyboardEvent) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.keys.add(key);
    if (key === "Enter" && this.phase === "lobby" && this.players.size > 0) this.startMatch();
    for (const k of KEYBOARD) {
      if (key === k.key && !this.players.has(k.id)) this.addPlayer(k.id, k.name);
    }
  };

  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  };

  private readKeyboard() {
    for (const k of KEYBOARD) {
      const p = this.players.get(k.id);
      if (p) p.input = { l: this.keys.has(k.left), r: this.keys.has(k.right) };
    }
  }

  // ---- Players & phases ---------------------------------------------------------

  private addPlayer(id: string, name: string) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[this.players.size % COLORS.length];
    const p: Player = { id, name, color, levels: 0, kills: 0, out: false, input: { l: false, r: false }, ship: null, trail: [] };
    this.players.set(id, p);
    if (this.phase === "lobby") p.ship = this.spawnShip(this.players.size - 1, 8);
    this.emitUi();
  }

  private removePlayer(id: string) {
    this.players.delete(id);
    this.bullets = this.bullets.filter((b) => b.owner.id !== id);
    if (this.players.size === 0 && this.phase !== "lobby") this.backToLobby();
    this.emitUi();
  }

  // Slot i of n on the ring around the middle, facing outwards.
  private spawnShip(i: number, n: number): Ship {
    const a = n <= 1 ? Math.random() * Math.PI * 2 : (i / n) * Math.PI * 2 + 0.3;
    const r = n <= 1 ? 0 : SPAWN_RING;
    return {
      x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r, a,
      alive: true, finished: false, stopped: false, fireCd: 0, respawnT: 0, parkX: 0, parkY: 0,
    };
  }

  // Slot k in a frame cell: rows of three along the edge, filling inwards, facing the field.
  private slot(site: number, k: number) {
    const c = this.course.site(site);
    const edge = Math.min(c.x, W - c.x, c.y, H - c.y);
    const [nx, ny] = edge === c.x ? [1, 0] : edge === W - c.x ? [-1, 0] : edge === c.y ? [0, 1] : [0, -1];
    const row = Math.floor(k / 3), col = [0, -1, 1][k % 3];
    return {
      x: c.x + nx * row * SLOT_GAP - ny * col * SLOT_GAP,
      y: c.y + ny * row * SLOT_GAP + nx * col * SLOT_GAP,
      a: Math.atan2(ny, nx),
    };
  }

  private spawnInStart(k: number): Ship {
    const ship = this.spawnShip(0, 1);
    return Object.assign(ship, this.slot(this.course.start, k));
  }

  private setPhase(phase: Phase, t = 0) {
    this.phase = phase;
    this.phaseT = t;
    this.emitUi();
    this.broadcastStatus();
  }

  private startMatch() {
    for (const p of this.players.values()) { p.levels = 0; p.kills = 0; p.out = false; }
    this.level = 0;
    this.matchWinner = null;
    this.soloLevels = null;
    this.startLevel(true);
  }

  private startLevel(advance: boolean) {
    // Level 1 starts in the middle. After that last level's green cell turns blue and
    // everyone starts there; a retry starts from the same blue cell again.
    if (advance) this.level++;
    const start = advance ? (this.level === 1 ? -1 : this.course.goal) : this.course.start;
    this.course.setup(this.level, start);
    this.bullets = [];
    this.outcome = "";
    this.retry = false;
    const from = start >= 0 ? this.course.site(start) : { x: W / 2, y: H / 2 };
    const goal = this.course.site(this.course.goal);
    const factor = Math.max(TIME_FACTOR_MIN, TIME_FACTOR_START - TIME_FACTOR_STEP * (this.level - 1));
    this.timeLeft = Math.ceil((Math.hypot(goal.x - from.x, goal.y - from.y) / CELL_SPEED.normal) * factor + 2);

    const list = [...this.players.values()];
    for (const p of list) p.ship = null;
    const racing = list.filter((p) => !p.out);
    racing.forEach((p, i) => (p.ship = start >= 0 ? this.spawnInStart(i) : this.spawnShip(i, racing.length)));
    this.setPhase("countdown", COUNTDOWN);
  }

  private backToLobby() {
    this.course.build();
    this.course.setup(1, -1);
    this.bullets = [];
    this.level = 0;
    this.outcome = "";
    const list = [...this.players.values()];
    list.forEach((p, i) => { p.out = false; p.ship = this.spawnShip(i, Math.max(8, list.length)); });
    this.setPhase("lobby");
  }

  private contenders() {
    return [...this.players.values()].filter((p) => p.ship);
  }

  // Still out on the field: alive and not yet home.
  private racing() {
    return this.contenders().filter((p) => p.ship!.alive && !p.ship!.finished);
  }

  private endLevel() {
    const contenders = this.contenders();
    const standing = contenders.filter((p) => p.ship!.alive);
    // Everyone else got shot: the last one standing takes it, home or not.
    const lastStanding = contenders.length >= 2 && standing.length === 1;
    const through = lastStanding ? standing : contenders.filter((p) => p.ship!.finished);
    for (const p of through) p.levels++;

    if (contenders.length <= 1) {
      // Solo: keep going until the clock wins.
      if (through.length) {
        this.outcome = `Level ${this.level} cleared!`;
        this.setPhase("levelover", LEVEL_OVER_TIME);
      } else {
        this.soloLevels = this.level - 1;
        this.outcome = "Out of time!";
        this.setPhase("levelover", LEVEL_OVER_TIME);
      }
      return;
    }

    if (through.length === 0) {
      // Nobody made it. Nobody is knocked out; same players, new map.
      this.outcome = "Nobody made it — try again!";
      this.retry = true;
    } else {
      for (const p of contenders) if (!through.includes(p)) p.out = true;
      if (through.length === 1) {
        this.matchWinner = through[0];
        this.outcome = `${through[0].name} WINS!`;
      } else {
        this.outcome = `${through.length} players go through`;
      }
    }
    this.setPhase("levelover", LEVEL_OVER_TIME);
  }

  // ---- Simulation -----------------------------------------------------------------

  private frame = (now: number) => {
    if (this.stopped) return;
    const dt = Math.min(0.05, this.lastFrame ? (now - this.lastFrame) / 1000 : 0);
    this.lastFrame = now;
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    this.time += dt;
    this.readKeyboard();
    this.course.step(dt);

    if ((this.statusTimer -= dt) <= 0) {
      this.statusTimer = 1;
      this.broadcastStatus();
    }

    if (this.phaseT > 0 && (this.phaseT -= dt) <= 0) this.phaseTimeout();
    const active = this.phase === "lobby" || this.phase === "race";

    if (active) {
      for (const p of this.players.values()) if (p.ship) this.stepShip(p, p.ship, dt);
      this.collideShips();
    }
    this.stepBullets(dt);
    this.stepParticles(dt);
    this.stepTrails();

    if (this.phase === "race") {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      const contenders = this.contenders().length;
      const standing = this.contenders().filter((p) => p.ship!.alive).length;
      if (this.timeLeft <= 0 || this.racing().length === 0 || (contenders >= 2 && standing <= 1)) this.endLevel();
    }
  }

  private phaseTimeout() {
    if (this.phase === "countdown") this.setPhase("race");
    else if (this.phase === "levelover") {
      if (this.matchWinner || this.soloLevels !== null) this.setPhase("results", RESULTS_TIME);
      else this.startLevel(!this.retry);
    } else if (this.phase === "results") this.backToLobby();
  }

  private hitsWall(x: number, y: number, a: number) {
    const c = Math.cos(a), s = Math.sin(a);
    return HULL.some(([dx, dy]) => this.course.isOutside(x + dx * c - dy * s, y + dx * s + dy * c));
  }

  private stepShip(p: Player, s: Ship, dt: number) {
    if (s.alive && s.finished) {
      const k = 1 - Math.exp(-PARK_EASE * dt);
      s.x += (s.parkX - s.x) * k;
      s.y += (s.parkY - s.y) * k;
    }
    if (!s.alive || s.finished) {
      // In the lobby you pop back up in the middle and keep playing.
      if (this.phase === "lobby" && (s.respawnT -= dt) <= 0) Object.assign(s, this.spawnShip(0, 1));
      return;
    }
    if (this.course.cellAt(s.x, s.y) === "danger") return this.kill(p, null);

    s.fireCd -= dt;
    const both = p.input.l && p.input.r;
    // Both buttons: stop dead and fire once straight ahead.
    if (both && !s.stopped && s.fireCd <= 0) {
      s.fireCd = FIRE_COOLDOWN;
      this.bullets.push({
        x: s.x + Math.cos(s.a) * 20, y: s.y + Math.sin(s.a) * 20, a: s.a,
        owner: p, credit: p, life: BULLET_LIFE, shrapnel: false,
      });
    }
    s.stopped = both;
    if (both) return;

    if (p.input.l) s.a -= SHIP_TURN * dt;
    if (p.input.r) s.a += SHIP_TURN * dt;
    const speed = CELL_SPEED[this.course.cellAt(s.x, s.y)];
    const dx = Math.cos(s.a) * speed * dt, dy = Math.sin(s.a) * speed * dt;

    // Black cells are just very slow; the screen edge is the wall. Slide along it.
    if (!this.hitsWall(s.x + dx, s.y + dy, s.a)) { s.x += dx; s.y += dy; }
    else if (!this.hitsWall(s.x + dx, s.y, s.a)) s.x += dx;
    else if (!this.hitsWall(s.x, s.y + dy, s.a)) s.y += dy;
    this.addTrail(p, s);

    if (this.course.cellAt(s.x, s.y) === "goal") this.finish(p, s);
  }

  private finish(p: Player, s: Ship) {
    const parked = [...this.players.values()].filter((q) => q.ship?.alive && q.ship.finished).length;
    const spot = this.slot(this.course.goal, parked);
    s.finished = true;
    s.stopped = false;
    s.parkX = spot.x;
    s.parkY = spot.y;
    s.respawnT = LOBBY_RESPAWN;
    this.burst(s.x, s.y, "#2ed573", 30);
    this.burst(s.x, s.y, p.color, 20);
    this.sendStatus(p);
  }

  private collideShips() {
    const ships = this.contenders().map((p) => p.ship!).filter((s) => s.alive && !s.finished);
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i], b = ships[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d > SHIP_RADIUS * 2) continue;
        const nx = dx / d, ny = dy / d, push = (SHIP_RADIUS * 2 - d) / 2;
        if (!this.hitsWall(a.x - nx * push, a.y - ny * push, a.a)) { a.x -= nx * push; a.y -= ny * push; }
        if (!this.hitsWall(b.x + nx * push, b.y + ny * push, b.a)) { b.x += nx * push; b.y += ny * push; }
      }
    }
  }

  private stepBullets(dt: number) {
    for (const b of this.bullets) {
      b.life -= dt;
      b.x += Math.cos(b.a) * BULLET_SPEED * dt;
      b.y += Math.sin(b.a) * BULLET_SPEED * dt;
      if (this.course.isOutside(b.x, b.y)) {
        b.life = 0;
        this.burst(b.x, b.y, b.owner.color, 8);
        continue;
      }
      for (const p of this.players.values()) {
        const s = p.ship;
        if (p === b.owner || !s?.alive || s.finished) continue;
        if (Math.hypot(s.x - b.x, s.y - b.y) < SHIP_RADIUS + 3) {
          b.life = 0;
          if (this.phase === "lobby" || this.phase === "race") this.kill(p, b.credit);
          break;
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  // `by` is who gets the kill: the shooter, whoever set off the chain of shrapnel, or
  // nobody for a red cell.
  private kill(p: Player, by: Player | null) {
    const s = p.ship!;
    s.alive = false;
    s.respawnT = LOBBY_RESPAWN;
    if (this.phase === "race" && by && by !== p) by.kills++;
    this.burst(s.x, s.y, p.color, 40);
    for (let k = 0; k < 8; k++) {
      this.bullets.push({ x: s.x, y: s.y, a: (k * Math.PI) / 4, owner: p, credit: by, life: SHRAPNEL_LIFE, shrapnel: true });
    }
    this.sendTo(p.id, { t: "buzz" });
    this.broadcastStatus();
    this.emitUi();
  }

  private burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 260;
      const max = 0.4 + Math.random() * 0.6;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: max, max, color });
    }
  }

  private stepParticles(dt: number) {
    for (const q of this.particles) {
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 1 - dt * 2;
      q.vy *= 1 - dt * 2;
    }
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  private addTrail(p: Player, s: Ship) {
    const last = p.trail[p.trail.length - 1];
    const d = last ? Math.hypot(s.x - last.x, s.y - last.y) : Infinity;
    if (d >= TRAIL_STEP) p.trail.push({ x: s.x, y: s.y, t: this.time, cut: d > TRAIL_JUMP });
  }

  private stepTrails() {
    for (const p of this.players.values()) {
      const old = p.trail.findIndex((q) => this.time - q.t < TRAIL_LIFE);
      if (old !== 0) p.trail.splice(0, old < 0 ? p.trail.length : old);
    }
  }

  // ---- Rendering --------------------------------------------------------------------

  private resize = () => {
    const dpr = devicePixelRatio || 1;
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.scale = Math.min(this.canvas.width / W, this.canvas.height / H);
    this.offX = (this.canvas.width - W * this.scale) / 2;
    this.offY = (this.canvas.height - H * this.scale) / 2;
  };

  private render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    this.course.draw(ctx, this.time);
    for (const p of this.players.values()) this.drawTrail(p);
    for (const b of this.bullets) this.drawBullet(b);
    for (const p of this.players.values()) if (p.ship?.alive) this.drawShip(p, p.ship);
    for (const q of this.particles) {
      ctx.globalAlpha = q.life / q.max;
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.drawHud();
  }

  private drawShip(p: Player, s: Ship) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.a);
    ctx.shadowColor = s.stopped ? "#fff" : p.color;
    ctx.shadowBlur = s.stopped ? 22 : 12;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-12, -11);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-12, 11);
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.restore();

    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.strokeText(p.name, s.x, s.y - 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(p.name, s.x, s.y - 22);
  }

  private drawTrail(p: Player) {
    const ctx = this.ctx;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 1; i < p.trail.length; i++) {
      const a = p.trail[i - 1], b = p.trail[i];
      if (b.cut) continue;
      ctx.globalAlpha = 0.8 * (1 - (this.time - a.t) / TRAIL_LIFE);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  private drawBullet(b: Bullet) {
    const ctx = this.ctx;
    const len = b.shrapnel ? 10 : 16;
    ctx.beginPath();
    ctx.moveTo(b.x - Math.cos(b.a) * len, b.y - Math.sin(b.a) * len);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = b.owner.color;
    ctx.lineWidth = b.shrapnel ? 3 : 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.shrapnel ? 3 : 4, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }

  private drawHud() {
    const ctx = this.ctx;
    if (this.phase === "lobby" || this.phase === "results") return;

    // Who's still in, top left (over the black frame).
    ctx.textAlign = "left";
    ctx.font = "bold 20px system-ui, sans-serif";
    let y = 34;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(`Level ${this.level}`, 20, y);
    for (const p of this.players.values()) {
      if (p.out && !p.ship) continue;
      y += 28;
      const s = p.ship;
      ctx.globalAlpha = s && s.alive ? 1 : 0.35;
      ctx.fillStyle = p.color;
      ctx.fillRect(20, y - 15, 16, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(`${p.name}${s?.finished ? "  ✓" : s && !s.alive ? "  ✗" : ""}`, 46, y);
    }
    ctx.globalAlpha = 1;

    // The clock, top centre.
    ctx.textAlign = "center";
    if (this.phase === "race" || this.phase === "countdown") {
      ctx.font = "900 44px system-ui, sans-serif";
      ctx.fillStyle = this.timeLeft <= 3 && this.phase === "race" && this.time % 0.5 < 0.25 ? "#ff4757" : "#fff";
      ctx.fillText(this.timeLeft.toFixed(this.timeLeft < 10 ? 1 : 0), W / 2, 48);
    }

    if (this.phase === "countdown") {
      ctx.font = "900 160px system-ui, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 6;
      ctx.strokeText(String(Math.ceil(this.phaseT)), W / 2, H / 2 + 55);
      ctx.fillText(String(Math.ceil(this.phaseT)), W / 2, H / 2 + 55);
    } else if (this.phase === "levelover") {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, H / 2 - 90, W, 150);
      ctx.font = "900 72px system-ui, sans-serif";
      ctx.fillStyle = this.matchWinner?.color ?? "#fff";
      ctx.fillText(this.outcome, W / 2, H / 2 + 10);
      ctx.font = "bold 24px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      const done = this.matchWinner || this.soloLevels !== null;
      ctx.fillText(done ? "" : "Next level coming up…", W / 2, H / 2 + 46);
    }
  }
}
