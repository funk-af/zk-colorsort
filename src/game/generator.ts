import { solvePuzzle } from "./solver";
import { isWithinDoublesLimit } from "./constraints";
import { DEFAULT_COLORS, DEFAULT_CONFIG } from "./types";
import { isPuzzleSolved } from "./win";
import type { ColorId, Puzzle, Tube } from "./types";

function hasMixedTube(puzzle: Puzzle): boolean {
  return puzzle.tubes.some((tube) => {
    if (tube.length < 2) {
      return false;
    }
    return tube.some((color) => color !== tube[0]);
  });
}

function hasExpectedEmptyTubes(puzzle: Puzzle, expected: number): boolean {
  return puzzle.tubes.filter((tube) => tube.length === 0).length === expected;
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

function shuffleArray<T>(array: T[], rng: () => number): void {
  // Fisher-Yates shuffle algorithm
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function hasThreeInARow(tube: Tube): boolean {
  for (let i = tube.length - 3; i >= 0; i -= 1) {
    if (tube[i] === tube[i + 1] && tube[i + 1] === tube[i + 2]) {
      return true;
    }
  }
  return false;
}

function moveEmptyTubesToEnd(puzzle: Puzzle): Puzzle {
  const nonEmptyTubes = puzzle.tubes
    .filter((tube) => tube.length > 0)
    .map((tube) => [...tube]);
  const emptyTubes = puzzle.tubes
    .filter((tube) => tube.length === 0)
    .map((tube) => [...tube]);

  return {
    capacity: puzzle.capacity,
    tubes: [...nonEmptyTubes, ...emptyTubes],
  };
}

export interface PuzzleResult {
  puzzle: Puzzle;
  seed: number;
}

export function buildSolvedPuzzle(
  capacity: number,
  colors: readonly ColorId[],
  emptyTubes: number,
): Puzzle {
  const tubes: string[][] = colors.map((color) =>
    Array.from({ length: capacity }, () => color),
  );
  for (let i = 0; i < emptyTubes; i += 1) {
    tubes.push([]);
  }
  return {
    capacity,
    tubes,
  };
}

function generatePuzzleByPlacement(
  seed: number,
  maxDoubles: number,
): Puzzle | null {
  const colors = DEFAULT_COLORS.slice(0, DEFAULT_CONFIG.colors);
  const rng = mulberry32(seed);

  // Create tubes - designate the first 'colors.length' for placement
  // and the rest will remain empty
  const tubes: Tube[] = [];
  for (let i = 0; i < colors.length + DEFAULT_CONFIG.emptyTubes; i += 1) {
    tubes.push([]);
  }

  // Create a shuffled list of all tiles to place
  const tilesToPlace: ColorId[] = [];
  for (const color of colors) {
    for (let i = 0; i < DEFAULT_CONFIG.capacity; i += 1) {
      tilesToPlace.push(color);
    }
  }
  shuffleArray(tilesToPlace, rng);

  // Try to place each tile in order
  let doubles = 0;
  for (const color of tilesToPlace) {
    let placed = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!placed && attempts < maxAttempts) {
      // Only use tubes designated for colors (not the empty tubes)
      const tubeIndex = randomInt(rng, colors.length);
      const tube = tubes[tubeIndex];

      // Can only place if tube has space and won't create 3 in a row
      if (tube.length < DEFAULT_CONFIG.capacity) {
        const createsDouble =
          tube.length > 0 && tube[tube.length - 1] === color;
        if (createsDouble && doubles >= maxDoubles) {
          attempts += 1;
          continue;
        }

        tube.push(color);
        if (!hasThreeInARow(tube)) {
          placed = true;
          if (createsDouble) {
            doubles += 1;
          }
        } else {
          tube.pop();
        }
      }
      attempts += 1;
    }

    if (!placed) {
      return null; // Failed to place a tile
    }
  }

  return {
    capacity: DEFAULT_CONFIG.capacity,
    tubes,
  };
}

export function generatePuzzle(seed = Date.now()): PuzzleResult {
  const generationRng = mulberry32(seed ^ 0x9e3779b9);
  const maxDoubles = randomInt(generationRng, 4);

  let puzzle: Puzzle | null = null;
  let guard = 0;
  while (guard < 1200) {
    const generated = generatePuzzleByPlacement(seed + guard * 137, maxDoubles);
    if (generated === null) {
      guard += 1;
      continue;
    }

    if (!isWithinDoublesLimit(generated, maxDoubles)) {
      guard += 1;
      continue;
    }

    puzzle = generated;

    if (
      !isPuzzleSolved(puzzle) &&
      hasMixedTube(puzzle) &&
      hasExpectedEmptyTubes(puzzle, DEFAULT_CONFIG.emptyTubes)
    ) {
      // Verify the puzzle is solvable
      const solveResult = solvePuzzle(puzzle);
      if (solveResult.solvable) {
        break;
      }
    }
    guard += 1;
  }

  if (puzzle === null) {
    throw new Error("Failed to generate a puzzle within doubles limit.");
  }

  return { puzzle: moveEmptyTubesToEnd(puzzle), seed };
}
