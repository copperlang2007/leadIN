import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

export default defineConfig({
  plugins: [react(), tailwindcss(), metaImagesPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split heavy 3rd-party libraries into their own long-lived
        // chunks. After PR #89 routes are already lazy-loaded; this
        // closes out the perf story by also splitting the vendor
        // surface so the main bundle isn't 500+ KB of React + Radix
        // on every cold load. Each group is cached independently
        // — a release that only touches React or only touches our
        // app code doesn't invalidate the other.
        //
        // Vite 8 bundles rolldown, which does not accept Rollup's
        // object form of `manualChunks` (name -> module list). The
        // equivalent is `codeSplitting.groups`, which matches on
        // module id instead. Dependencies of a captured module are
        // pulled into the same group by default
        // (`includeDependenciesRecursively`), which preserves the
        // old object-form semantics.
        codeSplitting: {
          groups: [
            // React core + scheduler. Almost never changes. ~140 KB.
            // Highest priority so React itself never gets absorbed
            // into a consumer's chunk.
            {
              name: "react-core",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            // tanstack-query — data layer. Independent release cadence.
            {
              name: "react-query",
              test: /node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
              priority: 20,
            },
            // wouter — router. ~5 KB but cleanly isolatable.
            {
              name: "router",
              test: /node_modules[\\/]wouter[\\/]/,
              priority: 20,
            },
            // Radix UI primitives — the heaviest single dependency
            // after React. ~250 KB. Bundled together because they
            // share internal utilities and splitting per-primitive
            // would inflate aggregate transfer size.
            {
              name: "radix-ui",
              test: /node_modules[\\/]@radix-ui[\\/]/,
              priority: 20,
            },
            // Charts (recharts) — only loaded on analytics. Lazy
            // routes already do most of the work but split-marking it
            // ensures it stays in its own chunk if a future eager
            // import happens.
            {
              name: "charts",
              test: /node_modules[\\/]recharts[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
