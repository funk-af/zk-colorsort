import type { Puzzle } from "../game/types";
import { decodePuzzle, encodePuzzle } from "../game/serialize";

interface StoredPuzzleRecord {
  id: string;
  createdAt: string;
}

export interface StoredPuzzle {
  id: string;
  createdAt: string;
  puzzle: Puzzle;
}

const STORAGE_KEY = "color-sort.custom.v1";

function readStoredRecords(): StoredPuzzleRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as StoredPuzzleRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is StoredPuzzleRecord =>
        typeof entry?.id === "string" && typeof entry?.createdAt === "string",
    );
  } catch {
    return [];
  }
}

export function loadSavedPuzzles(): StoredPuzzle[] {
  return readStoredRecords()
    .map((entry) => {
      const puzzle = decodePuzzle(entry.id);
      if (!puzzle) {
        return null;
      }

      return {
        id: entry.id,
        createdAt: entry.createdAt,
        puzzle,
      } satisfies StoredPuzzle;
    })
    .filter((entry): entry is StoredPuzzle => entry !== null);
}

export function savePuzzle(puzzle: Puzzle): StoredPuzzle {
  const entries = readStoredRecords();
  const id = encodePuzzle(puzzle);
  const entry: StoredPuzzleRecord = {
    id,
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...entries].slice(0, 30);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

  return {
    id: entry.id,
    createdAt: entry.createdAt,
    puzzle,
  };
}

export function deletePuzzle(id: string): void {
  const next = readStoredRecords().filter((entry) => entry.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
