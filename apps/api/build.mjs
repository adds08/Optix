import { build } from "esbuild";

/*
  Why this exists instead of plain `tsc`.

  Every workspace package publishes its TypeScript source directly —
  `"main": "./src/index.ts"` — which is excellent for local development,
  because a change in packages/domain is live in the API with no build step.
  It also means `tsc && node dist/index.js` cannot work: node reaches the first
  `@stinventory/*` import and refuses a `.ts` file. The production build was
  broken from the first commit; nobody noticed because nothing had ever been
  run outside `tsx`.

  So: bundle the workspace packages into the output, and leave everything from
  node_modules external. Bundling node_modules too would produce a smaller
  image but breaks anything doing dynamic requires (pino transports, drizzle
  dialect loading), which fails at runtime rather than at build time — the
  worst place to find out.

  `tsc --noEmit` still runs as the typecheck script. esbuild does not typecheck.
*/

/*
  Externalise by shape, not by listing apps/api's own dependencies.

  A dependency list only covers direct deps, and the packages that break when
  bundled are usually transitive — `pino` arrives through @stinventory/logger,
  and it resolves its worker thread by path at runtime, so a bundled copy looks
  for `dist/lib/worker.js` and dies on first log. Anything that is not a
  workspace package or a relative import stays in node_modules where its own
  file layout still holds.
*/
const externalizeNodeModules = {
  name: "externalize-node-modules",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return null;
      if (args.path.startsWith(".") || args.path.startsWith("/")) return null;
      if (args.path.startsWith("@stinventory/")) return null;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  plugins: [externalizeNodeModules],
  /* ESM output in a CommonJS-ish dependency graph: a few packages reach for
     `require`, `__dirname` or `__filename`. Without this shim they throw on
     first use, at runtime, in production. */
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
});
