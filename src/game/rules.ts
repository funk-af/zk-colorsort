import type { Move, MoveResult, Puzzle, Tube } from "./types";

export function clonePuzzle(puzzle: Puzzle): Puzzle {
  return {
    capacity: puzzle.capacity,
    tubes: puzzle.tubes.map((tube) => [...tube]),
  };
}

export function getTopColor(tube: Tube): string | null {
  return tube.length === 0 ? null : tube[tube.length - 1];
}

export function getPourAmount(from: Tube, to: Tube, capacity: number): number {
  if (from.length === 0 || to.length >= capacity) {
    return 0;
  }

  const top = from[from.length - 1];
  const toTop = getTopColor(to);
  if (toTop !== null && toTop !== top) {
    return 0;
  }

  let contiguous = 0;
  for (let i = from.length - 1; i >= 0; i -= 1) {
    if (from[i] !== top) {
      break;
    }
    contiguous += 1;
  }

  const available = capacity - to.length;
  return Math.min(contiguous, available);
}

export function canPour(puzzle: Puzzle, move: Move): boolean {
  if (move.from === move.to) {
    return false;
  }
  if (!puzzle.tubes[move.from] || !puzzle.tubes[move.to]) {
    return false;
  }
  return (
    getPourAmount(
      puzzle.tubes[move.from],
      puzzle.tubes[move.to],
      puzzle.capacity,
    ) > 0
  );
}

export function applyMove(puzzle: Puzzle, move: Move): MoveResult | null {
  if (!canPour(puzzle, move)) {
    return null;
  }

  const next = clonePuzzle(puzzle);
  const fromTube = next.tubes[move.from];
  const toTube = next.tubes[move.to];
  const amount = getPourAmount(fromTube, toTube, next.capacity);

  for (let i = 0; i < amount; i += 1) {
    const color = fromTube.pop();
    if (!color) {
      break;
    }
    toTube.push(color);
  }

  return {
    puzzle: next,
    amount,
  };
}

export function getLegalMoves(puzzle: Puzzle): Move[] {
  const moves: Move[] = [];
  for (let from = 0; from < puzzle.tubes.length; from += 1) {
    for (let to = 0; to < puzzle.tubes.length; to += 1) {
      if (from === to) {
        continue;
      }
      if (canPour(puzzle, { from, to })) {
        moves.push({ from, to });
      }
    }
  }
  return moves;
}
