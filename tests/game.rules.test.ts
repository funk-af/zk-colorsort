import { describe, expect, it } from "vitest";
import { applyMove, canPour, getLegalMoves } from "../src/game/rules";
import type { Puzzle } from "../src/game/types";

describe("rules", () => {
  it("applies pour only for contiguous same color from top", () => {
    const puzzle: Puzzle = {
      capacity: 4,
      tubes: [["red", "red", "blue", "blue"], ["blue"], []],
    };

    const result = applyMove(puzzle, { from: 0, to: 1 });
    expect(result).not.toBeNull();
    expect(result?.amount).toBe(2);
    expect(result?.puzzle.tubes[0]).toEqual(["red", "red"]);
    expect(result?.puzzle.tubes[1]).toEqual(["blue", "blue", "blue"]);
  });

  it("blocks illegal pours", () => {
    const puzzle: Puzzle = {
      capacity: 4,
      tubes: [["red"], ["blue"], []],
    };

    expect(canPour(puzzle, { from: 0, to: 1 })).toBe(false);
    expect(canPour(puzzle, { from: 0, to: 2 })).toBe(true);
  });

  it("enumerates legal moves", () => {
    const puzzle: Puzzle = {
      capacity: 4,
      tubes: [["red"], ["blue"], []],
    };

    const moves = getLegalMoves(puzzle);
    expect(moves).toEqual(
      expect.arrayContaining([
        { from: 0, to: 2 },
        { from: 1, to: 2 },
      ]),
    );
  });
});
