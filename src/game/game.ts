import { cellSpeed, Course, H, W } from "./course";
import { addDot, addLine, addOutline } from "./draw";
import { Music } from "./music";
import { clean, FACTORY, isAdmin, settings, SETTINGS, Values } from "./settings";

// ---- Tuning -------------------------------------------------------------------
// Speeds, sizes and the like that can be changed from a phone live in settings.ts.

const COUNTDOWN = 3;
const LEVEL_OVER_TIME = 3.5;
const RESULTS_TIME = 8;
const LOBBY_RESPAWN = 1.5;
const TURN_TIME = 3; // the last one home may turn around inside the goal this long after the level ends

// Time limit = trip to the nearest goal at normal speed × this factor (+ a little).
const TIME_FACTOR_START = 3.2;
const TIME_FACTOR_STEP = 0.2; // shaved off each level
const TIME_FACTOR_MIN = 1.6;

const SHIP_RADIUS = 8; // at size 1. No drift: the ship always moves where its nose points.
const SPAWN_RING = 45; // players start on a small ring around the middle
const SLOT_GAP = 21; // spacing of ships lined up in a start cell

const TRAIL_STEP = 6; // px between trail points
const TRAIL_JUMP = 40; // a gap this big is a respawn, not flight: don't connect it
const SHIP_SHAPE = [[11, 0], [-7, -6], [-4, 0], [-7, 6]]; // pointing along +x, at size 1

// No green: that's the goal colour.
const COLORS = ["#ff4757", "#1e90ff", "#ffa502", "#a55eea", "#00d2d3", "#ff6b81", "#eccc68", "#f368e0"];

// ---- Types --------------------------------------------------------------------

export type Phase = "lobby" | "countdown" | "race" | "levelover" | "results";

interface Input { l: boolean; r: boolean }

