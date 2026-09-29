import {
  type AlgorandClient,
  Config,
  microAlgo,
} from "@algorandfoundation/algokit-utils";
import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import algosdk from "algosdk";
import { Groth16Bn254LsigVerifier } from "snarkjs-algorand";
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  PuzzleScoresFactory,
  type Groth16Bn254Proof,
} from "../../src/algorand/PuzzleScoresClient";
import { updateAppInPlace } from "../deploy-config";
import { generatePuzzle } from "../../src/game/generator";
import { applyMove } from "../../src/game/rules";
import { solvePuzzle } from "../../src/game/solver";
import type { Move } from "../../src/game/types";
import { buildColorSortProofInput } from "../../src/zk/prove";

const ZKEY_PATH = "src/zk/build/color_final.zkey";
const WASM_PATH = "src/zk/build/color_js/color.wasm";
const VERIFIER_APP_OFFSET = 1;
const ADD_SCORE_TOTAL_LSIGS = 2;
// Sponsored groups have no MBR payment txn, so one more padding lsig keeps the
// pooled logicsig budget at 4 txns * 20k.
const SPONSORED_TOTAL_LSIGS = 3;

const fixture = algorandFixture();

const PUZZLE_SIGNAL_START = 1;
const SENDER_SIGNAL_START = 4;
const SHARED_USER = algosdk.generateAccount();
const SHARED_USER_SIGNER =
  algosdk.makeBasicAccountTransactionSigner(SHARED_USER);

type ProofBundle = {
  proof: Groth16Bn254Proof;
  signals: bigint[];
  puzzleCodeBytes: Uint8Array;
  score: bigint;
};

let cachedVerifierAddress: string | undefined;
let cachedProofBundle: ProofBundle | undefined;

function buildScoreBoxName(puzzleCode: Uint8Array, sender: string): Uint8Array {
  const addressBytes = algosdk.decodeAddress(sender).publicKey;
  return new Uint8Array([...puzzleCode, ...addressBytes]);
}

function createVerifier(
  algorand: AlgorandClient,
  totalLsigs = ADD_SCORE_TOTAL_LSIGS,
): Groth16Bn254LsigVerifier {
  return new Groth16Bn254LsigVerifier({
    algorand,
    zKey: ZKEY_PATH,
    wasmProver: WASM_PATH,
    appOffset: VERIFIER_APP_OFFSET,
    totalLsigs,
  });
}

function discordUserKey(userId: string): Uint8Array {
  return new Uint8Array(
    createHash("sha256").update(`discord:${userId}`).digest(),
  );
}

function buildSponsoredBoxName(
  puzzleCode: Uint8Array,
  userKey: Uint8Array,
): Uint8Array {
  return new Uint8Array([...Buffer.from("s"), ...puzzleCode, ...userKey]);
}

/**
 * Build a strictly longer valid solution for the same puzzle: make one legal
 * "useless" pour into an empty tube, then solve from that state. Used to test
 * the "strictly better" update path with a second, worse proof.
 */
function withDetour(
  puzzle: ReturnType<typeof generatePuzzle>["puzzle"],
  baseline: Move[],
): Move[] {
  for (let from = 0; from < puzzle.tubes.length; from += 1) {
    if (puzzle.tubes[from].length === 0) continue;
    for (let to = 0; to < puzzle.tubes.length; to += 1) {
      if (puzzle.tubes[to].length !== 0) continue;
      const detour: Move = { from, to };
      const next = applyMove(puzzle, detour);
      if (!next) continue;
      const rest = solvePuzzle(next.puzzle, { maxNodes: 75_000 }).moves;
      if (rest.length > 0 && rest.length + 1 > baseline.length) {
        return [detour, ...rest];
      }
    }
  }
  throw new Error("could not build a longer solution for the detour proof");
}

function tamperProof(proof: Groth16Bn254Proof): Groth16Bn254Proof {
  const piA = new Uint8Array(proof.piA);
  piA[0] = piA[0] ^ 0x01;

  return {
    piA,
    piB: new Uint8Array(proof.piB),
    piC: new Uint8Array(proof.piC),
  };
}

