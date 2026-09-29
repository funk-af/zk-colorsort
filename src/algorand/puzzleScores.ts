import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";
import { Groth16Bn254LsigVerifier } from "snarkjs-algorand";
import { PuzzleScoresClient } from "./PuzzleScoresClient";
import {
  MAX_STORED_SCORE,
  VERIFIER_APP_OFFSET,
  addressToIdentity,
  buildScoreBoxName,
  buildSponsoredBoxName,
  bytesEqual,
  bytesToHex,
  composeScoreGroup,
  getExistingScoreFromAlgod,
  getExistingSponsoredScoreFromAlgod,
  getVerifierTotalLsigs,
  innerTxnExtraFee,
  listPuzzleScoresFromAlgod,
  normalizeWitness,
  signalsMatchIdentity,
  sponsoredIdentityLabel,
  type NormalizedWitness,
  type ScoreSaveOperation,
  type SponsoredScoreEntry,
} from "./scoreGroups";
import { puzzleCodeBytes } from "../game/dailyCode";
import type { Move, Puzzle } from "../game/types";
import {
  buildColorSortProofInput,
  colorSortWasmUrl,
  getColorSortZkeyBytes,
  type ProofIdentity,
} from "../zk/prove";
import networks from "../networks.json";

export type { NormalizedWitness } from "./scoreGroups";

