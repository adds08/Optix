/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /* Traces exactly the files the server needs into .next/standalone, so the
     production image does not carry a pnpm store or any source. Required by
     docker/Dockerfile.web. */
  output: "standalone",
  /* The workspace root, not apps/web — otherwise tracing misses the linked
     packages and the standalone build boots with missing modules. */
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  /* Both workspace packages the app imports at RUNTIME. They re-export across
     files with `.js` specifiers, which tsx resolves to the `.ts` source but the
     Next bundler will not unless the package is transpiled here.
     `@stinventory/types` needs no entry: it is a single file with nothing to
     re-export. `@stinventory/domain` joined on 2026-09-02 with the org chart,
     which calls `buildOrgForest` in the browser so the page and the server
     share one tested implementation of the tree. */
  transpilePackages: ["@stinventory/api-contracts", "@stinventory/domain"],
  /*
    `/admin/roles` moved to `/settings/roles` on 2026-09-14, and `/admin` no
    longer exists as a section at all.

    The screen had always been reached from the Settings menu — it was the only
    item there whose ADDRESS said something else, which is the split the client
    named ("roles for crew role is in settings, and not people").

    Permanent, and kept rather than left to 404: this is an administrator's
    screen, so the people most likely to have bookmarked it are exactly the
    ones who cannot do their job without it. `/admin` itself redirects too —
    it never rendered a page of its own, but a bookmark to a section root is
    likelier than one to a leaf.
  */
  async redirects() {
    return [
      { source: "/admin/roles", destination: "/settings/roles", permanent: true },
      { source: "/admin", destination: "/settings/roles", permanent: true },
    ];
  },
};
export default nextConfig;
