import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The public build leaves out the BR 187 (1991) Table 1 values, which are Crown copyright.
// It is used when EFS_PUBLIC=1 is set, or automatically when the private table file is absent.
const privateTable = fileURLToPath(new URL("./src/data/br187_1991_table1.json", import.meta.url));
const PUBLIC = process.env.EFS_PUBLIC === "1" || !existsSync(privateTable);
const publicData = (name: string) => fileURLToPath(new URL(`./src/data/public/${name}`, import.meta.url));

export default defineConfig({
  base: "./",
  define: { __PUBLIC_BUILD__: JSON.stringify(PUBLIC) },
  resolve: {
    alias: PUBLIC ? [
      { find: /^.*\/data\/br187_1991_table1\.json$/, replacement: publicData("br187_1991_table1.json") },
      { find: /^.*\/data\/validation_summary\.json$/, replacement: publicData("validation_summary.json") },
    ] : [],
  },
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  worker: { format: "iife" },
  build: { target: "es2020", assetsInlineLimit: 100000000, cssCodeSplit: false, chunkSizeWarningLimit: 4000 },
});
