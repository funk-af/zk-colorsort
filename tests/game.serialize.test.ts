import { describe, expect, it } from "vitest";
import { decodePuzzle, encodePuzzle } from "../src/game/serialize";
import { generatePuzzle } from "../src/game/generator";
import { DEFAULT_COLORS, type Puzzle } from "../src/game/types";

function buildInitialPuzzle(): Puzzle {
  const [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10] = DEFAULT_COLORS;

  return {
    capacity: 4,
    tubes: [
      [c1, c2, c3, c4],
      [c5, c6, c7, c8],
      [c9, c10, c1, c2],
      [c3, c4, c5, c6],
      [c7, c8, c9, c10],
      [c1, c3, c5, c7],
      [c2, c4, c6, c8],
      [c9, c1, c10, c2],
      [c3, c5, c7, c9],
      [c4, c6, c8, c10],
      [],
      [],
    ],
  };
}

function decodeBase64UrlLength(encoded: string): number {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded).length;
}

describe("serialize", () => {
  it("round-trips puzzle payload", () => {
    const puzzle = buildInitialPuzzle();

    const encoded = encodePuzzle(puzzle);
    const decoded = decodePuzzle(encoded);

    expect(decoded).toEqual(puzzle);
  });

  it("packs initial puzzle state into 20 binary bytes", () => {
    const encoded = encodePuzzle(buildInitialPuzzle());
    expect(decodeBase64UrlLength(encoded)).toBe(20);
  });

  it("throws when last two tubes are not empty", () => {
    const puzzle = buildInitialPuzzle();
    puzzle.tubes[11] = [DEFAULT_COLORS[0]];

    expect(() => encodePuzzle(puzzle)).toThrowError(
      /Last two tubes must be empty/,
    );
  });

  it("encodes generated random start puzzle", () => {
    const { puzzle } = generatePuzzle(42);
    const encoded = encodePuzzle(puzzle);
    const decoded = decodePuzzle(encoded);

    expect(decoded).toEqual(puzzle);
  });

  it("rejects invalid payload", () => {
    expect(decodePuzzle("bad-payload")).toBeNull();
  });

  it("rejects payload with unexpected length", () => {
    const shortPayload = btoa(String.fromCharCode(1, 2, 3))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    expect(decodePuzzle(shortPayload)).toBeNull();
  });
});
