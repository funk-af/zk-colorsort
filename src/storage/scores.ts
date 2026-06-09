import { encodePuzzle } from "../game/serialize";
import type { Puzzle } from "../game/types";

const STORAGE_KEY = "color-sort.best-scores.v1";

interface BestScoreEntry {
  score: number;
  moves: string[];
}

type ScoreTable = Record<string, BestScoreEntry>;

function isValidStoredMove(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*:[1-9]\d*$/.test(value);
}

function parseBestScoreEntry(value: unknown): BestScoreEntry | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return {
      score: value,
      moves: [],
    };
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as { score?: unknown; moves?: unknown };
  if (
    typeof entry.score !== "number" ||
    !Number.isInteger(entry.score) ||
    entry.score <= 0
  ) {
    return null;
  }

  const moves = Array.isArray(entry.moves)
    ? entry.moves.filter(isValidStoredMove)
    : [];

  return {
    score: entry.score,
    moves,
  };
}

function readScores(): ScoreTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const next: ScoreTable = {};
    for (const [key, value] of Object.entries(parsed)) {
      const entry = parseBestScoreEntry(value);
      if (entry) {
        next[key] = entry;
      }
    }

    return next;
  } catch {
    return {};
  }
}

function keyForPuzzle(puzzle: Puzzle): string | null {
  try {
    return encodePuzzle(puzzle);
  } catch {
    return null;
  }
}

export function getBestScore(puzzle: Puzzle): number | null {
  const key = keyForPuzzle(puzzle);
  if (!key) {
    return null;
  }

  const entry = readScores()[key];
  return entry?.score ?? null;
}

export function getBestScoreMoves(puzzle: Puzzle): string[] | null {
  const key = keyForPuzzle(puzzle);
  if (!key) {
    return null;
  }

  const entry = readScores()[key];
  return entry ? [...entry.moves] : null;
}

export function saveBestScore(
  puzzle: Puzzle,
  score: number,
  moves: string[] = [],
): number | null {
  if (!Number.isInteger(score) || score <= 0) {
    return null;
  }

  const key = keyForPuzzle(puzzle);
  if (!key) {
    return null;
  }

  const entries = readScores();
  const previous = entries[key];
  const cleanMoves = moves.filter(isValidStoredMove);

  if (previous) {
    if (previous.score < score) {
      return previous.score;
    }

    // Preserve best-score semantics while backfilling move proof for equal legacy entries.
    if (previous.score === score && previous.moves.length > 0) {
      return previous.score;
    }
  }

  entries[key] = {
    score,
    moves: cleanMoves,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  return score;
}
