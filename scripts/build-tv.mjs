// Builds public/tv.js, the TV page for old smart TV browsers (see src/tv/tv.ts).
// esbuild bundles the TypeScript, then SWC lowers it to what Chrome 47 can run:
// no destructuring, no let/const outside strict mode, no async.
// With --watch it keeps running and rebuilds whenever a source file changes
// (server.js starts it like that in dev).
import { context } from "esbuild";
import { transform } from "@swc/core";
import { writeFile } from "fs/promises";

const watch = process.argv.includes("--watch");

const lower = {
  name: "chrome47",
  setup(build) {
    build.onEnd(async ({ errors, outputFiles }) => {
      if (errors.length || !outputFiles?.length) return;
      const { code } = await transform(outputFiles[0].text, {
        isModule: false,
        env: { targets: "chrome 47" },
        minify: true,
        jsc: { minify: { compress: true, mangle: true } },
      });
      await writeFile("public/tv.js", code);
      console.log(`Built public/tv.js (${(code.length / 1024).toFixed(0)} kB)`);
    });
  },
};

const ctx = await context({
  entryPoints: ["src/tv/tv.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  write: false,
  plugins: [lower],
});

if (watch) await ctx.watch();
else {
  const { errors } = await ctx.rebuild();
  await ctx.dispose();
  if (errors.length) process.exit(1);
}
