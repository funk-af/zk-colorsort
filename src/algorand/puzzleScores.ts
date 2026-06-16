import { AlgorandClient, microAlgo } from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";
import { Groth16Bn254LsigVerifier } from "snarkjs-algorand";
import { PuzzleScoresClient } from "./PuzzleScoresClient";
import { encodePuzzle } from "../game/serialize";
import type { Move, Puzzle } from "../game/types";
import { asBytes, concatBytes, startsWithBytes } from "../utils/bytes";
import {
  buildColorSortProofInput,
  colorSortWasmUrl,
  colorSortZkeyUrl,
} from "../zk/prove";
import networks from "../networks.json";

interface NetworkContractConfig {
  networkId: string;
  puzzleScoresAppId?: number;
}

interface Groth16Bn254Proof {
  piA: Uint8Array;
  piB: Uint8Array;
  piC: Uint8Array;
}

interface SaveScoreOnChainArgs {
  networkId: string;
  algodClient: algosdk.Algodv2;
  sender: string;
  signer: algosdk.TransactionSigner;
  puzzle: Puzzle;
  moveHistory: string[];
  score: number;
  precomputedProof?: GeneratedScoreProof;
  requirePrecomputedProof?: boolean;
}

interface ScoreUploadStatusArgs {
  networkId: string;
  algodClient: algosdk.Algodv2;
  sender: string;
  puzzle: Puzzle;
  score: number;
}

interface RemoveScoreOnChainArgs {
  networkId: string;
  algodClient: algosdk.Algodv2;
  sender: string;
  signer: algosdk.TransactionSigner;
  puzzle: Puzzle;
}

const networkConfigs = networks as NetworkContractConfig[];
const ADDRESS_BYTE_LENGTH = 32;
const PUZZLE_CODE_BYTE_LENGTH = 20;
const SCORE_BYTE_LENGTH = 1;
const MAX_STORED_SCORE = 255;
const SCORE_KEY_BYTE_LENGTH = PUZZLE_CODE_BYTE_LENGTH + ADDRESS_BYTE_LENGTH;
const PUZZLE_LIMB_WIDTHS = [8, 8, 4] as const;
const SENDER_LIMB_WIDTHS = [8, 8, 8, 8] as const;
const SCORE_SIGNAL_INDEX = 0;
const PUZZLE_SIGNAL_START = 1;
const SENDER_SIGNAL_START = PUZZLE_SIGNAL_START + PUZZLE_LIMB_WIDTHS.length;
const PUBLIC_SIGNAL_COUNT =
  1 + PUZZLE_LIMB_WIDTHS.length + SENDER_LIMB_WIDTHS.length;
const VERIFIER_APP_OFFSET = 1;
const ADD_SCORE_VERIFIER_TOTAL_LSIGS = 3;
const UPDATE_SCORE_VERIFIER_TOTAL_LSIGS = 4;
const scoreStatusInFlight = new Map<string, Promise<ScoreUploadStatus>>();
const scoreSaveInFlight = new Map<string, Promise<SaveScoreResult>>();

type SaveScoreResult = "added" | "updated" | "skipped";
type ScoreUploadStatus = "needs-upload" | "recorded" | "unavailable";

export interface PuzzleScoreComparison {
  allScores: number[];
  userScore: number;
  totalScores: number;
  otherPlayersCount: number;
  playersBeaten: number;
  betterThanPercent: number;
  tiedPlayersCount: number;
}

type BoxValueResponse = {
  value?: string | Uint8Array;
  box?: { value?: string | Uint8Array };
  "application-box"?: { value?: string | Uint8Array };
};

type BoxListItem = {
  name: string | Uint8Array;
};

type BoxListResponse = {
  boxes?: BoxListItem[];
};

interface PuzzleScoreEntry {
  address: string;
  score: bigint;
}

export interface NormalizedWitness {
  proof: Groth16Bn254Proof;
  signals: bigint[];
  puzzleCode: Uint8Array;
}

export interface GeneratedScoreProof {
  normalizedWitness: NormalizedWitness;
  lsigAddress: string;
}

