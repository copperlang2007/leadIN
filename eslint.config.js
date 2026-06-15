import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

// Minimal lint set — fail the build on obviously-broken code (unused imports,
// no-undef, missing hook deps) without policing style. Style is enforced
// by the formatter elsewhere.
export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "migrations/**",
      "**/*.test.ts",
      "client/src/components/ui/**",
      // Worktrees are short-lived agent sandboxes that mirror real source.
      // Linting them double-counts warnings against the same files.
      ".claude/worktrees/**",
      // Playwright artifacts.
      "test-results/**",
      "playwright-report/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        localStorage: "readonly",
        crypto: "readonly",
        Buffer: "readonly",
        process: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        HTMLElement: "readonly",
        MouseEvent: "readonly",
        Event: "readonly",
        EventTarget: "readonly",
        RequestInfo: "readonly",
        RequestInit: "readonly",
        history: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        global: "readonly",
        BufferEncoding: "readonly",
        NodeJS: "readonly",
        WebSocket: "readonly",
        React: "readonly",
        Express: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
