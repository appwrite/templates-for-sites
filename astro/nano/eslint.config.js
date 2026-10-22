import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import astro from "eslint-plugin-astro";
import globals from "globals";
import typescript from "typescript-eslint";

export default defineConfig(
  {
    ignores: [".astro/", ".vscode/", "dist/", "node_modules/", "public/"],
  },
  js.configs.recommended,
  typescript.configs.recommended,
  astro.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      semi: ["error", "always"],
      quotes: ["error", "double", { "allowTemplateLiterals": true }],
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
);