type ScoreSaveOperation = "add" | "update";

function resolveNetworkId(networkId: string): string {
  const normalized = networkId.toLowerCase();
  return networkConfigs.some((config) => config.networkId === normalized)
    ? normalized
    : "testnet";
}

function getPuzzleScoresAppId(networkId: string): bigint | null {
  const resolvedNetworkId = resolveNetworkId(networkId);
  const appId = networkConfigs.find(
    (config) => config.networkId === resolvedNetworkId,
  )?.puzzleScoresAppId;

  return typeof appId === "number" && Number.isInteger(appId) && appId > 0
    ? BigInt(appId)
    : null;
}

function decodeBase64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getPuzzleCodeBytes(puzzle: Puzzle): Uint8Array | null {
  try {
    const encoded = encodePuzzle(puzzle);
    const bytes = decodeBase64UrlToBytes(encoded);
    return bytes.length === PUZZLE_CODE_BYTE_LENGTH ? bytes : null;
  } catch {
    return null;
  }
}

function toSafeScore(value: bigint): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function buildScoreBoxName(puzzleCode: Uint8Array, sender: string): Uint8Array {
  const addressBytes = algosdk.decodeAddress(sender).publicKey;
  return concatBytes([puzzleCode, addressBytes]);
}

function getVerifierTotalLsigs(operation: ScoreSaveOperation): number {
  return operation === "update"
    ? UPDATE_SCORE_VERIFIER_TOTAL_LSIGS
    : ADD_SCORE_VERIFIER_TOTAL_LSIGS;
}

function createGroth16Verifier(
  algorand: ReturnType<typeof AlgorandClient.fromClients>,
  operation: ScoreSaveOperation,
): Groth16Bn254LsigVerifier {
  return new Groth16Bn254LsigVerifier({
    algorand,
    zKey: colorSortZkeyUrl,
    wasmProver: colorSortWasmUrl,
    appOffset: VERIFIER_APP_OFFSET,
    totalLsigs: getVerifierTotalLsigs(operation),
  });
}

function parseStoredMove(value: string): Move | null {
  const match = /^(\d+):(\d+)$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const from = Number(match[1]);
  const to = Number(match[2]);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from <= 0 ||
    to <= 0
  ) {
    return null;
  }

  return {
    from: from - 1,
    to: to - 1,
  };
}

