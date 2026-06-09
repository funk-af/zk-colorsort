export type ColorId = string;
export type Tube = ColorId[];

export interface Puzzle {
  capacity: number;
  tubes: Tube[];
}

export interface Move {
  from: number;
  to: number;
}

export interface MoveResult {
  puzzle: Puzzle;
  amount: number;
}

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
  exploredNodes?: number;
}

export const DEFAULT_COLORS: readonly ColorId[] = [
  "#ff0000",
  "#ffff00",
  "#ffa500",
  "#00ffff",
  "#00ff00",
  "#0000ff",
  "#800080",
  "#6366f1",
  "#ffffff",
  "#ff00ff",
] as const;

export const DEFAULT_CONFIG = {
  capacity: 4,
  colors: 10,
  emptyTubes: 2,
} as const;
