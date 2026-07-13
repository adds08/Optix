// Root flat config — apps and packages extend their own configs.
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/prototype/**",
    ],
  },
];
