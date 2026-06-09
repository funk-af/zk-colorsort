import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { fileURLToPath, URL } from "node:url";

const fsShimPath = fileURLToPath(new URL("./src/shims/fs.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      fs: fsShimPath,
      "node:fs": fsShimPath,
    },
  },
  plugins: [
    vue(),
    nodePolyfills({
      overrides: {
        fs: fsShimPath,
      },
      protocolImports: true,
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }
          if (
            id.includes("vue") ||
            id.includes("pinia") ||
            id.includes("vue-router")
          ) {
            return "vue-core";
          }

          if (
            id.includes("snarkjs") ||
            id.includes("circomlib") ||
            id.includes("snarkjs-algorand")
          ) {
            return "zk";
          }

          const modulePath = id.split("node_modules/").pop();
          if (!modulePath) {
            return "vendor";
          }

          const cleanPath = modulePath.startsWith(".pnpm/")
            ? (modulePath.split("node_modules/").pop() ?? modulePath)
            : modulePath;

          const segments = cleanPath.split("/");
          const packageName = segments[0].startsWith("@")
            ? `${segments[0]}-${segments[1]}`
            : segments[0];

          return `vendor-${packageName.replace(/[.@]/g, "_")}`;
        },
      },
    },
  },
  assetsInclude: ["**/*.zkey"],
});