function cloneProof(proof: Groth16Bn254Proof): Groth16Bn254Proof {
  return {
    piA: new Uint8Array(proof.piA),
    piB: new Uint8Array(proof.piB),
    piC: new Uint8Array(proof.piC),
  };
}

function cloneProofBundle(bundle: ProofBundle): ProofBundle {
  return {
    proof: cloneProof(bundle.proof),
    signals: [...bundle.signals],
    puzzleCodeBytes: new Uint8Array(bundle.puzzleCodeBytes),
    score: bundle.score,
  };
}

function getCachedProofBundle(): ProofBundle {
  if (!cachedProofBundle) {
    throw new Error("cached proof bundle is not initialized");
  }
  return cloneProofBundle(cachedProofBundle);
}

async function generateProof(
  sender: string | Uint8Array,
  verifier: Groth16Bn254LsigVerifier,
  options?: { detour?: boolean },
): Promise<{
  proof: Groth16Bn254Proof;
  signals: bigint[];
  puzzleCodeBytes: Uint8Array;
  score: bigint;
}> {
  const { puzzle } = generatePuzzle(42);
  const solved = solvePuzzle(puzzle, { maxNodes: 75_000 });
  if (solved.moves.length === 0) throw new Error("seed 42 puzzle has no solution");
  const moves = options?.detour ? withDetour(puzzle, solved.moves) : solved.moves;

  const input = buildColorSortProofInput(puzzle, moves, sender);
  const witness = await verifier.proofAndSignals(input);

  const raw = witness as {
    proof: {
      piA?: Uint8Array;
      piB?: Uint8Array;
      piC?: Uint8Array;
      pi_aBytes?: Uint8Array;
      pi_bBytes?: Uint8Array;
      pi_cBytes?: Uint8Array;
    };
    signals: Array<string | number | bigint>;
  };

  const piA = raw.proof.piA ?? raw.proof.pi_aBytes;
  const piB = raw.proof.piB ?? raw.proof.pi_bBytes;
  const piC = raw.proof.piC ?? raw.proof.pi_cBytes;

  if (!(piA instanceof Uint8Array)) throw new Error("piA missing");
  if (!(piB instanceof Uint8Array)) throw new Error("piB missing");
  if (!(piC instanceof Uint8Array)) throw new Error("piC missing");

  const signals = raw.signals.map((v) => BigInt(v));
  const score = signals[0];

  // Rebuild puzzle code bytes from packed puzzle limbs at signals[1..3].
  const puzzleCodeBytes = new Uint8Array(20);
  const limbDefs = [
    { value: signals[PUZZLE_SIGNAL_START], length: 8 },
    { value: signals[PUZZLE_SIGNAL_START + 1], length: 8 },
    { value: signals[PUZZLE_SIGNAL_START + 2], length: 4 },
  ];
  let offset = 0;
  for (const { value, length } of limbDefs) {
    let v = value;
    for (let i = length - 1; i >= 0; i -= 1) {
      puzzleCodeBytes[offset + i] = Number(v & 0xffn);
      v >>= 8n;
    }
    offset += length;
  }

  return {
    proof: { piA, piB, piC },
    signals,
    puzzleCodeBytes,
    score,
  };
}

