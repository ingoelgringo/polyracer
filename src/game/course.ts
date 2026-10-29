import { Delaunay } from "d3-delaunay";
import { addOutline } from "./draw";
import { settings } from "./settings";

// Logical playfield size. The canvas is scaled to fit this on any screen.
export const W = 1600;
export const H = 900;

const JITTER = 0.75; // how far sites stray from their grid position (share of the grid spacing)
const FRAME_INSET = 50; // frame sites sit on a ring this far in from the screen edge
const FRAME_STEP = 120; // distance between frame sites along that ring
// Inner sites bounce off a box this far inside the frame ring, so no inner cell
// ever reaches the screen edge and the black frame stays closed.
const FRAME_GAP = 55;
// Moving light grey (from level 2) and red sites bounce around at between this share of
// their speed setting and the full setting.
const MOVE_MIN_SHARE = 0.4;
const FAST_SHARE = 0.12; // share of inner cells that are light grey
const FAST_MOVING_SHARE = 0.5; // share of the light grey cells that move; the rest stay put
const SLOW_SHARE_START = 0.1; // share of inner cells that are dark grey on level 1…
const SLOW_SHARE_STEP = 0.04; // …growing this much each level…
const SLOW_SHARE_MAX = 0.45; // …up to this
const BLACK_LEVEL = 2; // first level with black cells out on the field…
const BLACK_SHARE_START = 0.05; // …this share of the inner cells on that level…
const BLACK_SHARE_STEP = 0.03; // …growing this much each level…
const BLACK_SHARE_MAX = 0.25; // …up to this
const BLACK_KEEPOUT = 150; // px, inner black cells stay at least this far from the start
const DANGER_LEVEL = 4; // first level with red cells
const DANGER_START = 2; // red cells on that level, one more each level after
const DANGER_COUNT_MAX = 8;
const DANGER_KEEPOUT = 300; // px, red cells start at least this far from the start
const GOAL_MIN_DIST = 700; // px from the start to the goal
const CORNER_KEEPOUT = 140; // goals are never this close to a corner

// black: the frame, plus more cells on the field each level. Ships crawl through it,
// bullets fly straight through. goal: green, reach it to clear the level.
// start: blue, the cell this level starts in (last level's goal).
// fast / normal / slow: light grey / grey / dark grey ground.
// danger: red, kills a ship that flies into it.
export type Cell = "black" | "goal" | "start" | "fast" | "normal" | "slow" | "danger";

// How fast ships fly over each kind of ground (see settings.ts).
export function cellSpeed(cell: Cell) {
  switch (cell) {
    case "fast": return settings.speedFast;
    case "slow": return settings.speedSlow;
    case "black": return settings.speedBlack;
    default: return settings.speedNormal;
  }
}

const CELL_FILL: Record<Cell, string> = {
  black: "#000",
  goal: "#2ed573",
  start: "#2f6fdf",
  fast: "#b9b9bd",
  normal: "#78787d",
  slow: "#38383c",
  danger: "#e8413c",
};

const LO_X = FRAME_INSET + FRAME_GAP, HI_X = W - LO_X;
const LO_Y = FRAME_INSET + FRAME_GAP, HI_Y = H - LO_Y;

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const heading = (min: number, max: number): [number, number] => {
  const a = Math.random() * Math.PI * 2, v = min + Math.random() * (max - min);
  return [Math.cos(a) * v, Math.sin(a) * v];
};

// Sites on a ring around the edge. They never move, so the frame's outer edge stays put.
const frameRing = () => {
  const ring: [number, number][] = [];
  const side = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / FRAME_STEP);
    for (let k = 0; k < n; k++) ring.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  };
  const a = FRAME_INSET, r = W - FRAME_INSET, b = H - FRAME_INSET;
  side(a, a, r, a);
  side(r, a, r, b);
  side(r, b, a, b);
  side(a, b, a, a);
  return ring;
};

export class Course {
  private cells: Cell[] = [];
  private paths: Path2D[] = [];
  private polygons: number[][][] = [];
  private delaunay: Delaunay<Float64Array> | null = null;
  private vel: [number, number][] = [];
  private moving: number[] = []; // sites that bounce around this level
  private frameCount = 0; // sites [0, frameCount) are the fixed frame
  private hint = 0;
  goal = -1; // site index of the green cell
  start = -1; // site index of the blue cell, -1 = start in the middle
  builtCells = 0; // settings.cells when the sites were made

