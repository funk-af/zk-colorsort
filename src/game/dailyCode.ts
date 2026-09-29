import { generateDailyPuzzleFromIndexer } from "./daily";
import { encodePuzzle } from "./serialize";
import type { Puzzle } from "./types";

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** The 20-byte on-chain puzzle code for a puzzle, or null if unsupported. */
export function puzzleCodeBytes(puzzle: Puzzle): Uint8Array | null {
  try {
    const bytes = base64UrlToBytes(encodePuzzle(puzzle));
    return bytes.length === 20 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * The 20-byte puzzle code of the daily puzzle for a UTC date key
 * (YYYY-MM-DD), derived from the block seed the same way the game does.
 */
export async function getDailyPuzzleCodeBytes(
  dateKey: string,
  networkId = "mainnet",
): Promise<Uint8Array> {
  const { puzzle } = await generateDailyPuzzleFromIndexer(dateKey, networkId);
  const code = puzzleCodeBytes(puzzle);
  if (!code) {
    throw new Error(`Daily puzzle for ${dateKey} has no valid puzzle code`);
  }
  return code;
}
