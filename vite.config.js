import { defineConfig } from "vite";

export default defineConfig({
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