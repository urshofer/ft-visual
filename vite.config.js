import { defineConfig } from "vite";
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Copy assets that are referenced as plain URL strings at runtime (OBJ models
// loaded by main.js and the ./bg/bg.webp background texture). Vite's bundler
// never sees these paths, so it won't emit them into dist on its own.
function copyRuntimeAssets() {
  const root = process.cwd();
  return {
    name: "copy-runtime-assets",
    apply: "build",
    // closeBundle runs after dist is (re)written, so copies survive emptyOutDir.
    closeBundle() {
      // Active models = the non-underscore .obj files in src/models.
      const modelsSrc = resolve(root, "src/models");
      const modelsOut = resolve(root, "dist/src/models");
      mkdirSync(modelsOut, { recursive: true });
      for (const file of readdirSync(modelsSrc)) {
        if (file.endsWith(".obj") && !file.startsWith("_")) {
          cpSync(resolve(modelsSrc, file), resolve(modelsOut, file));
        }
      }

      // Background texture loaded via loader.load("./bg/bg.webp", ...).
      mkdirSync(resolve(root, "dist/bg"), { recursive: true });
      cpSync(resolve(root, "bg/bg.webp"), resolve(root, "dist/bg/bg.webp"));
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (GitHub Pages
  // serves this project at /ft-visual/, not the domain root).
  base: "./",
  plugins: [copyRuntimeAssets()],
  server: {
    open: true,
    watch: {
      usePolling: false
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2020"
    }
  }
});