interface NetworkContractConfig {
  networkId: string;
  puzzleScoresAppId?: number;
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

interface SponsoredScoreStatusArgs {
  networkId: string;
  algodClient: algosdk.Algodv2;
  userKey: Uint8Array;
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
const scoreStatusInFlight = new Map<string, Promise<ScoreUploadStatus>>();
const scoreSaveInFlight = new Map<string, Promise<SaveScoreResult>>();

type SaveScoreResult = "added" | "updated" | "skipped";
export type ScoreUploadStatus = "needs-upload" | "recorded" | "unavailable";

export interface SponsoredScoreStatus {
  status: ScoreUploadStatus;
  existing: SponsoredScoreEntry | null;
}

export interface PuzzleScoreComparison {
  allScores: number[];
  userScore: number;
  totalScores: number;
  otherPlayersCount: number;
  playersBeaten: number;
  betterThanPercent: number;
  tiedPlayersCount: number;
}

type LsigAccountResult = Awaited<
  ReturnType<Groth16Bn254LsigVerifier["lsigAccount"]>
>;

export interface GeneratedScoreProof {
  normalizedWitness: NormalizedWitness;
  lsigAddress: string;
  /** Cached lsig account — used to skip the second zkey fetch on submit */
  lsigAccountCache: LsigAccountResult;
}

function resolveNetworkId(networkId: string): string {
  const normalized = networkId.toLowerCase();
  return networkConfigs.some((config) => config.networkId === normalized)
    ? normalized
    : "testnet";
}

export function getPuzzleScoresAppId(networkId: string): bigint | null {
  const resolvedNetworkId = resolveNetworkId(networkId);
  const appId = networkConfigs.find(
    (config) => config.networkId === resolvedNetworkId,
  )?.puzzleScoresAppId;

  return typeof appId === "number" && Number.isInteger(appId) && appId > 0
    ? BigInt(appId)
    : null;
}

function toSafeScore(value: bigint): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Builds the Groth16 lsig verifier from the browser-served zkey. `sponsored`
 * groups carry no MBR payment, so they use one more padding lsig.
 */
export async function createGroth16Verifier(
  algorand: ReturnType<typeof AlgorandClient.fromClients>,
  operation: ScoreSaveOperation,
  sponsored = false,
): Promise<Groth16Bn254LsigVerifier> {
  const zkeyBytes = await getColorSortZkeyBytes();

  return new Groth16Bn254LsigVerifier({
    algorand,
    zKey: zkeyBytes,
    wasmProver: colorSortWasmUrl,
    appOffset: VERIFIER_APP_OFFSET,
    totalLsigs: getVerifierTotalLsigs(operation, sponsored),
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

export function parseMoveHistory(moveHistory: string[]): Move[] | null {
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

  const puzzleCode = puzzleCodeBytes(puzzle);
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

  const puzzleCode = puzzleCodeBytes(puzzle);
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

  await client.send.removeScore({
    args: {
      puzzleCode,
    },
    sender,
    extraFee: innerTxnExtraFee(suggestedParams.minFee),
    boxReferences: [{ appId, name: buildScoreBoxName(puzzleCode, sender) }],
  });

  return true;
}

interface GenerateScoreProofArgs {
  networkId: string;
  algodClient: algosdk.Algodv2;
  /** Wallet address, or a 32-byte user key for sponsored submissions. */
  sender: ProofIdentity;
  puzzle: Puzzle;
  moveHistory: string[];
  score: number;
  /** Sponsored submissions use one more padding lsig than wallet adds. */
  sponsored?: boolean;
}

export async function generateScoreProof({
  networkId,
  algodClient,
  sender,
  puzzle,
  moveHistory,
  score,
  sponsored = false,
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
  const verifier = await createGroth16Verifier(algorand, "add", sponsored);

  const witness = await verifier.proofAndSignals(
    buildColorSortProofInput(puzzle, moves, sender),
  );
  const lsigAccount = await verifier.lsigAccount();

  const normalizedWitness = normalizeWitness(witness, BigInt(score));

  return {
    normalizedWitness,
    lsigAddress: String(lsigAccount.addr),
    lsigAccountCache: lsigAccount,
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
  const verifier = await createGroth16Verifier(algorand, saveOperation);

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

  const cachedLsigAccount =
    precomputedProof?.lsigAccountCache ?? (await verifier.lsigAccount());
  const verifierAddress = String(cachedLsigAccount.addr);
  const cachedVerifier = verifier as typeof verifier & {
    lsigAccount: () => Promise<typeof cachedLsigAccount>;
  };
  cachedVerifier.lsigAccount = async () => cachedLsigAccount;

  if (configuredVerifier !== verifierAddress) {
    throw new Error(
      "PuzzleScores verifier does not match the local Groth16 lsig",
    );
  }

  const nextScore = BigInt(score);
  if (!bytesEqual(normalizedWitness.puzzleCode, puzzleCode)) {
    throw new Error("Proof puzzle does not match submission puzzle");
  }
  if (!signalsMatchIdentity(normalizedWitness.signals, addressToIdentity(sender))) {
    throw new Error("Proof sender does not match submission sender");
  }

  if (existingScore !== null && nextScore >= existingScore) {
    return "skipped";
  }

  let mbr: number | undefined;
  if (saveOperation === "add") {
    const mbrResult = await client.send.boxMbr({ sender, args: [] });
    mbr = Number(mbrResult.return ?? 0n);
    if (!Number.isSafeInteger(mbr) || mbr <= 0) {
      throw new Error("Unable to calculate box MBR amount");
    }
  }

  const group = await withTimeout(
    `composing ${saveOperation} verification transactions`,
    composeScoreGroup({
      client,
      algodClient,
      verifier,
      operation: saveOperation,
      witness: normalizedWitness,
      score: nextScore,
      sender,
      signer,
      mbr,
    }),
    90_000,
  );

  await withTimeout(
    `sending ${saveOperation} transaction group`,
    group.send(),
    120_000,
  );

  return saveOperation === "add" ? "added" : "updated";
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

  const puzzleCode = puzzleCodeBytes(puzzle);
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

/**
 * Status of a sponsored (Discord-keyed) score for a puzzle. Unlike wallet
 * scores, sponsored entries also carry an update counter that caps how many
 * improvements the sponsor will pay for.
 */
export async function getSponsoredScoreStatusOnChain({
  networkId,
  algodClient,
  userKey,
  puzzle,
  score,
}: SponsoredScoreStatusArgs): Promise<SponsoredScoreStatus> {
  const appId = getPuzzleScoresAppId(networkId);
  const puzzleCode = puzzleCodeBytes(puzzle);
  if (!appId || !puzzleCode) {
    return { status: "unavailable", existing: null };
  }

  const existing = await getExistingSponsoredScoreFromAlgod(
    algodClient,
    appId,
    buildSponsoredBoxName(puzzleCode, userKey),
  );
  const compareScore =
    Number.isInteger(score) && score > 0 ? BigInt(score) : null;

  if (existing === null) {
    return { status: "needs-upload", existing };
  }
  if (compareScore === null) {
    return { status: "recorded", existing };
  }
  return {
    status: compareScore < existing.score ? "needs-upload" : "recorded",
    existing,
  };
}

export async function getPuzzleScoreComparisonOnChain({
  networkId,
  algodClient,
  sender,
  userKey,
  puzzle,
}: {
  networkId: string;
  algodClient: algosdk.Algodv2;
  /** Wallet address whose score to compare (ignored when userKey is set). */
  sender?: string;
  /** Sponsored user key whose score to compare. */
  userKey?: Uint8Array;
  puzzle: Puzzle;
}): Promise<PuzzleScoreComparison | null> {
  const appId = getPuzzleScoresAppId(networkId);
  if (!appId || appId > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  const puzzleCode = puzzleCodeBytes(puzzle);
  if (!puzzleCode) {
    return null;
  }

  const identity = userKey ? sponsoredIdentityLabel(userKey) : sender;
  if (!identity) {
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
    if (entry.identity === identity) {
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