  // Fresh set of sites: the fixed frame plus a jittered grid of inner sites.
  // The grid spacing is picked so there are about `cells` inner sites. The frame
  // ring always comes out the same, so frame cells keep their indices.
  build(cells = settings.cells) {
    const sites = frameRing();
    this.frameCount = sites.length;
    const spacing = Math.sqrt(((HI_X - LO_X) * (HI_Y - LO_Y)) / cells);
    this.builtCells = cells;
    for (let y = LO_Y + spacing / 2; y < HI_Y; y += spacing) {
      for (let x = LO_X + spacing / 2; x < HI_X; x += spacing) {
        sites.push([
          Math.min(HI_X, Math.max(LO_X, x + (Math.random() - 0.5) * spacing * JITTER)),
          Math.min(HI_Y, Math.max(LO_Y, y + (Math.random() - 0.5) * spacing * JITTER)),
        ]);
      }
    }
    this.delaunay = Delaunay.from(sites);
    this.vel = sites.map(() => [0, 0]);
    this.moving = [];
    this.hint = 0;
    this.goal = this.start = -1;
    this.rebuildPaths();
  }

  // Lays out a level on the current sites. `start` is the blue cell (or -1 for the
  // middle); a new green cell is picked far from it. Mostly grey with random dark and
  // light grey cells; the dark grey spreads each level. Level 1 stands still; after
  // that half the light grey cells bounce around, and from DANGER_LEVEL red ones join them.
  setup(level: number, start: number) {
    const n = this.siteCount();
    const pos = (i: number) => this.site(i);
    const from = start >= 0 ? pos(start) : { x: W / 2, y: H / 2 };

    this.cells = Array.from({ length: n }, (_, i) => (i < this.frameCount ? "black" : "normal"));
    this.vel = Array.from({ length: n }, () => [0, 0]);
    this.moving = [];
    const move = (i: number, max: number) => {
      this.vel[i] = heading(max * MOVE_MIN_SHARE, max);
      this.moving.push(i);
    };

    // Red first, away from the start so nobody spawns inside one.
    const inner = shuffle(Array.from({ length: n - this.frameCount }, (_, k) => k + this.frameCount));
    const dangers = level < DANGER_LEVEL ? 0 : Math.min(DANGER_COUNT_MAX, DANGER_START + level - DANGER_LEVEL);
    inner
      .filter((i) => Math.hypot(pos(i).x - from.x, pos(i).y - from.y) >= DANGER_KEEPOUT)
      .slice(0, dangers)
      .forEach((i) => {
        this.cells[i] = "danger";
        move(i, settings.moveDanger);
      });

    // Then black, spreading over the field level by level. The number of cells never
    // changes, only how many of them are black.
    const blacks = level < BLACK_LEVEL ? 0 : Math.round(
      (n - this.frameCount) * Math.min(BLACK_SHARE_MAX, BLACK_SHARE_START + BLACK_SHARE_STEP * (level - BLACK_LEVEL)),
    );
    inner
      .filter((i) => this.cells[i] === "normal" && Math.hypot(pos(i).x - from.x, pos(i).y - from.y) >= BLACK_KEEPOUT)
      .slice(0, blacks)
      .forEach((i) => (this.cells[i] = "black"));

    const rest = inner.filter((i) => this.cells[i] === "normal");
    const slow = Math.round(rest.length * Math.min(SLOW_SHARE_MAX, SLOW_SHARE_START + SLOW_SHARE_STEP * (level - 1)));
    const fast = Math.round(rest.length * FAST_SHARE);
    const fastMoving = Math.round(fast * FAST_MOVING_SHARE);
    rest.forEach((i, k) => {
      if (k < slow) this.cells[i] = "slow";
      else if (k < slow + fast) {
        this.cells[i] = "fast";
        if (level > 1 && k < slow + fastMoving) move(i, settings.moveFast);
      }
    });

    this.start = start;
    if (start >= 0) this.cells[start] = "start";

    // One green cell in the frame, away from the corners and far from the start.
    const corner = ({ x, y }: { x: number; y: number }) =>
      Math.min(x, W - x) < CORNER_KEEPOUT && Math.min(y, H - y) < CORNER_KEEPOUT;
    const candidates = shuffle(Array.from({ length: this.frameCount }, (_, i) => i))
      .filter((i) => i !== start && !corner(pos(i)));
    const far = candidates.filter((i) => Math.hypot(pos(i).x - from.x, pos(i).y - from.y) >= GOAL_MIN_DIST);
    this.goal = far[0] ?? candidates[0];
    this.cells[this.goal] = "goal";
  }

