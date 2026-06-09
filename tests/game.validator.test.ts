import { describe, expect, it } from "vitest";
import { validatePuzzle } from "../src/game/validator";
import type { Puzzle } from "../src/game/types";

describe("validator", () => {
  it("rejects malformed color counts", () => {
    const puzzle: Puzzle = {
      capacity: 4,
      tubes: [["red", "red"], ["blue"], []],
    };

    const result = validatePuzzle(puzzle);
    expect(result.valid).toBe(false);
  });

  it("does not enforce doubles for user puzzles", () => {
    const puzzle: Puzzle = {
      capacity: 4,
      tubes: [
        ["red", "red", "red", "red"],
        ["blue", "blue", "blue", "blue"],
        ["green", "yellow", "green", "yellow"],
        ["yellow", "green", "yellow", "green"],
        [],
        [],
      ],
    };

    const result = validatePuzzle(puzzle);
    expect(result.valid).toBe(true);
  });

  it("accepts a known solvable puzzle", () => {
    const puzzle: Puzzle = {
      capacity: 4,
      tubes: [
        ["red", "blue", "red", "blue"],
        ["blue", "red", "blue", "red"],
        [],
        [],
      ],
    };

    const result = validatePuzzle(puzzle);
    expect(result.valid).toBe(true);
  });
});
