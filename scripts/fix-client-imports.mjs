/**
 * Post-processes the generated typed client so that imports of type-only
 * names use `import type`. The generator emits plain named imports; with
 * `verbatimModuleSyntax` the bundler keeps them and then fails on names that
 * do not exist at runtime. Each name is checked against the module's actual
 * runtime exports, so this needs no hand-maintained list.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const file = process.argv[2] ?? "src/algorand/PuzzleScoresClient.ts";
const require = createRequire(pathToFileURL(process.cwd() + "/package.json"));

const source = readFileSync(file, "utf8");
const importPattern = /^import \{([^}]*)\} from ['"]([^'"]+)['"];?$/gm;

const rewrites = [];
for (const match of source.matchAll(importPattern)) {
  const [full, namesRaw, specifier] = match;
  const names = namesRaw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0 || names.some((n) => n.startsWith("type "))) continue;

  let runtime;
  try {
    runtime = await import(pathToFileURL(require.resolve(specifier)).href);
  } catch (error) {
    console.warn(`skip ${specifier}: ${error.message}`);
    continue;
  }

  const values = [];
  const types = [];
  for (const entry of names) {
    const exported = entry.split(/\s+as\s+/)[0].trim();
    (exported in runtime ? values : types).push(entry);
  }
  if (types.length === 0) continue;

  const lines = [];
  if (values.length > 0) {
    lines.push(`import { ${values.join(", ")} } from '${specifier}'`);
  }
  lines.push(`import type { ${types.join(", ")} } from '${specifier}'`);
  rewrites.push([full, lines.join("\n")]);
}

let output = source;
for (const [from, to] of rewrites) {
  output = output.replace(from, to);
}
writeFileSync(file, output);
console.log(`fixed ${rewrites.length} import statements in ${file}`);