describe("PuzzleScores on-chain verifier checks (real lsig)", () => {
  beforeAll(() => {
    Config.configure({ debug: true });
  });

  beforeEach(fixture.newScope, 120_000);

  async function deployConfiguredApp() {
    const { algorand, testAccount } = fixture.context;

    const user = SHARED_USER;
    const userSigner = SHARED_USER_SIGNER;
    algorand.setSigner(user.addr, userSigner);

    await algorand.send.payment({
      sender: testAccount,
      receiver: user.addr,
      amount: microAlgo(2_000_000),
    });

    const verifier = createVerifier(algorand);
    if (!cachedVerifierAddress) {
      const lsigAccount = await verifier.lsigAccount();
      cachedVerifierAddress = lsigAccount.addr.toString();
    }
    const verifierAddress = cachedVerifierAddress;

    const factory = new PuzzleScoresFactory({
      algorand,
      defaultSender: testAccount,
    });

    const { appClient } = await factory.deploy({
      onUpdate: "append",
      onSchemaBreak: "append",
      suppressLog: true,
    });

    // Required funding step before first addScore on a fresh deployment.
    await algorand.send.payment({
      sender: testAccount,
      receiver: appClient.appAddress,
      amount: microAlgo(100_000),
    });

    await appClient.send.setVerifier({
      sender: testAccount,
      args: { verifierAddress },
    });

    if (!cachedProofBundle) {
      cachedProofBundle = await generateProof(user.addr.toString(), verifier);
    }

    return { appClient, user, userSigner, verifier };
  }

  async function buildAddScoreGroup(params: {
    appClient: Awaited<ReturnType<typeof deployConfiguredApp>>["appClient"];
    user: algosdk.Account;
    userSigner: algosdk.TransactionSigner;
    verifier: Groth16Bn254LsigVerifier;
    proof: Groth16Bn254Proof;
    signals: bigint[];
    puzzleCodeBytes: Uint8Array;
    score: bigint;
  }) {
    const {
      appClient,
      user,
      userSigner,
      verifier,
      proof,
      signals,
      puzzleCodeBytes,
      score,
    } = params;
    const userAddress = user.addr.toString();

    const group = appClient.newGroup();

    await verifier.verificationParams({
      proof,
      signals,
      composer: group,
      paramsCallback: async ({ lsigParams, lsigsFee }) => {
        const mbr = await appClient.boxMbr({ args: [] });
        const suggested = await appClient.algorand.client.algod
          .getTransactionParams()
          .do();

        const payMbrTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: userAddress,
          receiver: appClient.appAddress,
          amount: mbr,
          suggestedParams: suggested,
        });

        const verifierTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject(
          {
            sender: lsigParams.sender,
            receiver: appClient.appAddress,
            amount: 0,
            suggestedParams: {
              ...suggested,
              flatFee: true,
              fee: 0,
            },
          },
        );

        await group.addScore({
          sender: userAddress,
          extraFee: lsigsFee,
          boxReferences: [
            {
              appId: appClient.appId,
              name: buildScoreBoxName(puzzleCodeBytes, userAddress),
            },
          ],
          args: {
            signals,
            proof,
            puzzleCode: puzzleCodeBytes,
            score,
            payMbr: { txn: payMbrTxn, signer: userSigner } as any,
            verifierTxn: { txn: verifierTxn, signer: lsigParams.signer } as any,
          },
        });
      },
    });

    return group;
  }

  test("accepts valid addScore with real lsig path", async () => {
    const { appClient, user, userSigner, verifier } =
      await deployConfiguredApp();
    const { proof, signals, puzzleCodeBytes, score } = getCachedProofBundle();

    const group = await buildAddScoreGroup({
      appClient,
      user,
      userSigner,
      verifier,
      proof,
      signals,
      puzzleCodeBytes,
      score,
    });
    await group.send();

    const [storedScore, exists] = await appClient.getScoreForUser({
      sender: user.addr.toString(),
      args: { puzzleCode: puzzleCodeBytes, user: user.addr.toString() },
    });

    expect(exists).toBe(true);
    expect(storedScore).toBe(score);
  }, 120_000);

  test("rejects addScore when public puzzle limbs do not match puzzleCode argument", async () => {
    const { appClient, user, userSigner, verifier } =
      await deployConfiguredApp();
    const { proof, signals, puzzleCodeBytes, score } = getCachedProofBundle();
    const badSignals = [...signals];
    badSignals[PUZZLE_SIGNAL_START] += 1n;

    const group = await buildAddScoreGroup({
      appClient,
      user,
      userSigner,
      verifier,
      proof,
      signals: badSignals,
      puzzleCodeBytes,
      score,
    });

    await expect(group.send()).rejects.toThrow(
      /public puzzle code must match/i,
    );
  }, 120_000);

  test("rejects addScore when public sender limbs do not match caller", async () => {
    const { appClient, user, userSigner, verifier } =
      await deployConfiguredApp();
    const { proof, signals, puzzleCodeBytes, score } = getCachedProofBundle();
    const badSignals = [...signals];
    badSignals[SENDER_SIGNAL_START] += 1n;

    const group = await buildAddScoreGroup({
      appClient,
      user,
      userSigner,
      verifier,
      proof,
      signals: badSignals,
      puzzleCodeBytes,
      score,
    });

    await expect(group.send()).rejects.toThrow(
      /public sender must match caller/i,
    );
  }, 120_000);

  test("rejects addScore when proof is tampered (fraudulent proof)", async () => {
    const { appClient, user, userSigner, verifier } =
      await deployConfiguredApp();
    const { proof, signals, puzzleCodeBytes, score } = getCachedProofBundle();

    const group = await buildAddScoreGroup({
      appClient,
      user,
      userSigner,
      verifier,
      proof: tamperProof(proof),
      signals,
      puzzleCodeBytes,
      score,
    });

    await expect(group.send()).rejects.toThrow();

    const [storedScore, exists] = await appClient.getScoreForUser({
      sender: user.addr.toString(),
      args: { puzzleCode: puzzleCodeBytes, user: user.addr.toString() },
    });
    expect(exists).toBe(false);
    expect(storedScore).toBe(0n);
  }, 120_000);

  test("rejects addScore when score argument mismatches public score signal", async () => {
    const { appClient, user, userSigner, verifier } =
      await deployConfiguredApp();
    const { proof, signals, puzzleCodeBytes, score } = getCachedProofBundle();
    const mismatchedScore = score + 1n;

    const group = await buildAddScoreGroup({
      appClient,
      user,
      userSigner,
      verifier,
      proof,
      signals,
      puzzleCodeBytes,
      score: mismatchedScore,
    });

    await expect(group.send()).rejects.toThrow(/public score must match/i);
  }, 120_000);

  test("rejects addScore when public score signal is tampered (proof/lsig failure path)", async () => {
    const { appClient, user, userSigner, verifier } =
      await deployConfiguredApp();
    const { proof, signals, puzzleCodeBytes, score } = getCachedProofBundle();

    const tamperedSignals = [...signals];
    tamperedSignals[0] += 1n;
    const tamperedScore = tamperedSignals[0];

    const group = await buildAddScoreGroup({
      appClient,
      user,
      userSigner,
      verifier,
      proof,
      signals: tamperedSignals,
      puzzleCodeBytes,
      score: tamperedScore,
    });

    await expect(group.send()).rejects.toThrow();

    const [storedScore, exists] = await appClient.getScoreForUser({
      sender: user.addr.toString(),
      args: { puzzleCode: puzzleCodeBytes, user: user.addr.toString() },
    });
    expect(exists).toBe(false);
    expect(storedScore).toBe(0n);
  }, 120_000);
});

