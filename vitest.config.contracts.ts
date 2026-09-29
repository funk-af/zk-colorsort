import typescript from "@rollup/plugin-typescript";
import { puyaTsTransformer } from "@algorandfoundation/algorand-typescript-testing/vitest-transformer";
import { defineConfig } from "vitest/config";

// The puya-ts test transformer rewrites `.algo.ts` contracts and
// `.algo.test.ts` specs so AVM semantics (uint64 comparisons, box typing,
// integer arithmetic) hold when the contract runs in Node.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
  // Vite 8 transforms TypeScript with oxc; the Algorand TypeScript contracts
  // use legacy (experimental) decorators such as @readonly.
  oxc: {
    decorator: {
      legacy: true,
    },
  },
  plugins: [
    typescript({
      tsconfig: "./tsconfig.contracts.json",
      transformers: {
        before: [puyaTsTransformer],
      },
    }),
  ],
  resolve: {
    alias: {
      "@algorandfoundation/algorand-typescript":
        "@algorandfoundation/algorand-typescript-testing/internal",
      "@algorandfoundation/algorand-typescript/op":
        "@algorandfoundation/algorand-typescript-testing/internal/op",
    },
  },
});
