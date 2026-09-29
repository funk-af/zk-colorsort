/**
 * Integration test for the sponsored-submission Netlify functions against
 * LocalNet. Discord calls are mocked; everything else (proof, lsig, contract)
 * is real. Run with `pnpm run test:functions:e2e` after `algokit localnet start`.
 */
import { AlgorandClient, microAlgo } from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";
import { Groth16Bn254LsigVerifier } from "snarkjs-algorand";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { PuzzleScoresFactory } from "../../../src/algorand/PuzzleScoresClient";
import {
  buildSponsoredBoxName,
  discordUserKey,
  getExistingSponsoredScoreFromAlgod,
  normalizeWitness,
  serializeWitness,
} from "../../../src/algorand/scoreGroups";
import { puzzleCodeBytes } from "../../../src/game/dailyCode";
import { generatePuzzle } from "../../../src/game/generator";
import { solvePuzzle } from "../../../src/game/solver";
import { buildColorSortProofInput } from "../../../src/zk/prove";

const DISCORD_USER_ID = "123456789012345678";

// The daily puzzle code is derived from MainNet block seeds in production; on
// LocalNet the indexer has no usable block headers, so the test controls it.
const dailyState: { code: Uint8Array } = { code: new Uint8Array(20) };
vi.mock("../../../src/game/dailyCode", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/game/dailyCode")>();
  return {
    ...original,
    getDailyPuzzleCodeBytes: async () => dailyState.code,
  };
});

vi.mock("../lib/discord", async () => {
  const { HttpError } = await import("../lib/http");
  return {
    fetchDiscordUser: vi.fn(async (token: string) => {
      if (token !== "good-token-1234567890") {
        throw new HttpError(401, "bad token", "discord_auth");
      }
      return { id: DISCORD_USER_ID, username: "tester" };
    }),
    discordAccountCreatedAt: () => new Date("2020-01-01T00:00:00Z"),
    exchangeDiscordCode: vi.fn(),
  };
});

const ZKEY_PATH = "src/zk/build/color_final.zkey";
const WASM_PATH = "src/zk/build/color_js/color.wasm";

describe("sponsored Netlify functions on LocalNet", () => {
  let appId: bigint;
  let algorand: AlgorandClient;
  let sponsor: algosdk.Account;
  let witnessJson: ReturnType<typeof serializeWitness>;
  let score: number;
  let puzzleCode: Uint8Array;

  beforeAll(async () => {
    algorand = AlgorandClient.defaultLocalNet();
    const dispenser = await algorand.account.localNetDispenser();
    sponsor = algosdk.generateAccount();
    await algorand.send.payment({
      sender: dispenser.addr,
      receiver: sponsor.addr,
      amount: microAlgo(5_000_000),
    });

    const verifier = new Groth16Bn254LsigVerifier({
      algorand,
      zKey: ZKEY_PATH,
      wasmProver: WASM_PATH,
      appOffset: 1,
      totalLsigs: 3,
    });
    const verifierAddress = (await verifier.lsigAccount()).addr.toString();

    const factory = new PuzzleScoresFactory({ algorand, defaultSender: dispenser.addr });
    const { appClient } = await factory.deploy({
      onUpdate: "append",
      onSchemaBreak: "append",
      suppressLog: true,
    });
    appId = appClient.appId;
    await algorand.send.payment({
      sender: dispenser.addr,
      receiver: appClient.appAddress,
      amount: microAlgo(2_000_000),
    });
    await appClient.send.setVerifier({ sender: dispenser.addr, args: { verifierAddress } });
    await appClient.send.setSponsor({
      sender: dispenser.addr,
      args: { sponsorAddress: sponsor.addr.toString() },
    });

    process.env.ALGORAND_NETWORK = "localnet";
    process.env.PUZZLE_SCORES_APP_ID = appId.toString();
    process.env.SPONSOR_MNEMONIC = algosdk.secretKeyToMnemonic(sponsor.sk);
    process.env.MIN_DISCORD_ACCOUNT_AGE_DAYS = "0";
    process.env.SPONSOR_MIN_BALANCE = "100000";

    // Stand-in for today's daily puzzle.
    const { puzzle } = generatePuzzle(42);
    puzzleCode = puzzleCodeBytes(puzzle)!;
    dailyState.code = puzzleCode;
    const { moves } = solvePuzzle(puzzle, { maxNodes: 200_000 });
    expect(moves.length).toBeGreaterThan(0);
    score = moves.length;

    const userKey = await discordUserKey(DISCORD_USER_ID);
    const witness = await verifier.proofAndSignals(
      buildColorSortProofInput(puzzle, moves, userKey),
    );
    witnessJson = serializeWitness(normalizeWitness(witness, BigInt(score)));
  }, 300_000);

  async function callSubmit(body: unknown) {
    const { default: handler } = await import("../submit-sponsored");
    const request = new Request("http://localhost/api/submit-sponsored", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = await handler(request);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  test("rejects a submission for a puzzle that is not today's daily", async () => {
    const otherPuzzle = puzzleCodeBytes(generatePuzzle(7).puzzle)!;
    const result = await callSubmit({
      accessToken: "good-token-1234567890",
      witness: { ...witnessJson, puzzleCode: algosdk.bytesToBase64(otherPuzzle) },
      score,
    });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("not_daily");
  }, 60_000);

  test("rejects a bad Discord token before touching the chain", async () => {
    const result = await callSubmit({ accessToken: "bad", witness: witnessJson, score });
    expect(result.status).toBe(401);
  }, 60_000);

  test("rejects a malformed witness", async () => {
    const result = await callSubmit({
      accessToken: "good-token-1234567890",
      witness: { ...witnessJson, signals: ["1"] },
      score,
    });
    expect(result.status).toBe(400);
  }, 60_000);

  test("submits a sponsored score for today's puzzle, then rejects a non-improvement", async () => {
    const first = await callSubmit({
      accessToken: "good-token-1234567890",
      witness: witnessJson,
      score,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(["confirmed", "pending"]).toContain(first.body.status);
    expect(first.body.operation).toBe("add");

    const userKey = await discordUserKey(DISCORD_USER_ID);
    const algod = algorand.client.algod;
    let existing = null;
    for (let i = 0; i < 20 && !existing; i += 1) {
      existing = await getExistingSponsoredScoreFromAlgod(
        algod,
        appId,
        buildSponsoredBoxName(puzzleCode, userKey),
      );
      if (!existing) await new Promise((r) => setTimeout(r, 500));
    }
    expect(existing?.score).toBe(BigInt(score));

    const again = await callSubmit({
      accessToken: "good-token-1234567890",
      witness: witnessJson,
      score,
    });
    expect(again.status).toBe(409);
  }, 120_000);

  test("sweep keeps today's boxes and deletes stale ones", async () => {
    const { sweepSponsoredScores } = await import("../sweep-sponsored");
    const keep = await sweepSponsoredScores();
    expect(keep.deleted).toBe(0);

    // Pretend a new day: the daily code no longer matches the stored box.
    dailyState.code = new Uint8Array(20).fill(1);
    const swept = await sweepSponsoredScores();
    expect(swept.deleted).toBe(1);
    expect(swept.remaining).toBe(0);

    const userKey = await discordUserKey(DISCORD_USER_ID);
    const gone = await getExistingSponsoredScoreFromAlgod(
      algorand.client.algod,
      appId,
      buildSponsoredBoxName(puzzleCode, userKey),
    );
    expect(gone).toBeNull();
  }, 120_000);
});
