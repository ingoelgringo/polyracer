// The TV page for old smart TV browsers (Samsung 2017 runs Chrome 47), which
// can't run the Next.js page. Same Game, but the lobby and results overlays are
// plain DOM instead of React. scripts/build-tv.mjs compiles this to public/tv.js,
// and the main page redirects here when the browser is too old.
import { Game, UiState } from "../game/game";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Player names come from phones, so never put them into HTML unescaped.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const dot = (color: string) => `<span class="dot" style="background:${esc(color)}"></span>`;

function lobby(ui: UiState) {
  const players = ui.players.length
    ? ui.players.map((p) => `<li>${dot(p.color)}${esc(p.name)}</li>`).join("")
    : `<li class="empty">Nobody yet</li>`;
  return `<div class="card">
    <h1>POLY <span>RACER</span></h1>
    <p class="sub">Grab your phone. Scan to join.</p>
    <div class="join">
      <div>
        ${ui.qr ? `<img class="qr" src="${esc(ui.qr)}" alt="QR code to join">` : ""}
        <div class="url">${esc(ui.joinUrl || "…")}</div>
      </div>
      <div class="side">
        <h2>Pilots</h2>
        <ul class="players">${players}</ul>
        <div class="hint">
          Everyone starts in the middle. Reach a <b style="color:#2ed573">green</b> cell before the clock runs out.<br>
          Light grey is fast, grey is normal, dark grey is slow, black is a crawl.<br>
          Hold one button to turn. Press <b>both</b> to stop and shoot.<br>
          Miss the clock or get shot and you&apos;re out. Last player left wins.<br>
          Press <b>START</b> on any phone.
        </div>
      </div>
    </div>
  </div>`;
}

function results(ui: UiState) {
  const body =
    ui.soloLevels !== null
      ? `<h1>YOU CLEARED</h1>
        <p class="big">${plural(ui.soloLevels, "level")}</p>
        <p class="sub">Bring a friend — someone has to dodge your bullets.</p>`
      : `<h1><span>${esc(ui.matchWinner || "")}</span> WINS</h1>
        <ol class="results">${[...ui.players]
          .sort((a, b) => b.levels - a.levels || b.kills - a.kills)
          .map((p) => `<li>${dot(p.color)}${esc(p.name)}<span class="stat">${plural(p.levels, "level")} · ${plural(p.kills, "hit")}</span></li>`)
          .join("")}</ol>`;
  return `<div class="card">${body}<div class="hint">Back to the lobby in a moment…</div></div>`;
}

const overlay = document.getElementById("overlay")!;
const banner = document.getElementById("banner")!;
let shown = ""; // only touch the DOM when the overlay actually changes

function render(ui: UiState) {
  const html = ui.phase === "lobby" ? lobby(ui) : ui.phase === "results" ? results(ui) : "";
  if (html !== shown) {
    overlay.innerHTML = shown = html;
    overlay.style.display = html ? "" : "none";
  }
  banner.textContent = ui.banner || "";
  banner.style.display = ui.banner ? "" : "none";
}

new Game(document.getElementById("canvas") as HTMLCanvasElement, render).start();

// Chrome 47 only has the prefixed fullscreen API, no pointer events and no
// KeyboardEvent.key, so this is the old-school version of the main page's code.
const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };

function enter() {
  if (doc.fullscreenElement || doc.webkitFullscreenElement) return;
  try {
    if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
  } catch {}
}

addEventListener("mousedown", enter);
addEventListener("keydown", (e) => {
  if (e.keyCode === 27) return; // Esc
  if (e.keyCode === 70 && (doc.fullscreenElement || doc.webkitFullscreenElement)) {
    if (doc.exitFullscreen) doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  } else enter();
});
