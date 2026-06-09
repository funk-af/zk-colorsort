import type { Puzzle } from "./types";

export function countDoubles(puzzle: Puzzle): number {
  let doubles = 0;

  for (const tube of puzzle.tubes) {
    for (let i = 1; i < tube.length; i += 1) {
      if (tube[i] === tube[i - 1]) {
        doubles += 1;
      }
    }
  }

  return doubles;
}

export function isWithinDoublesLimit(
  puzzle: Puzzle,
  maxDoubles: number,
): boolean {
  return countDoubles(puzzle) <= maxDoubles;
}
