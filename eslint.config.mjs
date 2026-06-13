import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    // Local Codex skill/cache folders occasionally appear as untracked
    // root-level scratch copies. They are not app source and may contain
    // CommonJS utility scripts that should not affect repository lint.
    "**/skills/.system/**",
  ]),
]);

export default eslintConfig;
