import { listPuzzleScoresFromAlgod } from "../../../src/algorand/scoreGroups";
import { getTodayDateKey } from "../../../src/game/daily";
import { getDailyPuzzleCodeBytes } from "../../../src/game/dailyCode";
import { getAlgodClient, getAppId, getNetworkId } from "./env";
import { type DailyScoreboard, ScoreboardTimeoutError } from "./interactions";

const dailyCodeCache = new Map<string, Uint8Array>();

/**
 * Today's daily puzzle code, derived from the block seed once per day and
 * cached for the life of the function instance.
 */
export async function todaysPuzzleCode(
  dateKey = getTodayDateKey(),
): Promise<Uint8Array> {
  const cached = dailyCodeCache.get(dateKey);
  if (cached) {
    return cached;
  }
  const code = await getDailyPuzzleCodeBytes(dateKey, getNetworkId());
  dailyCodeCache.clear();
  dailyCodeCache.set(dateKey, code);
  return code;
}

/**
 * Discord shows "did not respond" if an interaction takes more than 3 s in
 * total, so chain reads give up early enough to still answer with an
 * apology. Netlify's own function limit is far above this.
 */
export const SCOREBOARD_TIME_BUDGET_MS = 2_200;

async function readDailyScoreboard(): Promise<DailyScoreboard> {
  const dateKey = getTodayDateKey();
  const puzzleCode = await todaysPuzzleCode(dateKey);
  const entries = await listPuzzleScoresFromAlgod(
    getAlgodClient(),
    getAppId(),
    puzzleCode,
  );
  return {
    dateKey,
    scores: entries.map((entry) => ({
      identity: entry.identity,
      score: Number(entry.score),
    })),
  };
}

/**
 * Every recorded score (wallet and sponsored) for today's daily puzzle, or a
 * ScoreboardTimeoutError if the chain does not answer within the budget.
 */
export async function loadDailyScoreboard(
  budgetMs = SCOREBOARD_TIME_BUDGET_MS,
): Promise<DailyScoreboard> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ScoreboardTimeoutError()), budgetMs);
  });
  try {
    return await Promise.race([readDailyScoreboard(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
