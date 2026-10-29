# Polyracer

A couch party game. The TV shows a field of Voronoi polygons and the phones are the controllers. On level 1 every polygon stands still. From level 2 the light grey cells bounce around inside the frame, and the cells around them change shape as they pass. Everyone starts level 1 in the middle of the map. Reach the green cell in the black frame around the edge before the clock runs out.

- **Light grey** cells are fast, **grey** is normal speed and **dark grey** is very slow. Most cells are grey. The dark and light grey ones are scattered at random.
- From level 4, **red** cells bounce around too. Fly into one and you die, just like being shot.
- A ship that dies throws 8 pieces of shrapnel, each in its own direction. Shrapnel kills like a bullet, so one death can set off a chain.
- The **blue** start cell and the **green** goal are safe: you can't shoot from inside them, and bullets and shrapnel fly straight through ships in there.
- Each ship leaves a trail of where it has flown. The trail fades after a few seconds.
- **Black** cells make up the frame. You can fly into them, but only at a crawl. Bullets fly straight through. One of them is the **green** goal. The screen edge is the only real wall.
- From level 2, black cells spread onto the field too, a few more each level. The number of cells never changes, only how many of them are black.
- The level ends when every ship still alive is in the green cell, or when the clock runs out. Anyone who hasn't made it by then is out. Until then you can fly out of the green cell again, into the black frame too.
- Once the level is over, the ships in the green cell can steer around inside it and bounce off all its walls.
- The next level starts in that cell. It turns **blue** and a new green cell appears somewhere else. You keep bouncing around in it through the countdown, and when the race starts its walls open again.
- The screen edge is the only wall that always bounces you, during the race too.
- Ships always move forward. They turn instantly, with no drift.
- Get to a green cell in time without being shot and you're through to the next level. Anyone else is out.
- If the level ends because someone was hit, the banner waits 2 seconds so the blast stays in view.
- If nobody makes it, the same players replay from the same blue cell with a new goal. When only one player is left, that player wins.
- The clock gets tighter, the dark grey and black ground spreads and more red cells appear with each level.

Controls are two buttons:

- Hold **◀** or **▶** to turn.
- Press **both** to stop dead and fire one shot straight ahead. You stay stopped while you hold both. After a shot it takes a moment to get back up to full speed.

## Run

```bash
npm install
npm run dev          # development, with hot reload
# or
npm run build && npm start
```

1. Open `http://localhost:3000/` on the computer connected to the TV (fullscreen it with F11).
2. Players scan the QR code with their phones. The phones must be on the same Wi-Fi.
3. Everyone flies around the warm-up arena while people join. Anyone presses **START** to begin.

No phone handy? Press **K** on the TV to add a ship flown with ← →. Press **J** to add one flown with A D. Press both keys together to shoot. **Enter** starts the match.

If the QR code shows the wrong address (VM, Docker, several network cards), set it yourself:

```bash
PUBLIC_URL=http://192.168.1.50:3000 npm run dev
```

## Settings

Join with the name **ingo** and a ⚙ button appears on the phone. It opens sliders for ground speeds, ship turn rate and size, the trail, bullets, how long it takes to get back to full speed after a shot, shrapnel, the number of polygons, how fast the light grey and red cells move, the polygon dots (show them, and give them new positions at the start of every level) and the time limit. Tap a slider's number to type the value on the keypad instead. Changes apply right away. A new number of polygons takes effect in the lobby.

- **Default** goes back to the saved default.
- **Set default** makes the current settings the new default.
- **Factory** goes back to the values in `src/game/settings.ts`.

The server saves the settings in `settings.json`, so both TV pages share them and they survive restarts.

## How it works

- `server.js` runs Next.js and relays WebSocket messages on `/ws`. It runs no game logic.
- `src/game/game.ts` is the game: ships, bullets, levels, elimination and rendering. The TV is the authority.
- `src/game/course.ts` is the Voronoi map: generation, the bouncing sites, terrain types, the frame and the start and goal cells.
- `src/app/Canvas/Canvas.tsx` mounts the game and draws the lobby and results screens.
- `public/controller.html` (served at `/play`) is the phone pad. It sends `{l, r}` (left/right held) when they change.
- A phone keeps its player id in `localStorage`. After a Wi-Fi blip it rejoins as the same ship.

Tuning constants live at the top of `game.ts` (time limit, turn rate, bullets) and `course.ts` (cell spacing, how much of each terrain there is per level, when red cells arrive, bounce speeds, and the speed of each terrain in `CELL_SPEED`).
