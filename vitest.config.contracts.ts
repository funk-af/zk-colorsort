import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
  oxc: false,
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
      },
    },
  } as never,
  resolve: {
    alias: {
      "@algorandfoundation/algorand-typescript":
        "@algorandfoundation/algorand-typescript-testing/internal",
      "@algorandfoundation/algorand-typescript/op":
        "@algorandfoundation/algorand-typescript-testing/internal/op",
    },
  },
});
