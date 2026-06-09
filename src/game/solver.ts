import { applyMove, getLegalMoves } from "./rules";
import { isPuzzleSolved } from "./win";
import type { Move, Puzzle } from "./types";

interface SolveResult {
  solvable: boolean;
  moves: Move[];
  exploredNodes: number;
}

interface SolveOptions {
  maxNodes?: number;
  maxDepth?: number;
}

function hashPuzzle(puzzle: Puzzle): string {
  const tubes = puzzle.tubes
    .map((tube) => tube.join(","))
    .sort()
    .join("|");
  return `${puzzle.capacity}:${tubes}`;
}

export function solvePuzzle(
  puzzle: Puzzle,
  options: SolveOptions = {},
): SolveResult {
  const maxNodes = options.maxNodes ?? 75000;
  const maxDepth = options.maxDepth ?? 120;

  const stack: Array<{ puzzle: Puzzle; moves: Move[]; depth: number }> = [
    { puzzle, moves: [], depth: 0 },
  ];
  const visited = new Set<string>();
  let exploredNodes = 0;

  while (stack.length > 0 && exploredNodes < maxNodes) {
    const current = stack.pop();
    if (!current) {
      break;
    }

    const key = hashPuzzle(current.puzzle);
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    exploredNodes += 1;

    if (isPuzzleSolved(current.puzzle)) {
      return { solvable: true, moves: current.moves, exploredNodes };
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    const legalMoves = getLegalMoves(current.puzzle);

    for (let i = legalMoves.length - 1; i >= 0; i -= 1) {
      const move = legalMoves[i];
      const next = applyMove(current.puzzle, move);
      if (!next) {
        continue;
      }

      stack.push({
        puzzle: next.puzzle,
        moves: [...current.moves, move],
        depth: current.depth + 1,
      });
    }
  }

  return {
    solvable: false,
    moves: [],
    exploredNodes,
  };
}
