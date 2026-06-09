import { generatePuzzle } from "./generator";
import { getIndexerClient } from "../indexer";
import type { PuzzleResult } from "./generator";
import type { Puzzle } from "./types";

const DEFAULT_DAILY_NETWORK_ID = "mainnet";
const DAILY_SEED_STORAGE_KEY = "color-sort.daily-seeds.v1";

type DailySeedCache = Record<string, number>;

const dailySeedCache = new Map<string, number>();
const dailyPuzzleCache = new Map<string, PuzzleResult>();
const dailyPuzzleInFlight = new Map<string, Promise<PuzzleResult>>();

function getStorage(): Storage | null {
  const storage = globalThis.localStorage;
  return storage ?? null;
}

function hashToSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function getDailySeedCacheKey(dateKey: string, networkId: string): string {
  return `${networkId}:${dateKey}`;
}

function readStoredDailySeeds(): DailySeedCache {
  const storage = getStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(DAILY_SEED_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const next: DailySeedCache = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        next[key] = value;
      }
    }

    return next;
  } catch {
    return {};
  }
}

function writeStoredDailySeed(cacheKey: string, seed: number): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const entries = readStoredDailySeeds();
  entries[cacheKey] = seed;
  storage.setItem(DAILY_SEED_STORAGE_KEY, JSON.stringify(entries));
}

function getCachedDailySeed(cacheKey: string): number | null {
  const inMemory = dailySeedCache.get(cacheKey);
  if (typeof inMemory === "number") {
    return inMemory;
  }

  const stored = readStoredDailySeeds()[cacheKey];
  if (typeof stored === "number") {
    dailySeedCache.set(cacheKey, stored);
    return stored;
  }

  return null;
}

function cacheDailySeed(cacheKey: string, seed: number): void {
  dailySeedCache.set(cacheKey, seed);
  writeStoredDailySeed(cacheKey, seed);
}

function clonePuzzle(puzzle: Puzzle): Puzzle {
  return {
    capacity: puzzle.capacity,
    tubes: puzzle.tubes.map((tube) => [...tube]),
  };
}

function clonePuzzleResult(result: PuzzleResult): PuzzleResult {
  return {
    puzzle: clonePuzzle(result.puzzle),
    seed: result.seed,
  };
}

export function dateKeyFromDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayDateKey(now = new Date()): string {
  return dateKeyFromDate(now);
}

export function parseDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function shiftDateKey(dateKey: string, days: number): string | null {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return null;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return dateKeyFromDate(parsed);
}

export async function getDailySeedFromIndexer(
  dateKey: string,
  networkId = DEFAULT_DAILY_NETWORK_ID,
): Promise<number> {
  const cacheKey = getDailySeedCacheKey(dateKey, networkId);
  const cachedSeed = getCachedDailySeed(cacheKey);
  if (cachedSeed !== null) {
    return cachedSeed;
  }

  const indexerClient = getIndexerClient(networkId);
  const response = await indexerClient
    .searchForBlockHeaders()
    .afterTime(dateKey)
    .limit(1)
    .do();

  const seed = response.blocks[0]?.seed;
  if (seed) {
    const seedString = new TextDecoder().decode(seed);
    const hashedSeed = hashToSeed(`block-seed:${seedString}`);
    cacheDailySeed(cacheKey, hashedSeed);
    return hashedSeed;
  }

  throw new Error(`No block header found for daily puzzle date: ${dateKey}`);
}

export async function generateDailyPuzzleFromIndexer(
  dateKey: string,
  networkId = DEFAULT_DAILY_NETWORK_ID,
) {
  const cacheKey = getDailySeedCacheKey(dateKey, networkId);
  const cachedPuzzle = dailyPuzzleCache.get(cacheKey);
  if (cachedPuzzle) {
    return clonePuzzleResult(cachedPuzzle);
  }

  const inFlight = dailyPuzzleInFlight.get(cacheKey);
  if (inFlight) {
    const settled = await inFlight;
    return clonePuzzleResult(settled);
  }

  const nextRequest = (async () => {
    const seed = await getDailySeedFromIndexer(dateKey, networkId);
    const generated = generatePuzzle(seed);
    dailyPuzzleCache.set(cacheKey, generated);
    return generated;
  })();

  dailyPuzzleInFlight.set(cacheKey, nextRequest);

  try {
    const settled = await nextRequest;
    return clonePuzzleResult(settled);
  } finally {
    dailyPuzzleInFlight.delete(cacheKey);
  }
}
