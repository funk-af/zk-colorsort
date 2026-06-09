import { solvePuzzle } from "./solver";
import type { Puzzle, ValidationResult } from "./types";

function validateStructure(puzzle: Puzzle): string[] {
  const reasons: string[] = [];
  const counts = new Map<string, number>();

  if (puzzle.capacity <= 1) {
    reasons.push("Capacity must be at least 2.");
  }

  for (const tube of puzzle.tubes) {
    if (tube.length > puzzle.capacity) {
      reasons.push("A tube exceeds capacity.");
    }
    for (const color of tube) {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }

  if (puzzle.tubes.length < 3) {
    reasons.push("Puzzle must have at least 3 tubes.");
  }

  const emptyCount = puzzle.tubes.filter((tube) => tube.length === 0).length;
  if (emptyCount !== 2) {
    reasons.push("Puzzle must have exactly 2 empty tubes.");
  }

  const invalidCounts = [...counts.entries()].filter(
    ([, count]) => count !== puzzle.capacity,
  );
  if (invalidCounts.length > 0) {
    reasons.push("Each used color must appear exactly capacity times.");
  }

  return reasons;
}

export function validatePuzzle(puzzle: Puzzle): ValidationResult {
  const reasons = validateStructure(puzzle);
  if (reasons.length > 0) {
    return { valid: false, reasons };
  }

  const solveResult = solvePuzzle(puzzle, { maxNodes: 90000, maxDepth: 140 });
  if (!solveResult.solvable) {
    return {
      valid: false,
      reasons: [
        "No solution found within search limits. Try adding an empty tube or simplifying the layout.",
      ],
      exploredNodes: solveResult.exploredNodes,
    };
  }

  return {
    valid: true,
    reasons: [],
    exploredNodes: solveResult.exploredNodes,
  };
}