function parseMoveHistory(moveHistory: string[]): Move[] | null {
  const moves: Move[] = [];
  for (const value of moveHistory) {
    const move = parseStoredMove(value);
    if (!move) {
      return null;
    }
    moves.push(move);
  }
  return moves;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function packBytesToLimbs(
  bytes: Uint8Array,
  widths: readonly number[],
): bigint[] {
  const limbs: bigint[] = [];
  let offset = 0;
  for (const width of widths) {
    let limb = 0n;
    for (let i = 0; i < width; i += 1) {
      limb = (limb << 8n) | BigInt(bytes[offset + i] ?? 0);
    }
    limbs.push(limb);
    offset += width;
  }
  return limbs;
}

function unpackLimbsToBytes(
  limbs: readonly bigint[],
  widths: readonly number[],
): Uint8Array | null {
  if (limbs.length !== widths.length) {
    return null;
  }

  const totalBytes = widths.reduce((sum, width) => sum + width, 0);
  const result = new Uint8Array(totalBytes);
  let offset = 0;

  for (let limbIndex = 0; limbIndex < widths.length; limbIndex += 1) {
    const width = widths[limbIndex];
    const limb = limbs[limbIndex];
    if (limb < 0n || limb >= 1n << BigInt(width * 8)) {
      return null;
    }

    let value = limb;
    for (let i = width - 1; i >= 0; i -= 1) {
      result[offset + i] = Number(value & 0xffn);
      value >>= 8n;
    }
    offset += width;
  }

  return result;
}

function signalsMatchSender(signals: bigint[], sender: string): boolean {
  const expectedSender = packBytesToLimbs(
    algosdk.decodeAddress(sender).publicKey,
    SENDER_LIMB_WIDTHS,
  );

  const outputFirstMatch = expectedSender.every(
    (value, index) => signals[SENDER_SIGNAL_START + index] === value,
  );
  if (outputFirstMatch) {
    return true;
  }

  const outputLastStart = PUZZLE_LIMB_WIDTHS.length;
  return expectedSender.every(
    (value, index) => signals[outputLastStart + index] === value,
  );
}

async function withTimeout<T>(
  stage: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `Timed out while ${stage} after ${Math.round(timeoutMs / 1000)}s`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function normalizeWitness(witness: unknown, score: bigint): NormalizedWitness {
  const rawWitness = witness as {
    proof?: Partial<Groth16Bn254Proof> & {
      pi_aBytes?: Uint8Array;
      pi_bBytes?: Uint8Array;
      pi_cBytes?: Uint8Array;
    };
    signals?: Array<string | number | bigint | undefined>;
  };

  const proof = rawWitness?.proof;
  if (!proof) {
    throw new Error("Verifier witness proof is missing");
  }

  const piA = proof.piA ?? proof.pi_aBytes;
  const piB = proof.piB ?? proof.pi_bBytes;
  const piC = proof.piC ?? proof.pi_cBytes;

  if (!(piA instanceof Uint8Array) || piA.length !== 64) {
    throw new Error("Verifier proof piA is invalid");
  }
  if (!(piB instanceof Uint8Array) || piB.length !== 128) {
    throw new Error("Verifier proof piB is invalid");
  }
  if (!(piC instanceof Uint8Array) || piC.length !== 64) {
    throw new Error("Verifier proof piC is invalid");
  }

  const rawSignals = rawWitness?.signals;
  if (!Array.isArray(rawSignals) || rawSignals.length === 0) {
    throw new Error("Verifier witness signals are missing");
  }

  const signals = rawSignals.map((value, index) => {
    if (value === undefined || value === null) {
      throw new Error(`Verifier signal ${index} is missing`);
    }
    return BigInt(value);
  });

  const validateLayout = (
    candidate: bigint[],
    scoreIndex: number,
    puzzleStart: number,
    senderStart: number,
  ): Uint8Array | null => {
    if (candidate.length < PUBLIC_SIGNAL_COUNT) {
      return null;
    }

    if (candidate[scoreIndex] !== score) {
      return null;
    }

    const puzzleLimbs = candidate.slice(
      puzzleStart,
      puzzleStart + PUZZLE_LIMB_WIDTHS.length,
    );
    const senderLimbs = candidate.slice(
      senderStart,
      senderStart + SENDER_LIMB_WIDTHS.length,
    );

    if (
      puzzleLimbs.length !== PUZZLE_LIMB_WIDTHS.length ||
      senderLimbs.length !== SENDER_LIMB_WIDTHS.length
    ) {
      return null;
    }

    if (senderLimbs.some((value) => value < 0n || value >= 1n << 64n)) {
      return null;
    }

    return unpackLimbsToBytes(puzzleLimbs, PUZZLE_LIMB_WIDTHS);
  };

  const outputFirstPuzzle = validateLayout(
    signals,
    SCORE_SIGNAL_INDEX,
    PUZZLE_SIGNAL_START,
    SENDER_SIGNAL_START,
  );
  if (outputFirstPuzzle) {
    return {
      proof: { piA, piB, piC },
      signals,
      puzzleCode: outputFirstPuzzle,
    };
  }

  const outputLastPuzzle = validateLayout(
    signals,
    PUBLIC_SIGNAL_COUNT - 1,
    0,
    PUZZLE_LIMB_WIDTHS.length,
  );
  if (outputLastPuzzle) {
    return {
      proof: { piA, piB, piC },
      signals,
      puzzleCode: outputLastPuzzle,
    };
  }

  throw new Error(
    "Verifier witness signals do not match expected public layout",
  );
}

async function getExistingScoreFromAlgod(
  algodClient: algosdk.Algodv2,
  appId: bigint,
  scoreBoxName: Uint8Array,
): Promise<bigint | null> {
  try {
    const boxResponse = (await algodClient
      .getApplicationBoxByName(Number(appId), scoreBoxName)
      .do()) as BoxValueResponse;

    const valueBase64 =
      boxResponse.value ??
      boxResponse.box?.value ??
      boxResponse["application-box"]?.value;

    if (!valueBase64) {
      return null;
    }

    const valueBytes = asBytes(valueBase64);
    if (valueBytes.length !== SCORE_BYTE_LENGTH) {
      return null;
    }

    return BigInt(valueBytes[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("box not found") ||
      message.includes("404") ||
      message.includes("not found")
    ) {
      return null;
    }

    throw error;
  }
}

async function listPuzzleScoresFromAlgod(
  algodClient: algosdk.Algodv2,
  appId: bigint,
  puzzleCode: Uint8Array,
): Promise<PuzzleScoreEntry[]> {
  const entries: PuzzleScoreEntry[] = [];
  const response = (await algodClient
    .getApplicationBoxes(Number(appId))
    .do()) as BoxListResponse;

  for (const box of response.boxes ?? []) {
    const boxNameBytes = asBytes(box.name);
    if (!startsWithBytes(boxNameBytes, puzzleCode)) {
      continue;
    }

    if (boxNameBytes.length !== SCORE_KEY_BYTE_LENGTH) {
      continue;
    }

    const addressBytes = boxNameBytes.slice(
      PUZZLE_CODE_BYTE_LENGTH,
      SCORE_KEY_BYTE_LENGTH,
    );

    let address: string;
    try {
      address = algosdk.encodeAddress(addressBytes);
    } catch {
      continue;
    }

    const score = await getExistingScoreFromAlgod(
      algodClient,
      appId,
      boxNameBytes,
    );
    if (score === null) {
      continue;
    }

    entries.push({
      address,
      score,
    });
  }

  entries.sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0));
  return entries;
}

export async function saveScoreOnChain({
  networkId,
  algodClient,
  sender,
  signer,
  puzzle,
  moveHistory,
  score,
  precomputedProof,
  requirePrecomputedProof,
}: SaveScoreOnChainArgs): Promise<SaveScoreResult> {
  if (!Number.isInteger(score) || score <= 0 || score > MAX_STORED_SCORE) {
    return "skipped";
  }

  const moves = parseMoveHistory(moveHistory);
  if (!moves || moves.length !== score) {
    return "skipped";
  }

  const appId = getPuzzleScoresAppId(networkId);
  if (!appId) {
    return "skipped";
  }

  const puzzleCode = getPuzzleCodeBytes(puzzle);
  if (!puzzleCode) {
    return "skipped";
  }

  const saveRequestKey = [
    resolveNetworkId(networkId),
    sender,
    appId.toString(),
    bytesToHex(puzzleCode),
    score.toString(),
  ].join(":");

  const existingSave = scoreSaveInFlight.get(saveRequestKey);
  if (existingSave) {
    if (import.meta.env.DEV) {
      console.debug("[score-save] deduped", { saveRequestKey });
    }
    return existingSave;
  }

  const saveRequest = performScoreSave(
    networkId,
    algodClient,
    sender,
    signer,
    appId,
    puzzleCode,
    puzzle,
    moves,
    score,
    precomputedProof,
    requirePrecomputedProof,
  );

  scoreSaveInFlight.set(saveRequestKey, saveRequest);
  try {
    return await saveRequest;
  } finally {
    scoreSaveInFlight.delete(saveRequestKey);
  }
}

export async function removeScoreOnChain({
  networkId,
  algodClient,
  sender,
  signer,
  puzzle,
}: RemoveScoreOnChainArgs): Promise<boolean> {
  const appId = getPuzzleScoresAppId(networkId);
  if (!appId) {
    return false;
  }

  const puzzleCode = getPuzzleCodeBytes(puzzle);
  if (!puzzleCode) {
    return false;
  }

  const algorand = AlgorandClient.fromClients({ algod: algodClient }).setSigner(
    sender,
    signer,
  );

  const client = new PuzzleScoresClient({
    appId,
    algorand,
    defaultSender: sender,
  });

  const suggestedParams = await algodClient.getTransactionParams().do();
  const minFee = suggestedParams.minFee ?? 1000n;

  await client.send.removeScore({
    args: {
      puzzleCode,
    },
    sender,
    extraFee: microAlgo(minFee),
    boxReferences: [{ appId, name: buildScoreBoxName(puzzleCode, sender) }],
  });

  return true;
}

interface GenerateScoreProofArgs {
  networkId: string;
  algodClient: algosdk.Algodv2;
  sender: string;
  puzzle: Puzzle;
  moveHistory: string[];
  score: number;
}

export async function generateScoreProof({
  networkId,
  algodClient,
  sender,
  puzzle,
  moveHistory,
  score,
}: GenerateScoreProofArgs): Promise<GeneratedScoreProof> {
  if (!Number.isInteger(score) || score <= 0 || score > MAX_STORED_SCORE) {
    throw new Error(
      `Score must be a positive integer no greater than ${MAX_STORED_SCORE}`,
    );
  }

  const moves = parseMoveHistory(moveHistory);
  if (!moves || moves.length !== score) {
    throw new Error("Move history must contain exactly one entry per score");
  }

  const resolvedNetworkId = resolveNetworkId(networkId);
  const appId = getPuzzleScoresAppId(resolvedNetworkId);
  if (!appId) {
    throw new Error(
      `PuzzleScores contract is unavailable on ${resolvedNetworkId}`,
    );
  }

  const algorand = AlgorandClient.fromClients({ algod: algodClient });
  const verifier = createGroth16Verifier(algorand, "add");

  const [lsigAccount, witness] = await Promise.all([
    verifier.lsigAccount(),
    verifier.proofAndSignals(buildColorSortProofInput(puzzle, moves, sender)),
  ]);

  const normalizedWitness = normalizeWitness(witness, BigInt(score));

  return {
    normalizedWitness,
    lsigAddress: String(lsigAccount.addr),
  };
}

async function performScoreSave(
  networkId: string,
  algodClient: algosdk.Algodv2,
  sender: string,
  signer: algosdk.TransactionSigner,
  appId: bigint,
  puzzleCode: Uint8Array,
  puzzle: Puzzle,
  moves: Move[],
  score: number,
  precomputedProof?: GeneratedScoreProof,
  requirePrecomputedProof?: boolean,
): Promise<SaveScoreResult> {
  if (import.meta.env.DEV) {
    console.debug("[score-save] request", {
      saveRequestKey: [
        resolveNetworkId(networkId),
        sender,
        appId.toString(),
        bytesToHex(puzzleCode),
        score.toString(),
      ].join(":"),
    });
  }

  const algorand = AlgorandClient.fromClients({ algod: algodClient }).setSigner(
    sender,
    signer,
  );

  const client = new PuzzleScoresClient({
    appId,
    algorand,
    defaultSender: sender,
  });

  const requestedScoreBoxName = buildScoreBoxName(puzzleCode, sender);
  const existingScore = await getExistingScoreFromAlgod(
    algodClient,
    appId,
    requestedScoreBoxName,
  );
  const saveOperation: ScoreSaveOperation =
    existingScore === null ? "add" : "update";
  const verifier = createGroth16Verifier(algorand, saveOperation);

  const configuredVerifier = await client.state.global.verifier();

  if (!configuredVerifier) {
    return "skipped";
  }

  if (requirePrecomputedProof && !precomputedProof) {
    throw new Error("Missing precomputed proof for score submission");
  }

  let normalizedWitness: NormalizedWitness;
  if (precomputedProof) {
    normalizedWitness = precomputedProof.normalizedWitness;
  } else {
    if (import.meta.env.DEV) {
      console.debug("[score-save] generating proof inline");
    }
    const witness = await verifier.proofAndSignals(
      buildColorSortProofInput(puzzle, moves, sender),
    );
    normalizedWitness = normalizeWitness(witness, BigInt(score));
  }

  const lsigAccount = await verifier.lsigAccount();
  const verifierAddress = String(lsigAccount.addr);
  const cachedVerifier = verifier as typeof verifier & {
    lsigAccount: () => Promise<typeof lsigAccount>;
  };
  cachedVerifier.lsigAccount = async () => lsigAccount;

  if (configuredVerifier !== verifierAddress) {
    throw new Error(
      "PuzzleScores verifier does not match the local Groth16 lsig",
    );
  }

  const nextScore = BigInt(score);
  const onChainPuzzleCode = normalizedWitness.puzzleCode;
  if (!bytesEqual(onChainPuzzleCode, puzzleCode)) {
    throw new Error("Proof puzzle does not match submission puzzle");
  }
  if (!signalsMatchSender(normalizedWitness.signals, sender)) {
    throw new Error("Proof sender does not match submission sender");
  }
  const scoreBoxName = buildScoreBoxName(onChainPuzzleCode, sender);

  if (existingScore !== null) {
    if (nextScore >= existingScore) {
      return "skipped";
    }

    const updateGroup = client.newGroup();

    await withTimeout(
      "composing update verification transactions",
      verifier.verificationParams({
        proof: normalizedWitness.proof,
        signals: normalizedWitness.signals,
        composer: updateGroup,
        paramsCallback: async ({ lsigParams, lsigsFee }) => {
          const updateSuggestedParams = await algodClient
            .getTransactionParams()
            .do();
          const updateVerifierTxn =
            algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              sender: lsigParams.sender,
              receiver: client.appAddress,
              amount: 0,
              suggestedParams: {
                ...updateSuggestedParams,
                fee: 0,
                flatFee: true,
              },
            });

          if (import.meta.env.DEV) {
            console.debug("[score-save] update tx fees", {
              minFee: updateSuggestedParams.minFee,
              lsigsFee,
              appCallExtraFee: lsigsFee,
              verifierFee: updateVerifierTxn.fee,
              totalLsigs: getVerifierTotalLsigs("update"),
            });
          }

          await updateGroup.updateScore({
            args: {
              signals: normalizedWitness.signals,
              proof: normalizedWitness.proof,
              puzzleCode: onChainPuzzleCode,
              newScore: nextScore,
              verifierTxn: {
                txn: updateVerifierTxn,
                signer: lsigParams.signer,
              } as any,
            },
            sender,
            extraFee: lsigsFee,
            boxReferences: [{ appId, name: scoreBoxName }],
          });
        },
      }),
      90_000,
    );

    await withTimeout(
      "sending update transaction group",
      updateGroup.send(),
      120_000,
    );

    return "updated";
  }

  const mbrResult = await client.send.boxMbr({ sender, args: [] });
  const mbr = Number(mbrResult.return ?? 0n);
  if (!Number.isSafeInteger(mbr) || mbr <= 0) {
    throw new Error("Unable to calculate box MBR amount");
  }

  const addGroup = client.newGroup();

  await withTimeout(
    "composing add verification transactions",
    verifier.verificationParams({
      proof: normalizedWitness.proof,
      signals: normalizedWitness.signals,
      composer: addGroup,
      paramsCallback: async ({ lsigParams, lsigsFee }) => {
        const suggestedParams = await algodClient.getTransactionParams().do();
        const verifierTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject(
          {
            sender: lsigParams.sender,
            receiver: client.appAddress,
            amount: 0,
            suggestedParams: {
              ...suggestedParams,
              fee: 0,
              flatFee: true,
            },
          },
        );
        const payMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender,
          receiver: client.appAddress,
          amount: mbr,
          suggestedParams,
        });

        if (import.meta.env.DEV) {
          console.debug("[score-save] add tx fees", {
            minFee: suggestedParams.minFee,
            lsigsFee,
            appCallExtraFee: lsigsFee,
            payMbrFee: payMbr.fee,
            verifierFee: verifierTxn.fee,
            payMbrAmount: mbr,
            totalLsigs: getVerifierTotalLsigs("add"),
          });
        }

        await addGroup.addScore({
          args: {
            signals: normalizedWitness.signals,
            proof: normalizedWitness.proof,
            puzzleCode: onChainPuzzleCode,
            score: nextScore,
            payMbr: {
              txn: payMbr,
              signer,
            } as any,
            verifierTxn: {
              txn: verifierTxn,
              signer: lsigParams.signer,
            } as any,
          },
          sender,
          extraFee: lsigsFee,
          boxReferences: [{ appId, name: scoreBoxName }],
        });
      },
    }),
    90_000,
  );

  await withTimeout("sending add transaction group", addGroup.send(), 120_000);

  return "added";
}

