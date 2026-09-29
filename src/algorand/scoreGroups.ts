/**
 * Shared, environment-neutral pieces of the PuzzleScores submission flow.
 *
 * This module must stay free of Vite-only imports (no `?url` assets, no
 * `import.meta.env`) because it is used by the browser app, the Netlify
 * functions that sponsor Discord submissions, and the contract e2e tests.
 */
import { microAlgo } from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";
import type { Groth16Bn254LsigVerifier } from "snarkjs-algorand";
import type { PuzzleScoresClient } from "./PuzzleScoresClient";
import {
  USER_KEY_BYTE_LENGTH,
  bytesToHex,
  discordUserKey,
  sponsoredIdentityLabel,
} from "./identity";
import { asBytes, concatBytes } from "../utils/bytes";

export { USER_KEY_BYTE_LENGTH, bytesToHex, discordUserKey, sponsoredIdentityLabel };

export interface Groth16Bn254Proof {
  piA: Uint8Array;
  piB: Uint8Array;
  piC: Uint8Array;
}

export interface NormalizedWitness {
  proof: Groth16Bn254Proof;
  signals: bigint[];
  puzzleCode: Uint8Array;
}

/** JSON-safe form of a normalized witness, used as the sponsor API payload. */
export interface SerializedWitness {
  proof: { piA: string; piB: string; piC: string };
  signals: string[];
  puzzleCode: string;
}

export type ScoreSaveOperation = "add" | "update";

export const ADDRESS_BYTE_LENGTH = 32;
export const PUZZLE_CODE_BYTE_LENGTH = 20;
export const SCORE_BYTE_LENGTH = 1;
export const SPONSORED_VALUE_BYTE_LENGTH = 2;
export const MAX_STORED_SCORE = 255;
export const MAX_SPONSORED_UPDATES = 8;
export const SCORE_KEY_BYTE_LENGTH =
  PUZZLE_CODE_BYTE_LENGTH + ADDRESS_BYTE_LENGTH;
export const SPONSORED_PREFIX = new Uint8Array([0x73]); // "s"
export const SPONSORED_KEY_BYTE_LENGTH =
  SPONSORED_PREFIX.length + PUZZLE_CODE_BYTE_LENGTH + USER_KEY_BYTE_LENGTH;

export const PUZZLE_LIMB_WIDTHS = [8, 8, 4] as const;
export const IDENTITY_LIMB_WIDTHS = [8, 8, 8, 8] as const;
export const SCORE_SIGNAL_INDEX = 0;
export const PUZZLE_SIGNAL_START = 1;
export const IDENTITY_SIGNAL_START =
  PUZZLE_SIGNAL_START + PUZZLE_LIMB_WIDTHS.length;
export const PUBLIC_SIGNAL_COUNT =
  1 + PUZZLE_LIMB_WIDTHS.length + IDENTITY_LIMB_WIDTHS.length;

export const VERIFIER_APP_OFFSET = 1;
// The Groth16 BN254 verifier lsig consumes ~77.6k opcode budget. LogicSig budget
// is pooled as (group size * 20_000) across *every* txn in the group, including
// the app call and MBR payment, so each group needs 4 txns in total:
//   wallet add:    payMbr + verifier + appCall + 1 extra lsig
//   wallet update: verifier + appCall + 2 extra lsigs
//   sponsored:     verifier + appCall + 2 extra lsigs (no MBR payment txn)
// totalLsigs counts the verifier itself plus the extra padding lsigs.
export const ADD_SCORE_VERIFIER_TOTAL_LSIGS = 2;
export const UPDATE_SCORE_VERIFIER_TOTAL_LSIGS = 3;
export const SPONSORED_VERIFIER_TOTAL_LSIGS = 3;

export function getVerifierTotalLsigs(
  operation: ScoreSaveOperation,
  sponsored = false,
): number {
  if (sponsored) {
    return SPONSORED_VERIFIER_TOTAL_LSIGS;
  }
  return operation === "update"
    ? UPDATE_SCORE_VERIFIER_TOTAL_LSIGS
    : ADD_SCORE_VERIFIER_TOTAL_LSIGS;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
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

export function bytesToBase64(bytes: Uint8Array): string {
  return algosdk.bytesToBase64(bytes);
}

export function base64ToBytes(value: string): Uint8Array {
  return algosdk.base64ToBytes(value);
}

export function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return algosdk.base64ToBytes(padded);
}

