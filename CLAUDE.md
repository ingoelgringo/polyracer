# Polyracer

Couch party game: the TV shows a Voronoi course, phones are two-button controllers.
README.md has the rules, how to run it and an overview of the files. Read it first.

## Working with the user

- The user writes in Swedish. Answer in Swedish. Code, comments, commit messages and README stay in English.
- Don't commit or push until asked.
- When game rules or the settings menu change, update README.md to match.

## Commands

- `npm run dev`: builds `public/tv.js`, then starts `server.js` with hot reload on port 3000.
- `npm run lint` and `npx tsc --noEmit`: run both after changes. There are no tests.
- `npm run build:tv`: rebuilds `public/tv.js` on its own. It is generated and gitignored, so never edit it.
- `npm run build:icons`: redraws the app icon from the SVG in `scripts/build-icons.mjs`. It writes
  `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png` and `src/app/favicon.ico`.
  Edit the script, not the PNGs.

## Things to keep in mind

- There are two TV pages. `/` is Next.js and `/tv` (`public/tv.html` + `src/tv/tv.ts`) is for old smart TVs
  running Chrome 47. Both run the same `Game` from `src/game/game.ts`. A change to the lobby or results screens
  has to be made in `src/app/Canvas/` and in `src/tv/tv.ts`. `public/tv.html` CSS can't use inset, flex gap or grid.
- `public/controller.html` (served at `/play`) is a single static file with inline JS. It isn't bundled, so keep it plain.
- The TV is the authority for the game and settings. `server.js` only relays WebSocket messages and saves
  `settings.json` (gitignored).
- Settings that can be changed live from the phone (name `ingo`) are defined in `src/game/settings.ts`.
  Other tuning constants are at the top of `game.ts` and `course.ts`.
- Cell colors are in `src/game/course.ts` and player colors are `COLORS` in `src/game/game.ts`.
