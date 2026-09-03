import base from "./base.mjs";
import globals from "globals";

export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    /*
      Native `<select>` renders the OS chrome and has no styling hooks, so the
      app banned it — `.claude/rules/web.md` (use `SearchSelect`/`EntityPicker`
      instead). The ban was prose until 2026-09-03; this is the same policy
      enforced, so a new form cannot reintroduce it by accident. `import.ai`
      and the charts still call the `Select`/`DropdownMenu` components, which
      are not `select` elements and are untouched by this rule.
    */
    files: ["**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'JSXElement[openingElement.name.name="select"]',
          message:
            "Native <select> is banned — use SearchSelect or EntityPicker (see .claude/rules/web.md).",
        },
      ],
    },
  },
];