export async function getScoreUploadStatusOnChain({
  networkId,
  algodClient,
  sender,
  puzzle,
  score,
}: ScoreUploadStatusArgs): Promise<ScoreUploadStatus> {
  const compareScore =
    Number.isInteger(score) && score > 0 ? BigInt(score) : null;

  const appId = getPuzzleScoresAppId(networkId);
  if (!appId) {
    return "unavailable";
  }

  const puzzleCode = getPuzzleCodeBytes(puzzle);
  if (!puzzleCode) {
    return "unavailable";
  }

  const requestKey = [
    resolveNetworkId(networkId),
    sender,
    appId.toString(),
    bytesToHex(puzzleCode),
    compareScore?.toString() ?? "none",
  ].join(":");

  const existingRequest = scoreStatusInFlight.get(requestKey);
  if (existingRequest) {
    if (import.meta.env.DEV) {
      console.debug("[score-check] deduped", { requestKey });
    }
    return existingRequest;
  }

  const request = (async () => {
    if (import.meta.env.DEV) {
      console.debug("[score-check] request", { requestKey });
    }
    const scoreBoxName = buildScoreBoxName(puzzleCode, sender);

    const existingScore = await getExistingScoreFromAlgod(
      algodClient,
      appId,
      scoreBoxName,
    );
    if (existingScore === null) {
      return "needs-upload";
    }

    if (compareScore === null) {
      return "recorded";
    }

    return compareScore < existingScore ? "needs-upload" : "recorded";
  })();

  scoreStatusInFlight.set(requestKey, request);
  try {
    return await request;
  } finally {
    scoreStatusInFlight.delete(requestKey);
  }
}

