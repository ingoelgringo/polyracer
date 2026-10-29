import { settings } from "./settings";

// Background music on the TV, looping public/Polyracer.mp3. Turned on/off and
// set louder or quieter from the admin phone's settings menu.
// Browsers won't start sound before someone has pressed something on the page,
// so if the first play is refused we try again on the next key, click or touch.
// No file yet just means silence.

const SRC = "/Polyracer.mp3";
const UNLOCK_EVENTS = ["keydown", "pointerdown", "touchstart", "click"];

export class Music {
  private audio: HTMLAudioElement | null = null;
  private waiting = false; // listening for a key press to start

  start() {
    this.audio = new Audio(SRC);
    this.audio.loop = true;
    this.apply();
  }

  stop() {
    this.audio?.pause();
    this.audio = null;
    this.stopWaiting();
  }

  // Call whenever the settings change.
  apply() {
    const a = this.audio;
    if (!a) return;
    a.volume = Math.min(1, Math.max(0, settings.musicVolume / 100));
    if (!settings.music || settings.musicVolume <= 0) {
      a.pause();
      this.stopWaiting();
    } else if (a.paused) this.play();
  }

  private play() {
    const a = this.audio;
    if (!a) return;
    // Old TV browsers return nothing from play(), newer ones a promise that fails without a key press.
    const p = a.play() as Promise<void> | undefined;
    if (p && p.catch) p.catch(() => this.wait());
  }

  private wait() {
    if (this.waiting) return;
    this.waiting = true;
    for (const e of UNLOCK_EVENTS) addEventListener(e, this.unlock, true);
  }

  private stopWaiting() {
    if (!this.waiting) return;
    this.waiting = false;
    for (const e of UNLOCK_EVENTS) removeEventListener(e, this.unlock, true);
  }

  private unlock = () => {
    this.stopWaiting();
    this.apply();
  };
}