describe("PuzzleScores sponsored scores (real lsig)", () => {
  const SPONSORED_USER_ID = "123456789012345678";
  const sponsoredUserKey = discordUserKey(SPONSORED_USER_ID);
  let sponsoredBundle: ProofBundle | undefined;
  let sponsoredWorseBundle: ProofBundle | undefined;

  beforeAll(() => {
    Config.configure({ debug: true });
  });

  beforeEach(fixture.newScope, 120_000);

  async function deploySponsoredApp() {
    const { algorand, testAccount } = fixture.context;
    const sponsor = algosdk.generateAccount();
    const sponsorSigner = algosdk.makeBasicAccountTransactionSigner(sponsor);
    algorand.setSigner(sponsor.addr, sponsorSigner);

    await algorand.send.payment({
      sender: testAccount,
      receiver: sponsor.addr,
      amount: microAlgo(2_000_000),
    });

    const verifier = createVerifier(algorand, SPONSORED_TOTAL_LSIGS);
    if (!cachedVerifierAddress) {
      const lsigAccount = await verifier.lsigAccount();
      cachedVerifierAddress = lsigAccount.addr.toString();
    }

    const factory = new PuzzleScoresFactory({
      algorand,
      defaultSender: testAccount,
    });
    const { appClient } = await factory.deploy({
      onUpdate: "append",
      onSchemaBreak: "append",
      suppressLog: true,
    });

    // App account holds its own min balance, the sponsor config box, and the
    // MBR float for sponsored score boxes.
    await algorand.send.payment({
      sender: testAccount,
      receiver: appClient.appAddress,
      amount: microAlgo(1_000_000),
    });

    await appClient.send.setVerifier({
      sender: testAccount,
      args: { verifierAddress: cachedVerifierAddress },
    });
    await appClient.send.setSponsor({
      sender: testAccount,
      args: { sponsorAddress: sponsor.addr.toString() },
    });

    if (!sponsoredBundle) {
      sponsoredBundle = await generateProof(sponsoredUserKey, verifier);
    }

    return { appClient, sponsor, sponsorSigner, verifier, algorand, testAccount };
  }

  async function buildSponsoredGroup(params: {
    appClient: Awaited<ReturnType<typeof deploySponsoredApp>>["appClient"];
    verifier: Groth16Bn254LsigVerifier;
    sender: string;
    operation: "add" | "update";
    bundle: ProofBundle;
    userKey?: Uint8Array;
  }) {
    const { appClient, verifier, sender, operation, bundle } = params;
    const userKey = params.userKey ?? sponsoredUserKey;
    const group = appClient.newGroup();

    await verifier.verificationParams({
      proof: bundle.proof,
      signals: bundle.signals,
      composer: group,
      paramsCallback: async ({ lsigParams, lsigsFee }) => {
        const suggested = await appClient.algorand.client.algod
          .getTransactionParams()
          .do();
        const verifierTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: lsigParams.sender,
          receiver: appClient.appAddress,
          amount: 0,
          suggestedParams: { ...suggested, flatFee: true, fee: 0 },
        });
        const common = {
          sender,
          extraFee: lsigsFee,
          boxReferences: [
            {
              appId: appClient.appId,
              name: buildSponsoredBoxName(bundle.puzzleCodeBytes, userKey),
            },
          ],
        };
        if (operation === "add") {
          await group.addSponsoredScore({
            ...common,
            args: {
              signals: bundle.signals,
              proof: bundle.proof,
              puzzleCode: bundle.puzzleCodeBytes,
              userKey,
              score: bundle.score,
              verifierTxn: { txn: verifierTxn, signer: lsigParams.signer } as any,
            },
          });
        } else {
          await group.updateSponsoredScore({
            ...common,
            args: {
              signals: bundle.signals,
              proof: bundle.proof,
              puzzleCode: bundle.puzzleCodeBytes,
              userKey,
              newScore: bundle.score,
              verifierTxn: { txn: verifierTxn, signer: lsigParams.signer } as any,
            },
          });
        }
      },
    });

    return group;
  }

  test("sponsor can add a sponsored score, improve it, and sweep it", async () => {
    const { appClient, sponsor, verifier, algorand } = await deploySponsoredApp();
    if (!sponsoredWorseBundle) {
      sponsoredWorseBundle = await generateProof(sponsoredUserKey, verifier, {
        detour: true,
      });
    }
    const worse = cloneProofBundle(sponsoredWorseBundle);
    const better = cloneProofBundle(sponsoredBundle!);
    expect(worse.score > better.score).toBe(true);

    const sponsorAddress = sponsor.addr.toString();
    const appInfoBefore = await algorand.client.algod
      .accountInformation(appClient.appAddress)
      .do();

    const addGroup = await buildSponsoredGroup({
      appClient,
      verifier,
      sender: sponsorAddress,
      operation: "add",
      bundle: worse,
    });
    await addGroup.send();

    let [score, updates, exists] = await appClient.getSponsoredScore({
      sender: sponsorAddress,
      args: { puzzleCode: worse.puzzleCodeBytes, userKey: sponsoredUserKey },
    });
    expect(exists).toBe(true);
    expect(score).toBe(worse.score);
    expect(updates).toBe(0n);

    const appInfoAfterAdd = await algorand.client.algod
      .accountInformation(appClient.appAddress)
      .do();
    const sponsoredMbr = await appClient.sponsoredBoxMbr({ args: [] });
    expect(appInfoAfterAdd.minBalance - appInfoBefore.minBalance).toBe(
      sponsoredMbr,
    );

    const updateGroup = await buildSponsoredGroup({
      appClient,
      verifier,
      sender: sponsorAddress,
      operation: "update",
      bundle: better,
    });
    await updateGroup.send();

    [score, updates, exists] = await appClient.getSponsoredScore({
      sender: sponsorAddress,
      args: { puzzleCode: better.puzzleCodeBytes, userKey: sponsoredUserKey },
    });
    expect(exists).toBe(true);
    expect(score).toBe(better.score);
    expect(updates).toBe(1n);

    // A worse score is rejected on update.
    const worseUpdate = await buildSponsoredGroup({
      appClient,
      verifier,
      sender: sponsorAddress,
      operation: "update",
      bundle: worse,
    });
    await expect(worseUpdate.send()).rejects.toThrow(/new score must be better/i);

    await appClient.send.sweepSponsoredScores({
      sender: sponsorAddress,
      args: {
        puzzleCode: better.puzzleCodeBytes,
        userKeys: [sponsoredUserKey, discordUserKey("missing")],
      },
      boxReferences: [
        {
          appId: appClient.appId,
          name: buildSponsoredBoxName(better.puzzleCodeBytes, sponsoredUserKey),
        },
        {
          appId: appClient.appId,
          name: buildSponsoredBoxName(
            better.puzzleCodeBytes,
            discordUserKey("missing"),
          ),
        },
      ],
    });

    [score, updates, exists] = await appClient.getSponsoredScore({
      sender: sponsorAddress,
      args: { puzzleCode: better.puzzleCodeBytes, userKey: sponsoredUserKey },
    });
    expect(exists).toBe(false);

    // Sweeping releases the score box MBR.
    const appInfoAfterSweep = await algorand.client.algod
      .accountInformation(appClient.appAddress)
      .do();
    expect(appInfoAfterSweep.minBalance).toBe(appInfoBefore.minBalance);
  }, 600_000);

  test("rejects sponsored add from a non-sponsor account", async () => {
    const { appClient, verifier, testAccount } = await deploySponsoredApp();
    const group = await buildSponsoredGroup({
      appClient,
      verifier,
      sender: testAccount.addr.toString(),
      operation: "add",
      bundle: cloneProofBundle(sponsoredBundle!),
    });
    await expect(group.send()).rejects.toThrow(
      /only the sponsor can manage sponsored scores/i,
    );
  }, 300_000);

  test("rejects sponsored add when the user key does not match the proof identity", async () => {
    const { appClient, sponsor, verifier } = await deploySponsoredApp();
    const group = await buildSponsoredGroup({
      appClient,
      verifier,
      sender: sponsor.addr.toString(),
      operation: "add",
      bundle: cloneProofBundle(sponsoredBundle!),
      userKey: discordUserKey("someone-else"),
    });
    await expect(group.send()).rejects.toThrow(
      /public sender must match caller/i,
    );
  }, 300_000);
});

