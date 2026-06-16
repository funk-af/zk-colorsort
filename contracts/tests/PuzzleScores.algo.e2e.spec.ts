import {
  type AlgorandClient,
  Config,
  microAlgo,
} from "@algorandfoundation/algokit-utils";
import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import algosdk from "algosdk";
import { Groth16Bn254LsigVerifier } from "snarkjs-algorand";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  PuzzleScoresFactory,
  type Groth16Bn254Proof,
} from "../../src/algorand/PuzzleScoresClient";
import { generatePuzzle } from "../../src/game/generator";
import { solvePuzzle } from "../../src/game/solver";
import { buildColorSortProofInput } from "../../src/zk/prove";

const ZKEY_PATH = "src/zk/build/color_final.zkey";
const WASM_PATH = "src/zk/build/color_js/color.wasm";
const VERIFIER_APP_OFFSET = 1;
const ADD_SCORE_TOTAL_LSIGS = 3;

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

function createVerifier(algorand: AlgorandClient): Groth16Bn254LsigVerifier {
  return new Groth16Bn254LsigVerifier({
    algorand,
    zKey: ZKEY_PATH,
    wasmProver: WASM_PATH,
    appOffset: VERIFIER_APP_OFFSET,
    totalLsigs: ADD_SCORE_TOTAL_LSIGS,
  });
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
  sender: string,
  verifier: Groth16Bn254LsigVerifier,
): Promise<{
  proof: Groth16Bn254Proof;
  signals: bigint[];
  puzzleCodeBytes: Uint8Array;
  score: bigint;
}> {
  const { puzzle } = generatePuzzle(42);
  const { moves } = solvePuzzle(puzzle, { maxNodes: 75_000 });
  if (moves.length === 0) throw new Error("seed 42 puzzle has no solution");

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