  // Moving sites travel in straight lines and bounce off the frame.
  step(dt: number) {
    if (!this.delaunay || !this.moving.length) return;
    const pts = this.delaunay.points as Float64Array;
    for (const i of this.moving) {
      const v = this.vel[i];
      let x = pts[2 * i] + v[0] * dt, y = pts[2 * i + 1] + v[1] * dt;
      if (x < LO_X || x > HI_X) { v[0] = -v[0]; x = Math.min(HI_X, Math.max(LO_X, x)); }
      if (y < LO_Y || y > HI_Y) { v[1] = -v[1]; y = Math.min(HI_Y, Math.max(LO_Y, y)); }
      pts[2 * i] = x;
      pts[2 * i + 1] = y;
    }
    this.delaunay.update();
    this.rebuildPaths();
  }

  private rebuildPaths() {
    const voronoi = this.delaunay!.voronoi([0, 0, W, H]);
    this.polygons = Array.from({ length: this.siteCount() }, (_, i) => voronoi.cellPolygon(i) ?? []);
    this.paths = this.polygons.map((poly) => {
      const p = new Path2D();
      poly.forEach(([x, y], j) => (j ? p.lineTo(x, y) : p.moveTo(x, y)));
      p.closePath();
      return p;
    });
  }

  siteCount() {
    return this.delaunay ? this.delaunay.points.length / 2 : 0;
  }

  site(i: number) {
    const pts = this.delaunay!.points;
    return { x: pts[2 * i], y: pts[2 * i + 1] };
  }

  // A point is inside a cell when that cell's site is the nearest one.
  cellAt(x: number, y: number): Cell {
    if (this.isOutside(x, y) || !this.delaunay) return "black";
    this.hint = this.delaunay.find(x, y, this.hint);
    return this.cells[this.hint];
  }

  // The fixed ring of cells around the edge (start and goal are always among them).
  isFrame(i: number) {
    return i >= 0 && i < this.frameCount;
  }

  // Index of the site whose cell holds the point.
  siteAt(x: number, y: number) {
    if (!this.delaunay) return -1;
    this.hint = this.delaunay.find(x, y, this.hint);
    return this.hint;
  }

  // The screen edge is the only thing ships can't pass.
  isOutside(x: number, y: number) {
    return x < 0 || x > W || y < 0 || y > H;
  }

  draw(ctx: CanvasRenderingContext2D) {
    this.paths.forEach((path, i) => {
      ctx.fillStyle = CELL_FILL[this.cells[i]];
      ctx.fill(path);
    });
    // Each outline style is one path filled once, so shared edges don't double up.
    const outlines = (match: (cell: Cell) => boolean, width: number) => {
      ctx.beginPath();
      this.polygons.forEach((poly, i) => match(this.cells[i]) && addOutline(ctx, poly, width));
    };
    outlines((c) => c !== "black", 1.5);
    ctx.fillStyle = "rgba(20, 20, 24, 0.55)";
    ctx.fill();
    outlines((c) => c === "black", 1.5);
    ctx.fillStyle = "rgba(70, 70, 75, 0.8)";
    ctx.fill();

    // The sites the cells are computed from. Not in the frame or in black cells (start and goal included).
    if (!settings.showSites) return;
    ctx.beginPath();
    for (let i = 0; i < this.siteCount(); i++) {
      if (this.isFrame(i) || this.cells[i] === "black") continue;
      const { x, y } = this.site(i);
      ctx.moveTo(x + 1.5, y);
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fill();
  }
}
