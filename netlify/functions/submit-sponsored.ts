import type { Config } from "@netlify/functions";
import algosdk from "algosdk";
import { PuzzleScoresClient } from "../../src/algorand/PuzzleScoresClient";
import {
  MAX_SPONSORED_UPDATES,
  MAX_STORED_SCORE,
  buildSponsoredBoxName,
  bytesEqual,
  composeScoreGroup,
  deserializeWitness,
  discordUserKey,
  getExistingSponsoredScoreFromAlgod,
  signalsMatchIdentity,
  signalsMatchScore,
  type ScoreSaveOperation,
} from "../../src/algorand/scoreGroups";
import { getTodayDateKey } from "../../src/game/daily";
import { getDailyPuzzleCodeBytes } from "../../src/game/dailyCode";
import { discordAccountCreatedAt, fetchDiscordUser } from "./lib/discord";
import {
  getAlgodClient,
  getAlgorandClient,
  getAppId,
  getMinDiscordAccountAgeDays,
  getNetworkId,
  getSponsorAccount,
  getSponsorMinBalance,
} from "./lib/env";
import { HttpError, errorResponse, json, readJsonBody } from "./lib/http";
import { createSponsoredVerifier } from "./lib/verifier";

interface SubmitBody {
  accessToken?: unknown;
  witness?: unknown;
  score?: unknown;
}

const CONFIRMATION_POLL_MS = 4_500;
const dailyCodeCache = new Map<string, Uint8Array>();

async function todaysPuzzleCode(): Promise<Uint8Array> {
  const dateKey = getTodayDateKey();
  const cached = dailyCodeCache.get(dateKey);
  if (cached) {
    return cached;
  }
  const code = await getDailyPuzzleCodeBytes(dateKey, getNetworkId());
  dailyCodeCache.clear();
  dailyCodeCache.set(dateKey, code);
  return code;
}

async function waitBriefly(
  algod: algosdk.Algodv2,
  txId: string,
): Promise<"confirmed" | "pending"> {
  const deadline = Date.now() + CONFIRMATION_POLL_MS;
  while (Date.now() < deadline) {
    const info = await algod.pendingTransactionInformation(txId).do();
    if (info.poolError) {
      throw new HttpError(400, `Transaction rejected: ${info.poolError}`, "rejected");
    }
    if (info.confirmedRound && info.confirmedRound > 0n) {
      return "confirmed";
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return "pending";
}

/**
 * Submits a Discord player's Groth16-proven score on their behalf.
 *
 * The proof is generated in the player's browser and bound to
 * sha256("discord:" + userId). This function verifies the Discord identity,
 * enforces "today's daily puzzle only", and pays the group fees from the
 * sponsor account. Box MBR comes from the app account. The contract re-checks
 * everything that matters (sponsor-only, proof, caps).
 */
export default async (request: Request) => {
  try {
    if (request.method !== "POST") {
      throw new HttpError(405, "Method not allowed");
    }
    const body = await readJsonBody<SubmitBody>(request);
    if (typeof body.accessToken !== "string") {
      throw new HttpError(401, "Missing Discord access token", "discord_auth");
    }
    const score = body.score;
    if (
      typeof score !== "number" ||
      !Number.isInteger(score) ||
      score <= 0 ||
      score > MAX_STORED_SCORE
    ) {
      throw new HttpError(400, "Invalid score");
    }
    const scoreBig = BigInt(score);

    let witness;
    try {
      witness = deserializeWitness(body.witness);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    if (!signalsMatchScore(witness.signals, scoreBig)) {
      throw new HttpError(400, "Proof score does not match submitted score");
    }

    // 1. Who is asking? Verified with Discord, never trusted from the client.
    const user = await fetchDiscordUser(body.accessToken);
    const ageDays =
      (Date.now() - discordAccountCreatedAt(user.id).getTime()) / 86_400_000;
    if (ageDays < getMinDiscordAccountAgeDays()) {
      throw new HttpError(
        403,
        "Discord account is too new for sponsored submissions",
        "account_age",
      );
    }
    const userKey = await discordUserKey(user.id);
    if (!signalsMatchIdentity(witness.signals, userKey)) {
      throw new HttpError(400, "Proof identity does not match your Discord account", "identity");
    }

    // 2. Only today's daily puzzle is sponsored.
    const todayCode = await todaysPuzzleCode();
    if (!bytesEqual(witness.puzzleCode, todayCode)) {
      throw new HttpError(400, "Only today's daily puzzle can be sponsored", "not_daily");
    }

    // 3. Chain-side pre-checks before spending anything.
    const algod = getAlgodClient();
    const appId = getAppId();
    const sponsor = getSponsorAccount();
    const sponsorAddress = sponsor.addr.toString();

    const sponsorInfo = await algod.accountInformation(sponsorAddress).do();
    if (sponsorInfo.amount - sponsorInfo.minBalance < getSponsorMinBalance()) {
      throw new HttpError(503, "Sponsored submissions are paused", "paused");
    }

    const existing = await getExistingSponsoredScoreFromAlgod(
      algod,
      appId,
      buildSponsoredBoxName(witness.puzzleCode, userKey),
    );
    let operation: ScoreSaveOperation = "add";
    if (existing) {
      if (scoreBig >= existing.score) {
        throw new HttpError(409, "Recorded score is already as good or better", "not_better");
      }
      if (existing.updates >= MAX_SPONSORED_UPDATES) {
        throw new HttpError(429, "Sponsored update limit reached for today", "update_cap");
      }
      operation = "update";
    }

    // 4. Compose, sign as sponsor, and send.
    const algorand = getAlgorandClient().setSigner(
      sponsorAddress,
      algosdk.makeBasicAccountTransactionSigner(sponsor),
    );
    const client = new PuzzleScoresClient({
      appId,
      algorand,
      defaultSender: sponsorAddress,
    });
    const verifier = createSponsoredVerifier(algorand);

    const group = await composeScoreGroup({
      client,
      algodClient: algod,
      verifier,
      operation,
      witness,
      score: scoreBig,
      sender: sponsorAddress,
      userKey,
    });

    // Sign and submit without waiting for confirmation (function time limit),
    // then poll briefly so the common case still returns "confirmed".
    const { atc } = await (await group.composer()).build();
    const signed = await atc.gatherSignatures();
    const { txid } = await algod.sendRawTransaction(signed).do();
    const status = await waitBriefly(algod, txid);

    return json({ status, txId: txid, operation, score });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config: Config = {
  path: "/api/submit-sponsored",
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ["ip"],
  },
};
