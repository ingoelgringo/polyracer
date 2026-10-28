import { useRef, useEffect, useState } from "react";
import { Game, UiState } from "../../game/game";
import styles from "./Canvas.module.css";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ui, setUi] = useState<UiState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(canvas, setUi);
    game.start();
    return () => game.stop(); // stop the loop and socket if the component unmounts
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} />

      {ui?.phase === "lobby" && (
        <div className={styles.overlay}>
          <div className={styles.card}>
            <h1>POLY <span>DRIFT</span></h1>
            <p className={styles.sub}>Grab your phone. Scan to join.</p>
            <div className={styles.join}>
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element -- QR is a data URL */}
                {ui.qr && <img className={styles.qr} src={ui.qr} alt="QR code to join" />}
                <div className={styles.url}>{ui.joinUrl || "…"}</div>
              </div>
              <div className={styles.side}>
                <h2>Pilots</h2>
                <ul className={styles.players}>
                  {ui.players.length === 0 && <li className={styles.empty}>Nobody yet</li>}
                  {ui.players.map((p) => (
                    <li key={p.id}><span className={styles.dot} style={{ background: p.color }} />{p.name}</li>
                  ))}
                </ul>
                <div className={styles.hint}>
                  Everyone starts in the middle. Reach a <b style={{ color: "#2ed573" }}>green</b> cell before the clock runs out.<br />
                  Light grey is fast, grey is normal, dark grey is slow, black is a crawl.<br />
                  Hold one button to turn. Press <b>both</b> to stop and shoot.<br />
                  Miss the clock or get shot and you&apos;re out. Last player left wins.<br />
                  Press <b>START</b> on any phone (or <kbd>Enter</kbd> here).<br />
                  No phone? <kbd>K</kbd> joins with ← →, <kbd>J</kbd> joins with A D.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {ui?.phase === "results" && (
        <div className={styles.overlay}>
          <div className={styles.card}>
            {ui.soloLevels !== null ? (
              <>
                <h1>YOU CLEARED</h1>
                <p className={styles.big}>{plural(ui.soloLevels, "level")}</p>
                <p className={styles.sub}>Bring a friend — someone has to dodge your bullets.</p>
              </>
            ) : (
              <>
                <h1><span>{ui.matchWinner}</span> WINS</h1>
                <ol className={styles.results}>
                  {[...ui.players].sort((a, b) => b.levels - a.levels || b.kills - a.kills).map((p) => (
                    <li key={p.id}>
                      <span className={styles.dot} style={{ background: p.color }} />
                      {p.name}
                      <span className={styles.stat}>{plural(p.levels, "level")} · {plural(p.kills, "hit")}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <div className={styles.hint}>Back to the lobby in a moment…</div>
          </div>
        </div>
      )}

      {ui?.banner && <div className={styles.banner}>{ui.banner}</div>}
    </>
  );
}
