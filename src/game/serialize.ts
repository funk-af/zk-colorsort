import type { Puzzle } from "./types";
import { DEFAULT_COLORS } from "./types";

const ENCODED_TUBE_COUNT = 10;
const TOTAL_TUBE_COUNT = 12;
const TUBE_CAPACITY = 4;
const BYTES_PER_TUBE = 2;
const ENCODED_BYTE_LENGTH = ENCODED_TUBE_COUNT * BYTES_PER_TUBE;

const colorToCode = new Map<string, number>(
  DEFAULT_COLORS.map((color, index) => [color, index + 1]),
);

function assertSupportedPuzzle(puzzle: Puzzle): void {
  if (puzzle.capacity !== TUBE_CAPACITY) {
    throw new Error("Unsupported puzzle capacity");
  }
  if (puzzle.tubes.length !== TOTAL_TUBE_COUNT) {
    throw new Error("Unsupported tube count");
  }
  const trailing = puzzle.tubes.slice(ENCODED_TUBE_COUNT);
  if (trailing.some((tube) => tube.length !== 0)) {
    throw new Error("Last two tubes must be empty");
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodePuzzle(puzzle: Puzzle): string {
  assertSupportedPuzzle(puzzle);

  const bytes = new Uint8Array(ENCODED_BYTE_LENGTH);

  for (let tubeIndex = 0; tubeIndex < ENCODED_TUBE_COUNT; tubeIndex += 1) {
    const tube = puzzle.tubes[tubeIndex];

    for (let slot = 0; slot < TUBE_CAPACITY; slot += 1) {
      const color = tube[slot];
      const code = color ? colorToCode.get(color) : 0;

      if (color && !code) {
        throw new Error(`Unsupported color: ${color}`);
      }

      const nibble = code ?? 0;
      const byteOffset = tubeIndex * BYTES_PER_TUBE + Math.floor(slot / 2);
      if (slot % 2 === 0) {
        bytes[byteOffset] = nibble << 4;
      } else {
        bytes[byteOffset] |= nibble;
      }
    }
  }

  return bytesToBase64Url(bytes);
}

export function decodePuzzle(encoded: string): Puzzle | null {
  try {
    const bytes = base64UrlToBytes(encoded);
    if (bytes.length !== ENCODED_BYTE_LENGTH) {
      return null;
    }

    const tubes: string[][] = [];

    for (let tubeIndex = 0; tubeIndex < ENCODED_TUBE_COUNT; tubeIndex += 1) {
      const tube: string[] = [];
      for (let slot = 0; slot < TUBE_CAPACITY; slot += 1) {
        const byteOffset = tubeIndex * BYTES_PER_TUBE + Math.floor(slot / 2);
        const byte = bytes[byteOffset];
        const nibble = slot % 2 === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;

        if (nibble === 0) {
          continue;
        }

        const color = DEFAULT_COLORS[nibble - 1];
        if (!color) {
          return null;
        }
        tube.push(color);
      }

      tubes.push(tube);
    }

    tubes.push([], []);

    return {
      capacity: TUBE_CAPACITY,
      tubes,
    };
  } catch {
    return null;
  }
}
