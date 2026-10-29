// The public repository does not contain the BR 187 (1991) Table 1 data (Crown copyright).
// Type checking still needs files at the imported paths, so this copies the empty public
// placeholders into src/data when the licensed files are absent. The licensed files are never overwritten.
import { copyFileSync, existsSync } from "node:fs";
for (const name of ["br187_1991_table1.json", "validation_summary.json"]) {
  const target = new URL(`../src/data/${name}`, import.meta.url);
  if (!existsSync(target)) copyFileSync(new URL(`../src/data/public/${name}`, import.meta.url), target);
}
