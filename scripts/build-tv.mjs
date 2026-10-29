// Builds public/tv.js, the TV page for old smart TV browsers (see src/tv/tv.ts).
// esbuild bundles the TypeScript, then SWC lowers it to what Chrome 47 can run:
// no destructuring, no let/const outside strict mode, no async.
import { build } from "esbuild";
import { transform } from "@swc/core";
import { writeFile } from "fs/promises";

const { outputFiles } = await build({
  entryPoints: ["src/tv/tv.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  write: false,
});

const { code } = await transform(outputFiles[0].text, {
  isModule: false,
  env: { targets: "chrome 47" },
  minify: true,
  jsc: { minify: { compress: true, mangle: true } },
});

await writeFile("public/tv.js", code);
console.log(`Built public/tv.js (${(code.length / 1024).toFixed(0)} kB)`);
