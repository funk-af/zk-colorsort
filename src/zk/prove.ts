import algosdk from "algosdk";
import * as snarkjs from "snarkjs";
import type { Move, Puzzle } from "../game/types";
import { DEFAULT_COLORS } from "../game/types";

// Circuit parameters matching: ColorSort(12, 4, 120, 10, 2, 4, 3, 5)
const NTUBES = 12;
const CAP = 4;
const NMOVES = 120;
const ADDRESS_BYTE_LENGTH = 32;

// Vite static asset URLs — resolved at build time
// Use ?url suffix so Vite exposes them as fetch-able URLs
import wasmUrl from "./build/color_js/color.wasm?url";
import zkeyUrl from "./build/color_final.zkey?url";

// Map hex color string → circuit integer (1..10). Empty slot → 0.
const colorToInt = new Map<string, number>(
  DEFAULT_COLORS.map((color, index) => [color, index + 1]),
);

function colorCode(color: string | undefined): number {
  if (!color) return 0;
  const code = colorToInt.get(color);
  if (code === undefined) throw new Error(`Unknown color: ${color}`);
  return code;
}

/**
 * Encode the initial puzzle board as the flat `initial[NTUBES * CAP]` array
 * required by the circuit.
 *
 * Tubes are represented bottom-first: slot 0 is the bottom, slot CAP-1 is the
 * top. Empty slots are 0.  The game's Tube array already stores colors
 * bottom-to-top with varying length, so slot i = tube[i] (or 0 if absent).
 */
function encodeInitialState(puzzle: Puzzle): string[] {
  if (puzzle.tubes.length !== NTUBES) {
    throw new Error(`Expected ${NTUBES} tubes, got ${puzzle.tubes.length}`);
  }
  if (puzzle.capacity !== CAP) {
    throw new Error(`Expected capacity ${CAP}, got ${puzzle.capacity}`);
  }

  const flat: string[] = [];
  for (const tube of puzzle.tubes) {
    for (let i = 0; i < CAP; i++) {
      flat.push(String(colorCode(tube[i])));
    }
  }
  return flat;
}

/**
 * Pad the move list to NMOVES and produce the three private input arrays.
 *
 * Active moves come first (active[m] = 1); padding moves have active[m] = 0
 * and src/dst = 0 (the circuit only checks legality when active = 1).
 */
function encodeMoves(moves: Move[]): {
  srcs: string[];
  dsts: string[];
  active: string[];
} {
  if (moves.length > NMOVES) {
    throw new Error(`Too many moves: ${moves.length} > ${NMOVES}`);
  }

  const srcs: string[] = [];
  const dsts: string[] = [];
  const active: string[] = [];

  for (let m = 0; m < NMOVES; m++) {
    if (m < moves.length) {
      srcs.push(String(moves[m].from));
      dsts.push(String(moves[m].to));
      active.push("1");
    } else {
      srcs.push("0");
      dsts.push("0");
      active.push("0");
    }
  }

  return { srcs, dsts, active };
}

function encodeSenderPublicKey(sender: string): string[] {
  const publicKey = algosdk.decodeAddress(sender).publicKey;
  if (publicKey.length !== ADDRESS_BYTE_LENGTH) {
    throw new Error(
      `Expected ${ADDRESS_BYTE_LENGTH} sender bytes, got ${publicKey.length}`,
    );
  }

  return Array.from(publicKey, (byte) => String(byte));
}

export interface ProveResult {
  proof: snarkjs.Groth16Proof;
  publicSignals: string[];
  /** The number of moves used, parsed from publicSignals[0] */
  moveCount: number;
}

export interface ColorSortProofInput {
  [key: string]: string[] | string;
  initial: string[];
  sender: string[];
  puzzlePacked: string;
  senderHi: string;
  senderLo: string;
  srcs: string[];
  dsts: string[];
  active: string[];
}

function packBytesBigEndian(bytes: number[]): string {
  let packed = 0n;
  for (const byte of bytes) {
    packed = packed * 256n + BigInt(byte);
  }
  return packed.toString();
}

function packPuzzleFromInitial(initial: string[]): string {
  if (initial.length !== NTUBES * CAP) {
    throw new Error("Unexpected initial state length for packing");
  }

  const puzzleBytes: number[] = [];
  for (let tubeIndex = 0; tubeIndex < 10; tubeIndex += 1) {
    const slot0 = Number(initial[tubeIndex * CAP]);
    const slot1 = Number(initial[tubeIndex * CAP + 1]);
    const slot2 = Number(initial[tubeIndex * CAP + 2]);
    const slot3 = Number(initial[tubeIndex * CAP + 3]);

    puzzleBytes.push((slot0 << 4) | slot1);
    puzzleBytes.push((slot2 << 4) | slot3);
  }

  return packBytesBigEndian(puzzleBytes);
}

export const colorSortWasmUrl = wasmUrl;
export const colorSortZkeyUrl = zkeyUrl;

export function buildColorSortProofInput(
  puzzle: Puzzle,
  moves: Move[],
  sender: string,
): ColorSortProofInput {
  const initial = encodeInitialState(puzzle);
  const senderPublicKey = encodeSenderPublicKey(sender);
  const senderPublicKeyNumbers = senderPublicKey.map((value) => Number(value));
  const senderHi = packBytesBigEndian(senderPublicKeyNumbers.slice(0, 16));
  const senderLo = packBytesBigEndian(senderPublicKeyNumbers.slice(16, 32));
  const puzzlePacked = packPuzzleFromInitial(initial);
  const { srcs, dsts, active } = encodeMoves(moves);
  return {
    initial,
    sender: senderPublicKey,
    puzzlePacked,
    senderHi,
    senderLo,
    srcs,
    dsts,
    active,
  };
}

/**
 * Generate a Groth16 proof that `puzzle` is solvable via the given `moves`.
 *
 * The initial board is the public input; the move sequence is kept private.
 * Throws if the move sequence is invalid or does not reach the solved state.
 */
export async function proveColorSort(
  puzzle: Puzzle,
  moves: Move[],
  sender: string,
): Promise<ProveResult> {
  const input = buildColorSortProofInput(puzzle, moves, sender);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmUrl,
    zkeyUrl,
  );

  return {
    proof,
    publicSignals,
    moveCount: Number(publicSignals[0]),
  };
}

/**
 * Verify a proof against the verification key.
 * Pass the `publicSignals` and `proof` returned by `proveColorSort`.
 */
export async function verifyColorSort(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  const vkeyResponse = await fetch(
    new URL("../../zk/build/verification_key.json", import.meta.url).href,
  );
  const vkey = await vkeyResponse.json();
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}
