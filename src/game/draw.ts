// Old TV browsers (Samsung 2017, Chrome 47) fill canvas shapes but draw no
// strokes, so every line in the game is a filled quad instead of ctx.stroke().
// Both helpers add clockwise subpaths to the current path, so overlapping pieces
// fill as one shape: call beginPath() first and fill() after.

export function addLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (!len) return;
  const nx = ((y2 - y1) / len) * (width / 2), ny = (-(x2 - x1) / len) * (width / 2);
  ctx.moveTo(x1 + nx, y1 + ny);
  ctx.lineTo(x2 + nx, y2 + ny);
  ctx.lineTo(x2 - nx, y2 - ny);
  ctx.lineTo(x1 - nx, y1 - ny);
  ctx.closePath();
}

export function addDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

// The outline of a closed polygon, with round corners so the joins have no gaps.
export function addOutline(ctx: CanvasRenderingContext2D, pts: number[][], width: number) {
  pts.forEach(([x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length];
    addLine(ctx, x, y, nx, ny, width);
    addDot(ctx, x, y, width / 2);
  });
}
