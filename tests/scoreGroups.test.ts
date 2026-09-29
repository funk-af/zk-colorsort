import { describe, expect, test } from "vitest";
import {
  IDENTITY_LIMB_WIDTHS,
  addressToIdentity,
  buildSponsoredBoxName,
  deserializeWitness,
  discordUserKey,
  packBytesToLimbs,
  serializeWitness,
  signalsMatchIdentity,
  signalsMatchScore,
  unpackLimbsToBytes,
  type NormalizedWitness,
} from "../src/algorand/scoreGroups";

function sampleWitness(): NormalizedWitness {
  const puzzleCode = new Uint8Array(20).map((_, i) => i + 1);
  const identity = new Uint8Array(32).map((_, i) => 255 - i);
  const signals = [
    17n,
    ...packBytesToLimbs(puzzleCode, [8, 8, 4]),
    ...packBytesToLimbs(identity, IDENTITY_LIMB_WIDTHS),
  ];
  return {
    proof: {
      piA: new Uint8Array(64).fill(1),
      piB: new Uint8Array(128).fill(2),
      piC: new Uint8Array(64).fill(3),
    },
    signals,
    puzzleCode,
  };
}

describe("scoreGroups", () => {
  test("limb packing round-trips", () => {
    const bytes = new Uint8Array(32).map((_, i) => (i * 37) % 256);
    const limbs = packBytesToLimbs(bytes, IDENTITY_LIMB_WIDTHS);
    expect(unpackLimbsToBytes(limbs, IDENTITY_LIMB_WIDTHS)).toEqual(bytes);
  });

  test("witness JSON serialization round-trips and validates", () => {
    const witness = sampleWitness();
    const json = JSON.parse(JSON.stringify(serializeWitness(witness)));
    const parsed = deserializeWitness(json);
    expect(parsed.proof).toEqual(witness.proof);
    expect(parsed.signals).toEqual(witness.signals);
    expect(parsed.puzzleCode).toEqual(witness.puzzleCode);

    expect(() => deserializeWitness(null)).toThrow();
    expect(() => deserializeWitness({ ...json, signals: ["x"] })).toThrow();
    expect(() =>
      deserializeWitness({ ...json, proof: { ...json.proof, piA: "AAAA" } }),
    ).toThrow(/piA/);
    expect(() => deserializeWitness({ ...json, puzzleCode: "AAAA" })).toThrow(
      /puzzleCode/,
    );
  });

  test("signal checks bind score and identity", () => {
    const witness = sampleWitness();
    const identity = new Uint8Array(32).map((_, i) => 255 - i);
    expect(signalsMatchScore(witness.signals, 17n)).toBe(true);
    expect(signalsMatchScore(witness.signals, 18n)).toBe(false);
    expect(signalsMatchIdentity(witness.signals, identity)).toBe(true);
    expect(signalsMatchIdentity(witness.signals, new Uint8Array(32))).toBe(
      false,
    );
  });

  test("discord user key is a stable 32-byte hash and box names use it", async () => {
    const key = await discordUserKey("123456789012345678");
    expect(key.length).toBe(32);
    expect(await discordUserKey("123456789012345678")).toEqual(key);
    expect(await discordUserKey("123456789012345679")).not.toEqual(key);

    const name = buildSponsoredBoxName(new Uint8Array(20), key);
    expect(name.length).toBe(53);
    expect(name[0]).toBe("s".charCodeAt(0));
    expect(name.slice(21)).toEqual(key);
  });

  test("address identity is the 32-byte public key", () => {
    const address =
      "7ZUECA7HFLZTXENRV24SHLU4AVPUTMTTDUFUBNBD64C73F3UHRTHAIOF6Q";
    expect(addressToIdentity(address).length).toBe(32);
  });
});
