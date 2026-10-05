import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/salon-demo/" : "/",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
