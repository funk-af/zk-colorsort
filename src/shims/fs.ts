export function readFileSync(): never {
  throw new Error("readFileSync is not available in the browser build");
}
