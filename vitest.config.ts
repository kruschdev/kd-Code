import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@krusch\/contracts$/,
        replacement: path.resolve(import.meta.dirname, "./packages/contracts/src/index.ts"),
      },
      {
        find: /^@krusch\/shared\/(.*)$/,
        replacement: path.resolve(import.meta.dirname, "./packages/shared/src/$1.ts"),
      },
      {
        find: /^@krusch\/client-runtime$/,
        replacement: path.resolve(import.meta.dirname, "./packages/client-runtime/src/index.ts"),
      },
    ],
  },
});
