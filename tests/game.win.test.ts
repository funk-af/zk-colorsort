import { describe, expect, it } from "vitest";
import { isPuzzleSolved } from "../src/game/win";
import type { Puzzle } from "../src/game/types";

describe("win", () => {
  it("does not treat partially filled uniform tubes as solved", () => {
    const puzzle: Puzzle = {
      capacity: 4,
      tubes: [["red", "red"], ["blue", "blue", "blue", "blue"], []],
    };

    expect(isPuzzleSolved(puzzle)).toBe(false);
  });

  it("treats only full uniform and empty tubes as solved", () => {
    const puzzle: Puzzle = {
      capacity: 4,
      tubes: [
        ["red", "red", "red", "red"],
        ["blue", "blue", "blue", "blue"],
        [],
      ],
    };

    expect(isPuzzleSolved(puzzle)).toBe(true);
  });
});
