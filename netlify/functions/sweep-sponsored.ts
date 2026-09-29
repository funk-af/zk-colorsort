import type { Config } from "@netlify/functions";
import algosdk from "algosdk";
import { PuzzleScoresClient } from "../../src/algorand/PuzzleScoresClient";
import {
  buildSponsoredBoxName,
  bytesEqual,
  bytesToHex,
  listAllSponsoredBoxesFromAlgod,
} from "../../src/algorand/scoreGroups";
import { getTodayDateKey } from "../../src/game/daily";
import { getDailyPuzzleCodeBytes } from "../../src/game/dailyCode";
import {
  getAlgodClient,
  getAlgorandClient,
  getAppId,
  getNetworkId,
  getSponsorAccount,
} from "./lib/env";
import { json } from "./lib/http";

// Box references per app call (AVM limit is 8 per txn) and app calls per
// atomic group.
const KEYS_PER_CALL = 8;
const CALLS_PER_GROUP = 16;
// Scheduled functions are limited to 30 s; leave headroom for the last send.
const TIME_BUDGET_MS = 22_000;

/**
 * Deletes every sponsored score box that is not for today's daily puzzle,
 * releasing its MBR back to the app account. Idempotent: a run that stops on
 * the time budget, or a missed day, is picked up by the next run.
 */
export async function sweepSponsoredScores(): Promise<{
  deleted: number;
  remaining: number;
  puzzles: number;
}> {
  const startedAt = Date.now();
  const algod = getAlgodClient();
  const appId = getAppId();
  const sponsor = getSponsorAccount();
  const sponsorAddress = sponsor.addr.toString();
  const algorand = getAlgorandClient().setSigner(
    sponsorAddress,
    algosdk.makeBasicAccountTransactionSigner(sponsor),
  );
  const client = new PuzzleScoresClient({
    appId,
    algorand,
    defaultSender: sponsorAddress,
  });

  const todayCode = await getDailyPuzzleCodeBytes(getTodayDateKey(), getNetworkId());
  const boxes = await listAllSponsoredBoxesFromAlgod(algod, appId);

  const byPuzzle = new Map<string, { puzzleCode: Uint8Array; userKeys: Uint8Array[] }>();
  for (const box of boxes) {
    if (bytesEqual(box.puzzleCode, todayCode)) {
      continue;
    }
    const key = bytesToHex(box.puzzleCode);
    const entry = byPuzzle.get(key) ?? { puzzleCode: box.puzzleCode, userKeys: [] };
    entry.userKeys.push(box.userKey);
    byPuzzle.set(key, entry);
  }

  let deleted = 0;
  let remaining = 0;
  let outOfTime = false;

  for (const { puzzleCode, userKeys } of byPuzzle.values()) {
    for (let start = 0; start < userKeys.length; start += KEYS_PER_CALL * CALLS_PER_GROUP) {
      if (outOfTime || Date.now() - startedAt > TIME_BUDGET_MS) {
        outOfTime = true;
        remaining += userKeys.length - start;
        break;
      }
      const batch = userKeys.slice(start, start + KEYS_PER_CALL * CALLS_PER_GROUP);
      const group = client.newGroup();
      for (let offset = 0; offset < batch.length; offset += KEYS_PER_CALL) {
        const chunk = batch.slice(offset, offset + KEYS_PER_CALL);
        group.sweepSponsoredScores({
          args: { puzzleCode, userKeys: chunk },
          sender: sponsorAddress,
          boxReferences: chunk.map((userKey) => ({
            appId,
            name: buildSponsoredBoxName(puzzleCode, userKey),
          })),
        });
      }
      await group.send();
      deleted += batch.length;
    }
  }

  return { deleted, remaining, puzzles: byPuzzle.size };
}

export default async () => {
  try {
    const result = await sweepSponsoredScores();
    console.log("sweep-sponsored", result);
    return json(result);
  } catch (error) {
    console.error("sweep-sponsored failed", error);
    return json({ error: (error as Error).message }, 500);
  }
};

export const config: Config = {
  // Shortly after UTC midnight, with retries in case a run hit its time
  // budget or a transient error.
  schedule: "15 0,2,6 * * *",
};
