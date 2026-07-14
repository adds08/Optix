const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// pnpm workspace support: tell Metro to also look in the root node_modules
const root = path.resolve(__dirname, "../..");
config.watchFolders = [root];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(root, "node_modules"),
];

// Fix: pnpm hoists ESM-only packages whose `exports` field breaks Metro.
// We hardcode paths to these packages. Add new packages here if needed.
const ESM_ONLY_PACKAGES = {
  "copy-anything": path.join(root, "node_modules", "copy-anything", "dist", "index.js"),
  "is-what": path.join(root, "node_modules", "is-what", "dist", "index.js"),
};

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const hardcodedPath = ESM_ONLY_PACKAGES[moduleName];
  if (hardcodedPath) {
    return {
      filePath: hardcodedPath,
      type: "sourceFile",
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
