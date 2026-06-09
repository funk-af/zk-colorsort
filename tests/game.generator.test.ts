import { describe, expect, it } from "vitest";
import { countDoubles } from "../src/game/constraints";
import { generatePuzzle } from "../src/game/generator";
import { solvePuzzle } from "../src/game/solver";
import { isPuzzleSolved } from "../src/game/win";

describe("generator", () => {
  it("returns unsolved puzzle for default generation", () => {
    const { puzzle } = generatePuzzle(7);
    expect(isPuzzleSolved(puzzle)).toBe(false);
    expect(puzzle.tubes.filter((tube) => tube.length === 0)).toHaveLength(2);
    const firstEmptyIndex = puzzle.tubes.findIndex((tube) => tube.length === 0);
    expect(firstEmptyIndex).toBeGreaterThan(0);
    expect(
      puzzle.tubes.slice(firstEmptyIndex).every((tube) => tube.length === 0),
    ).toBe(true);
  });

  it("returns puzzles solvable within search limits", () => {
    const { puzzle } = generatePuzzle(99);
    const solved = solvePuzzle(puzzle, { maxNodes: 120000, maxDepth: 160 });
    expect(solved.solvable).toBe(true);
  });

  it("enforces doubles limit", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const { puzzle } = generatePuzzle(seed);
      expect(countDoubles(puzzle)).toBeLessThanOrEqual(4);
    }
  });
});
