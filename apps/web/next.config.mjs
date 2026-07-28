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
  transpilePackages: ["@stinventory/api-contracts"],
};
export default nextConfig;
