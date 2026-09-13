import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  plugins: [
    react(),
    // Old Android TV browsers (Xiaomi TV, Mi Box) ship a WebView that cannot run
    // modern JavaScript. The legacy plugin emits a second, older bundle for them.
    legacy({
      targets: ["chrome >= 49", "android >= 5", "safari >= 10"],
      modernPolyfills: true,
    }),
  ],
  build: {
    target: ["es2015", "chrome58", "safari11"],
  },
});
