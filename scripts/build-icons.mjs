// Draws the app icon (a few course cells, blue start, green goal and a ship
// heading for it) and writes the PNGs phones put on the home screen, plus
// src/app/favicon.ico for the browser tab. Run with `npm run build:icons`.
import sharp from "sharp";
import { writeFile } from "fs/promises";

// Cell colors match COURSE_COLORS in src/game/course.ts.
const cells = [
  ["#b9b9bd", "40,40 200,40 160,170 40,190"],
  ["#78787d", "200,40 330,40 290,150 160,170"],
  ["#2ed573", "330,40 472,40 472,200 290,150"],
  ["#78787d", "40,190 160,170 210,300 40,330"],
  ["#38383c", "160,170 290,150 350,320 210,300"],
  ["#78787d", "290,150 472,200 472,340 350,320"],
  ["#2f6fdf", "40,330 210,300 170,472 40,472"],
  ["#b9b9bd", "210,300 350,320 320,472 170,472"],
  ["#38383c", "350,320 472,340 472,472 320,472"],
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000"/>
  ${cells.map(([fill, points]) => `<polygon points="${points}" fill="${fill}" stroke="#000" stroke-width="10" stroke-linejoin="round"/>`).join("\n  ")}
  <path d="M115 410 Q150 300 225 272" fill="none" stroke="#ffa502" stroke-width="14" stroke-linecap="round" stroke-dasharray="1 26" opacity="0.8"/>
  <polygon transform="translate(262 250) rotate(-38) scale(1.3)" points="62,0 -40,-40 -18,0 -40,40" fill="#ffa502" stroke="#000" stroke-width="8" stroke-linejoin="round"/>
</svg>`;

const png = (size) => sharp(Buffer.from(svg), { density: 72 * (size / 512) * 4 }).resize(size, size).png().toBuffer();

for (const [size, file] of [[180, "apple-touch-icon.png"], [192, "icon-192.png"], [512, "icon-512.png"]]) {
  await writeFile(`public/${file}`, await png(size));
}

// An .ico is a small header and directory followed by the images, here PNGs.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...images]));
