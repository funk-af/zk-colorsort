import type { Puzzle, Tube } from "./types";

export function isTubeSolved(tube: Tube, capacity: number): boolean {
  if (tube.length !== capacity) {
    return false;
  }
  return tube.every((color) => color === tube[0]);
}

export function isTubeUniform(tube: Tube): boolean {
  return tube.length < 2 || tube.every((color) => color === tube[0]);
}

export function isPuzzleSolved(puzzle: Puzzle): boolean {
  return puzzle.tubes.every(
    (tube) => tube.length === 0 || isTubeSolved(tube, puzzle.capacity),
  );
}
