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

/* The seed ships too. Reference data — tenant, roles, permissions — has to be
   creatable on a fresh production database, and the alternative is a human
   running SQL by hand on day one. The demo *accounts* it also creates are
   guarded separately inside seed.ts by SEED_ALLOW_PRODUCTION. */
await build({
  entryPoints: ["src/migrate.ts", "src/seed.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  plugins: [externalizeNodeModules],
  logLevel: "info",
});