export async function getPuzzleScoreComparisonOnChain({
  networkId,
  algodClient,
  sender,
  puzzle,
}: {
  networkId: string;
  algodClient: algosdk.Algodv2;
  sender: string;
  puzzle: Puzzle;
}): Promise<PuzzleScoreComparison | null> {
  const appId = getPuzzleScoresAppId(networkId);
  if (!appId || appId > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  const puzzleCode = getPuzzleCodeBytes(puzzle);
  if (!puzzleCode) {
    return null;
  }

  const entries = await listPuzzleScoresFromAlgod(
    algodClient,
    appId,
    puzzleCode,
  );
  if (entries.length === 0) {
    return null;
  }

  const allScores: number[] = [];
  let userScore: number | null = null;

  for (const entry of entries) {
    const numericScore = toSafeScore(entry.score);
    if (numericScore === null) {
      continue;
    }

    allScores.push(numericScore);
    if (entry.address === sender) {
      userScore = numericScore;
    }
  }

  if (userScore === null || allScores.length === 0) {
    return null;
  }

  const otherPlayersCount = Math.max(allScores.length - 1, 0);
  const playersBeaten = allScores.filter((score) => score > userScore).length;
  const tiedPlayersCount = Math.max(
    allScores.filter((score) => score === userScore).length - 1,
    0,
  );
  const betterThanPercent =
    otherPlayersCount > 0
      ? Math.round((playersBeaten / otherPlayersCount) * 100)
      : 0;

  return {
    allScores,
    userScore,
    totalScores: allScores.length,
    otherPlayersCount,
    playersBeaten,
    betterThanPercent,
    tiedPlayersCount,
  };
}
