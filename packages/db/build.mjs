import { build } from "esbuild";

/* Same reason as apps/api/build.mjs: the migrator has to run in the production
   image, where `tsx` is not installed and the .ts entrypoint cannot be loaded
   by node directly. */
/* Same externals rule as apps/api — see the note there. */
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

/* Migrations only. The seed was deleted on 2026-09-13 — it invented tool codes,
   dropped vehicles and named jobs "Job 24002", and a fixture that is
   approximately right is worse than an empty register. Tenant configuration
   (roles, tiers, categories, units) lives in src/tenant-config.ts and is
   imported as data, not run as a script. */
await build({
  entryPoints: ["src/migrate.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  plugins: [externalizeNodeModules],
  logLevel: "info",
});
