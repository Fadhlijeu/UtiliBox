import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        location: "readonly",
        history: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        atob: "readonly",
        btoa: "readonly",
        FileReader: "readonly",
        Blob: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        crypto: "readonly",
        FormData: "readonly",
        AbortController: "readonly",
        Worker: "readonly",
        globalThis: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
);