describe("PuzzleScores in-place upgrade with a larger global schema", () => {
  beforeEach(fixture.newScope, 120_000);

  test("an app created with the original 1-key schema can be updated to the sponsor schema", async () => {
    const { algorand, testAccount } = fixture.context;
    const factory = new PuzzleScoresFactory({
      algorand,
      defaultSender: testAccount,
    });

    // Simulate the already-deployed MainNet app: same programs would have
    // been the old ones, but the relevant constraint is the schema.
    const { appClient } = await factory.send.create.bare({
      sender: testAccount,
      schema: {
        globalInts: 0,
        globalByteSlices: 1,
        localInts: 0,
        localByteSlices: 0,
      },
    });
    const before = await algorand.client.algod
      .getApplicationByID(appClient.appId)
      .do();
    expect(Number(before.params.globalStateSchema?.numUint)).toBe(0);
    expect(Number(before.params.globalStateSchema?.numByteSlice)).toBe(1);

    await updateAppInPlace(algorand, appClient.appId, testAccount.addr.toString());

    const after = await algorand.client.algod
      .getApplicationByID(appClient.appId)
      .do();
    expect(Number(after.params.globalStateSchema?.numUint)).toBe(1);
    expect(Number(after.params.globalStateSchema?.numByteSlice)).toBe(3);

    // Writing the new globals now succeeds.
    const sponsor = algosdk.generateAccount();
    await appClient.send.setSponsor({
      sender: testAccount,
      args: { sponsorAddress: sponsor.addr.toString() },
    });
    const configured = await appClient.state.global.sponsor();
    expect(configured).toBe(sponsor.addr.toString());
  }, 120_000);
});