interface Ship {
  x: number; y: number; a: number;
  alive: boolean;
  finished: boolean; // inside the green cell right now; you have to stay there until the level ends
  stopped: boolean; // both buttons held
  pivot: boolean; // came out of a stop with one button still held: turn on the spot until it's let go
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

// Probe points around the hull that must stay on screen, at size 1.
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
  private lastHome: Player | null = null; // the latest to reach the green cell this level
  private turnT = 0; // time lastHome has left to turn around in the goal between levels
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
  private defaults: Values = { ...FACTORY }; // what the Default button goes back to
  private music = new Music();

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
    this.music.start();
    this.emitUi();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.resize);
    removeEventListener("keydown", this.keyDown);
    removeEventListener("keyup", this.keyUp);
    this.music.stop();
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

  private onMessage(msg: {
    t: string; id?: string; name?: string; l?: number; r?: number;
    key?: string; value?: number; values?: Values; defaults?: Values;
  }) {
    // The server's own messages have no id; everything a phone sends is stamped with one.
    if (!msg.id) {
      if (msg.t === "savedSettings") {
        this.defaults = clean(msg.defaults, FACTORY);
        this.changeSettings(clean(msg.values, this.defaults), false);
      }
      return;
    }
    if (msg.t === "settings") return this.onSettings(msg.id, msg);
    switch (msg.t) {
      case "join": {
        const p = this.players.get(msg.id);
        if (p) p.name = msg.name || p.name;
        else this.addPlayer(msg.id, msg.name || "Player");
        this.sendTo(msg.id, { t: "welcome", color: this.players.get(msg.id)!.color });
        this.sendStatus(this.players.get(msg.id)!);
        if (isAdmin(this.players.get(msg.id)!.name)) {
          this.sendTo(msg.id, { t: "settings", schema: SETTINGS, values: settings, defaults: this.defaults });
        }
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

  // ---- Settings (from the admin phone) ---------------------------------------------

  // action: "set" one key, "reset" to the defaults, "saveDefault" makes the current
  // values the defaults, "factory" goes back to what settings.ts says.
  private onSettings(id: string, msg: { action?: string; key?: string; value?: number }) {
    const p = this.players.get(id);
    if (!p || !isAdmin(p.name)) return;
    if (msg.action === "set" && msg.key) this.changeSettings(clean({ ...settings, [msg.key]: msg.value }, settings));
    else if (msg.action === "reset") this.changeSettings(this.defaults);
    else if (msg.action === "factory") this.changeSettings(FACTORY);
    else if (msg.action === "saveDefault") {
      this.defaults = { ...settings };
      this.changeSettings(settings);
    }
  }

  private changeSettings(values: Values, save = true) {
    Object.assign(settings, values);
    this.music.apply();
    // A new number of polygons needs a new map, which only happens in the lobby.
    if (this.phase === "lobby" && this.course.builtCells !== settings.cells) {
      this.course.build();
      this.course.setup(1, -1);
    }
    if (save && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: "saveSettings", values: settings, defaults: this.defaults }));
    }
    for (const p of this.players.values()) {
      if (isAdmin(p.name)) this.sendTo(p.id, { t: "settings", values: settings, defaults: this.defaults });
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
      alive: true, finished: false, stopped: false, pivot: false, fireCd: 0, respawnT: 0,
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
    // everyone carries on from where they stood when it ended; a retry lines everyone
    // up in the same blue cell again.
    if (advance) this.level++;
    const start = advance ? (this.level === 1 ? -1 : this.course.goal) : this.course.start;
    this.course.setup(this.level, start);
    this.bullets = [];
    this.outcome = "";
    this.retry = false;
    this.lastHome = null;
    this.turnT = 0;
    const from = start >= 0 ? this.course.site(start) : { x: W / 2, y: H / 2 };
    const goal = this.course.site(this.course.goal);
    const factor = Math.max(TIME_FACTOR_MIN, TIME_FACTOR_START - TIME_FACTOR_STEP * (this.level - 1)) * settings.timeScale;
    const speed = Math.max(1, settings.speedNormal);
    this.timeLeft = Math.ceil((Math.hypot(goal.x - from.x, goal.y - from.y) / speed) * factor + 2);

    const list = [...this.players.values()];
    const was = new Map(list.map((p) => [p, p.ship]));
    for (const p of list) p.ship = null;
    const racing = list.filter((p) => !p.out);
    racing.forEach((p, i) => {
      const old = was.get(p);
      if (advance && this.level > 1 && old?.alive) p.ship = Object.assign(this.spawnShip(0, 1), { x: old.x, y: old.y, a: old.a });
      else p.ship = start >= 0 ? this.spawnInStart(i) : this.spawnShip(i, racing.length);
    });
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
    if (this.lastHome?.ship?.finished) this.turnT = TURN_TIME;

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
    if (this.phase === "levelover" && this.turnT > 0) {
      this.turnT -= dt;
      const s = this.lastHome?.ship;
      if (s?.alive) this.stepPenned(this.lastHome!, s, dt);
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

  // How far the hull pokes out past the screen edge (0 when it's all inside).
  private wallDepth(x: number, y: number, a: number) {
    const k = settings.shipSize, c = Math.cos(a) * k, s = Math.sin(a) * k;
    let depth = 0;
    for (const [dx, dy] of HULL) {
      const px = x + dx * c - dy * s, py = y + dx * s + dy * c;
      depth = Math.max(depth, -px, px - W, -py, py - H);
    }
    return depth;
  }

  // Turning isn't checked, so a ship by the edge can end up poking out of the screen.
  // Any move that doesn't push it further out is allowed, so it can always get back.
  private hitsWall(x: number, y: number, s: Ship) {
    return this.wallDepth(x, y, s.a) > this.wallDepth(s.x, s.y, s.a) + 1e-6;
  }

  private stepShip(p: Player, s: Ship, dt: number) {
    if (!s.alive) {
      // In the lobby you pop back up in the middle and keep playing.
      if (this.phase === "lobby" && (s.respawnT -= dt) <= 0) Object.assign(s, this.spawnShip(0, 1));
      return;
    }
    if (this.course.cellAt(s.x, s.y) === "danger") return this.kill(p, null);

    s.fireCd -= dt;
    const both = p.input.l && p.input.r;
    // Both buttons: stop dead and fire once straight ahead.
    if (both && !s.stopped && s.fireCd <= 0) {
      s.fireCd = settings.fireCooldown;
      const nose = 15 * settings.shipSize;
      this.bullets.push({
        x: s.x + Math.cos(s.a) * nose, y: s.y + Math.sin(s.a) * nose, a: s.a,
        owner: p, credit: p, life: Infinity, shrapnel: false,
      });
    }
    s.stopped = both;
    if (both) { s.pivot = true; return; }

    if (p.input.l) s.a -= settings.shipTurn * dt;
    if (p.input.r) s.a += settings.shipTurn * dt;
    if (!p.input.l && !p.input.r) s.pivot = false;
    if (s.pivot) return;
    const speed = cellSpeed(this.course.cellAt(s.x, s.y));
    const start = this.course.start;
    if (this.phase === "race" && start >= 0 && this.course.siteAt(s.x, s.y) === start) {
      // The blue cell is open towards the field only: its other walls still bounce you.
      this.penMove(p, s, speed * dt, start, true);
    } else {
      const dx = Math.cos(s.a) * speed * dt, dy = Math.sin(s.a) * speed * dt;
      // Black cells are just very slow; the screen edge is the wall. Slide along it.
      if (!this.hitsWall(s.x + dx, s.y + dy, s)) { s.x += dx; s.y += dy; }
      else if (!this.hitsWall(s.x + dx, s.y, s)) s.x += dx;
      else if (!this.hitsWall(s.x, s.y + dy, s)) s.y += dy;
      this.addTrail(p, s);
    }

    // Home only counts while you're in the green cell: fly out again and you're racing.
    const home = this.phase === "race" && this.course.cellAt(s.x, s.y) === "goal";
    if (home !== s.finished) {
      s.finished = home;
      if (home) this.lastHome = p;
      this.sendStatus(p);
    }
  }

  // Steering inside the goal after the level is over: no shooting, and every wall of
  // the goal bounces you back instead of letting you out.
  private stepPenned(p: Player, s: Ship, dt: number) {
    if (p.input.l && p.input.r) return;
    if (p.input.l) s.a -= settings.shipTurn * dt;
    if (p.input.r) s.a += settings.shipTurn * dt;
    this.penMove(p, s, cellSpeed("goal") * dt, this.course.goal, false);
  }

  // Moves `dist` inside cell `site`, bouncing off its walls. With `open` the walls
  // towards the field let you through and only those to the frame and screen edge bounce.
  private penMove(p: Player, s: Ship, dist: number, site: number, open: boolean) {
    const x = s.x + Math.cos(s.a) * dist, y = s.y + Math.sin(s.a) * dist;
    const n = this.penWall(x, y, s, site, open);
    if (!n) { s.x = x; s.y = y; this.addTrail(p, s); return; }
    // Mirror the heading in the wall, if we're heading into it.
    const vx = Math.cos(s.a), vy = Math.sin(s.a), d = vx * n.x + vy * n.y;
    if (d > 0) s.a = Math.atan2(vy - 2 * d * n.y, vx - 2 * d * n.x);
  }

  // Outward normal of the wall the ship would hit moving to (x, y), or null if it may go
  // there. Like reaching home, leaving the cell counts by the ship's middle; the screen
  // edge stops the whole hull.
  private penWall(x: number, y: number, s: Ship, site: number, open: boolean) {
    if (this.hitsWall(x, y, s)) {
      // Bounce off whichever screen edge the move pushes further into.
      const out = (cx: number, cy: number) => {
        const k = settings.shipSize, c = Math.cos(s.a) * k, sn = Math.sin(s.a) * k;
        const d = [0, 0, 0, 0]; // left, right, top, bottom
        for (const [dx, dy] of HULL) {
          const px = cx + dx * c - dy * sn, py = cy + dx * sn + dy * c;
          d[0] = Math.max(d[0], -px); d[1] = Math.max(d[1], px - W);
          d[2] = Math.max(d[2], -py); d[3] = Math.max(d[3], py - H);
        }
        return d;
      };
      const now = out(s.x, s.y), next = out(x, y);
      const e = [0, 1, 2, 3].reduce((m, i) => (next[i] - now[i] > next[m] - now[m] ? i : m), 0);
      return [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }][e];
    }
    const j = this.course.siteAt(x, y);
    if (j !== site && !(open && !this.course.isFrame(j))) {
      // Voronoi edges are halfway between two sites, square to the line joining them.
      const c = this.course.site(site), o = this.course.site(j);
      const len = Math.hypot(o.x - c.x, o.y - c.y) || 1;
      return { x: (o.x - c.x) / len, y: (o.y - c.y) / len };
    }
    return null;
  }

  private collideShips() {
    const ships = this.contenders().map((p) => p.ship!).filter((s) => s.alive);
    const r = SHIP_RADIUS * settings.shipSize;
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i], b = ships[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d > r * 2) continue;
        const nx = dx / d, ny = dy / d, push = (r * 2 - d) / 2;
        if (!this.hitsWall(a.x - nx * push, a.y - ny * push, a)) { a.x -= nx * push; a.y -= ny * push; }
        if (!this.hitsWall(b.x + nx * push, b.y + ny * push, b)) { b.x += nx * push; b.y += ny * push; }
      }
    }
  }

  private stepBullets(dt: number) {
    for (const b of this.bullets) {
      const speed = b.shrapnel ? settings.shrapnelSpeed : settings.bulletSpeed;
      b.life -= dt;
      b.x += Math.cos(b.a) * speed * dt;
      b.y += Math.sin(b.a) * speed * dt;
      // Gone once it has slid fully off the screen.
      const r = b.shrapnel ? 1.5 : 2;
      if (b.x < -r || b.x > W + r || b.y < -r || b.y > H + r) {
        b.life = 0;
        continue;
      }
      for (const p of this.players.values()) {
        const s = p.ship;
        if (p === b.owner || !s?.alive || s.finished) continue;
        if (Math.hypot(s.x - b.x, s.y - b.y) < SHIP_RADIUS * settings.shipSize + 3) {
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
    const n = settings.shrapnelCount;
    for (let k = 0; k < n; k++) {
      this.bullets.push({ x: s.x, y: s.y, a: (k * Math.PI * 2) / n, owner: p, credit: by, life: settings.shrapnelLife, shrapnel: true });
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
    if (d >= TRAIL_STEP && settings.trailLife > 0) p.trail.push({ x: s.x, y: s.y, t: this.time, cut: d > TRAIL_JUMP });
  }

  private stepTrails() {
    for (const p of this.players.values()) {
      const old = p.trail.findIndex((q) => this.time - q.t < settings.trailLife);
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
    ctx.scale(settings.shipSize, settings.shipSize);
    ctx.beginPath();
    SHIP_SHAPE.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.beginPath();
    addOutline(ctx, SHIP_SHAPE, 1);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
  }

  private drawTrail(p: Player) {
    const ctx = this.ctx;
    ctx.fillStyle = p.color;
    for (let i = 1; i < p.trail.length; i++) {
      const a = p.trail[i - 1], b = p.trail[i];
      if (b.cut) continue;
      ctx.globalAlpha = Math.max(0, 0.8 * (1 - (this.time - a.t) / settings.trailLife));
      ctx.beginPath();
      addLine(ctx, a.x, a.y, b.x, b.y, 2);
      addDot(ctx, b.x, b.y, 1);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawBullet(b: Bullet) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.shrapnel ? 1.5 : 2, 0, Math.PI * 2);
    ctx.fillStyle = b.owner.color;
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