export function packBytesToLimbs(
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

export function unpackLimbsToBytes(
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

/** Identity bytes for a wallet address (32-byte public key). */
export function addressToIdentity(address: string): Uint8Array {
  return algosdk.decodeAddress(address).publicKey;
}

export function signalsMatchIdentity(
  signals: bigint[],
  identity: Uint8Array,
): boolean {
  const expected = packBytesToLimbs(identity, IDENTITY_LIMB_WIDTHS);

  const outputFirstMatch = expected.every(
    (value, index) => signals[IDENTITY_SIGNAL_START + index] === value,
  );
  if (outputFirstMatch) {
    return true;
  }

  const outputLastStart = PUZZLE_LIMB_WIDTHS.length;
  return expected.every(
    (value, index) => signals[outputLastStart + index] === value,
  );
}

export function signalsMatchScore(signals: bigint[], score: bigint): boolean {
  return (
    signals[SCORE_SIGNAL_INDEX] === score ||
    signals[PUBLIC_SIGNAL_COUNT - 1] === score
  );
}

export function normalizeWitness(
  witness: unknown,
  score: bigint,
): NormalizedWitness {
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
    identityStart: number,
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
    const identityLimbs = candidate.slice(
      identityStart,
      identityStart + IDENTITY_LIMB_WIDTHS.length,
    );

    if (
      puzzleLimbs.length !== PUZZLE_LIMB_WIDTHS.length ||
      identityLimbs.length !== IDENTITY_LIMB_WIDTHS.length
    ) {
      return null;
    }

    if (identityLimbs.some((value) => value < 0n || value >= 1n << 64n)) {
      return null;
    }

    return unpackLimbsToBytes(puzzleLimbs, PUZZLE_LIMB_WIDTHS);
  };

  const outputFirstPuzzle = validateLayout(
    signals,
    SCORE_SIGNAL_INDEX,
    PUZZLE_SIGNAL_START,
    IDENTITY_SIGNAL_START,
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

export function serializeWitness(witness: NormalizedWitness): SerializedWitness {
  return {
    proof: {
      piA: bytesToBase64(witness.proof.piA),
      piB: bytesToBase64(witness.proof.piB),
      piC: bytesToBase64(witness.proof.piC),
    },
    signals: witness.signals.map((value) => value.toString()),
    puzzleCode: bytesToBase64(witness.puzzleCode),
  };
}

/**
 * Parses an untrusted serialized witness. Throws on any malformed field so a
 * server can reject bad payloads before touching the chain.
 */
export function deserializeWitness(value: unknown): NormalizedWitness {
  const raw = value as Partial<SerializedWitness> | null;
  if (!raw || typeof raw !== "object" || !raw.proof) {
    throw new Error("Witness payload is malformed");
  }
  const decodeFixed = (field: unknown, length: number, name: string) => {
    if (typeof field !== "string") {
      throw new Error(`Witness ${name} is missing`);
    }
    const bytes = base64ToBytes(field);
    if (bytes.length !== length) {
      throw new Error(`Witness ${name} has invalid length`);
    }
    return bytes;
  };

  const proof = {
    piA: decodeFixed(raw.proof.piA, 64, "piA"),
    piB: decodeFixed(raw.proof.piB, 128, "piB"),
    piC: decodeFixed(raw.proof.piC, 64, "piC"),
  };

  if (!Array.isArray(raw.signals) || raw.signals.length < PUBLIC_SIGNAL_COUNT) {
    throw new Error("Witness signals are missing");
  }
  if (raw.signals.length > 64) {
    throw new Error("Witness signals are too long");
  }
  const signals = raw.signals.map((entry) => {
    if (typeof entry !== "string" || !/^\d{1,80}$/.test(entry)) {
      throw new Error("Witness signal is not a decimal string");
    }
    return BigInt(entry);
  });

  const puzzleCode = decodeFixed(
    raw.puzzleCode,
    PUZZLE_CODE_BYTE_LENGTH,
    "puzzleCode",
  );

  return { proof, signals, puzzleCode };
}

export function buildScoreBoxName(
  puzzleCode: Uint8Array,
  address: string,
): Uint8Array {
  return concatBytes([puzzleCode, addressToIdentity(address)]);
}

export function buildSponsoredBoxName(
  puzzleCode: Uint8Array,
  userKey: Uint8Array,
): Uint8Array {
  if (userKey.length !== USER_KEY_BYTE_LENGTH) {
    throw new Error("User key must be 32 bytes");
  }
  return concatBytes([SPONSORED_PREFIX, puzzleCode, userKey]);
}

export function buildSponsoredPrefix(puzzleCode?: Uint8Array): Uint8Array {
  return puzzleCode
    ? concatBytes([SPONSORED_PREFIX, puzzleCode])
    : SPONSORED_PREFIX;
}

type BoxValueResponse = {
  value?: string | Uint8Array;
  box?: { value?: string | Uint8Array };
  "application-box"?: { value?: string | Uint8Array };
};

export type BoxListItem = {
  name: string | Uint8Array;
  value?: string | Uint8Array;
};

type BoxListResponse = {
  boxes?: BoxListItem[];
  nextToken?: string;
};

export async function readBoxValueFromAlgod(
  algodClient: algosdk.Algodv2,
  appId: bigint,
  boxName: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const boxResponse = (await algodClient
      .getApplicationBoxByName(Number(appId), boxName)
      .do()) as BoxValueResponse;

    const valueBase64 =
      boxResponse.value ??
      boxResponse.box?.value ??
      boxResponse["application-box"]?.value;

    if (valueBase64 === undefined || valueBase64 === null) {
      return null;
    }

    return asBytes(valueBase64);
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

export async function getExistingScoreFromAlgod(
  algodClient: algosdk.Algodv2,
  appId: bigint,
  scoreBoxName: Uint8Array,
): Promise<bigint | null> {
  const valueBytes = await readBoxValueFromAlgod(
    algodClient,
    appId,
    scoreBoxName,
  );
  if (!valueBytes || valueBytes.length !== SCORE_BYTE_LENGTH) {
    return null;
  }
  return BigInt(valueBytes[0]);
}

export interface SponsoredScoreEntry {
  score: bigint;
  updates: number;
}

export async function getExistingSponsoredScoreFromAlgod(
  algodClient: algosdk.Algodv2,
  appId: bigint,
  sponsoredBoxName: Uint8Array,
): Promise<SponsoredScoreEntry | null> {
  const valueBytes = await readBoxValueFromAlgod(
    algodClient,
    appId,
    sponsoredBoxName,
  );
  if (!valueBytes || valueBytes.length !== SPONSORED_VALUE_BYTE_LENGTH) {
    return null;
  }
  return { score: BigInt(valueBytes[0]), updates: valueBytes[1] };
}

export interface PuzzleScoreEntry {
  /** Wallet address for wallet scores, `sponsored:<hex user key>` otherwise. */
  identity: string;
  sponsored: boolean;
  score: bigint;
}

async function listBoxesWithPrefix(
  algodClient: algosdk.Algodv2,
  appId: bigint,
  prefix: Uint8Array,
): Promise<BoxListItem[]> {
  const items: BoxListItem[] = [];
  let nextToken: string | undefined;
  do {
    let request = algodClient
      .getApplicationBoxes(Number(appId))
      .include("values")
      .prefix(prefix)
      .limit(1000);
    if (nextToken) {
      request = request.next(nextToken);
    }
    const response = (await request.do()) as BoxListResponse;
    items.push(...(response.boxes ?? []));
    nextToken = response.nextToken;
  } while (nextToken);
  return items;
}

/**
 * Lists both wallet and sponsored scores for a puzzle, sorted ascending.
 */
export async function listPuzzleScoresFromAlgod(
  algodClient: algosdk.Algodv2,
  appId: bigint,
  puzzleCode: Uint8Array,
): Promise<PuzzleScoreEntry[]> {
  const entries: PuzzleScoreEntry[] = [];

  const [walletBoxes, sponsoredBoxes] = await Promise.all([
    listBoxesWithPrefix(algodClient, appId, puzzleCode),
    listBoxesWithPrefix(algodClient, appId, buildSponsoredPrefix(puzzleCode)),
  ]);
  for (const box of walletBoxes) {
    const boxNameBytes = asBytes(box.name);
    if (boxNameBytes.length !== SCORE_KEY_BYTE_LENGTH || !box.value) {
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
    const valueBytes = asBytes(box.value);
    if (valueBytes.length !== SCORE_BYTE_LENGTH) {
      continue;
    }
    entries.push({
      identity: address,
      sponsored: false,
      score: BigInt(valueBytes[0]),
    });
  }

  for (const box of sponsoredBoxes) {
    const boxNameBytes = asBytes(box.name);
    if (boxNameBytes.length !== SPONSORED_KEY_BYTE_LENGTH || !box.value) {
      continue;
    }
    const valueBytes = asBytes(box.value);
    if (valueBytes.length !== SPONSORED_VALUE_BYTE_LENGTH) {
      continue;
    }
    const userKey = boxNameBytes.slice(
      SPONSORED_PREFIX.length + PUZZLE_CODE_BYTE_LENGTH,
    );
    entries.push({
      identity: sponsoredIdentityLabel(userKey),
      sponsored: true,
      score: BigInt(valueBytes[0]),
    });
  }

  entries.sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0));
  return entries;
}

/**
 * Lists every sponsored score box (any puzzle), for the daily sweep.
 */
export async function listAllSponsoredBoxesFromAlgod(
  algodClient: algosdk.Algodv2,
  appId: bigint,
): Promise<{ puzzleCode: Uint8Array; userKey: Uint8Array }[]> {
  const boxes = await listBoxesWithPrefix(
    algodClient,
    appId,
    buildSponsoredPrefix(),
  );
  const result: { puzzleCode: Uint8Array; userKey: Uint8Array }[] = [];
  for (const box of boxes) {
    const name = asBytes(box.name);
    if (name.length !== SPONSORED_KEY_BYTE_LENGTH) {
      continue;
    }
    result.push({
      puzzleCode: name.slice(
        SPONSORED_PREFIX.length,
        SPONSORED_PREFIX.length + PUZZLE_CODE_BYTE_LENGTH,
      ),
      userKey: name.slice(SPONSORED_PREFIX.length + PUZZLE_CODE_BYTE_LENGTH),
    });
  }
  return result;
}

export interface ComposeScoreGroupArgs {
  client: PuzzleScoresClient;
  algodClient: algosdk.Algodv2;
  verifier: Groth16Bn254LsigVerifier;
  operation: ScoreSaveOperation;
  witness: NormalizedWitness;
  score: bigint;
  sender: string;
  /**
   * Wallet submissions: the sender's signer (used for the MBR payment on add).
   * Sponsored submissions: omitted; the sponsor signs via the AlgorandClient.
   */
  signer?: algosdk.TransactionSigner;
  /** Present for sponsored submissions; absent for wallet submissions. */
  userKey?: Uint8Array;
  /** Required for wallet adds: exact box MBR in microAlgos. */
  mbr?: number;
}

/**
 * Composes (but does not send) the atomic group for a score submission:
 * the Groth16 verifier lsig txn(s), the app call, and for wallet adds the MBR
 * payment. Returns the composer so the caller can `send()` or `simulate()`.
 */
export async function composeScoreGroup({
  client,
  algodClient,
  verifier,
  operation,
  witness,
  score,
  sender,
  signer,
  userKey,
  mbr,
}: ComposeScoreGroupArgs) {
  const appId = client.appId;
  const puzzleCode = witness.puzzleCode;
  const sponsored = userKey !== undefined;
  const group = client.newGroup();

  const boxReferences = sponsored
    ? [{ appId, name: buildSponsoredBoxName(puzzleCode, userKey) }]
    : [{ appId, name: buildScoreBoxName(puzzleCode, sender) }];

  await verifier.verificationParams({
    proof: witness.proof,
    signals: witness.signals,
    composer: group,
    paramsCallback: async ({ lsigParams, lsigsFee }) => {
      const suggestedParams = await algodClient.getTransactionParams().do();
      const verifierTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: lsigParams.sender,
        receiver: client.appAddress,
        amount: 0,
        suggestedParams: { ...suggestedParams, fee: 0, flatFee: true },
      });
      const verifierArg = {
        txn: verifierTxn,
        signer: lsigParams.signer,
      } as never;

      if (sponsored) {
        if (operation === "add") {
          group.addSponsoredScore({
            args: {
              signals: witness.signals,
              proof: witness.proof,
              puzzleCode,
              userKey,
              score,
              verifierTxn: verifierArg,
            },
            sender,
            extraFee: lsigsFee,
            boxReferences,
          });
        } else {
          group.updateSponsoredScore({
            args: {
              signals: witness.signals,
              proof: witness.proof,
              puzzleCode,
              userKey,
              newScore: score,
              verifierTxn: verifierArg,
            },
            sender,
            extraFee: lsigsFee,
            boxReferences,
          });
        }
        return;
      }

      if (operation === "add") {
        if (mbr === undefined || !signer) {
          throw new Error("Wallet add requires mbr and signer");
        }
        const payMbr = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender,
          receiver: client.appAddress,
          amount: mbr,
          suggestedParams,
        });
        group.addScore({
          args: {
            signals: witness.signals,
            proof: witness.proof,
            puzzleCode,
            score,
            payMbr: { txn: payMbr, signer } as never,
            verifierTxn: verifierArg,
          },
          sender,
          extraFee: lsigsFee,
          boxReferences,
        });
      } else {
        group.updateScore({
          args: {
            signals: witness.signals,
            proof: witness.proof,
            puzzleCode,
            newScore: score,
            verifierTxn: verifierArg,
          },
          sender,
          extraFee: lsigsFee,
          boxReferences,
        });
      }
    },
  });

  return group;
}

/** Fee to attach to a removeScore call (covers the refund inner txn). */
export function innerTxnExtraFee(minFee: bigint | number | undefined) {
  return microAlgo(minFee ?? 1000n);
}
