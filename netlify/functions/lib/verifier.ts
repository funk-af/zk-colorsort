import type { AlgorandClient } from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";
import {
  Groth16Bn254LsigVerifier,
  type Groth16Bn254VerificationKey,
} from "snarkjs-algorand";
import {
  SPONSORED_VERIFIER_TOTAL_LSIGS,
  VERIFIER_APP_OFFSET,
} from "../../../src/algorand/scoreGroups";
import vkJson from "./verification_key.bn254.json";

const fromBase64 = (value: string) => algosdk.base64ToBytes(value);

let cachedVk: Groth16Bn254VerificationKey | null = null;

/** The verification key exported by scripts/export-vk.ts. */
export function getVerificationKey(): Groth16Bn254VerificationKey {
  if (!cachedVk) {
    cachedVk = {
      vkAlpha_1: fromBase64(vkJson.vkAlpha_1),
      vkBeta_2: fromBase64(vkJson.vkBeta_2),
      vkGamma_2: fromBase64(vkJson.vkGamma_2),
      vkDelta_2: fromBase64(vkJson.vkDelta_2),
      nPublic: BigInt(vkJson.nPublic),
      ic: vkJson.ic.map(fromBase64),
    };
  }
  return cachedVk;
}

/**
 * Verifier for sponsored groups, built from the verification key alone (no
 * zkey). Sponsored groups carry no MBR payment, so they use one extra lsig.
 */
export function createSponsoredVerifier(
  algorand: AlgorandClient,
): Groth16Bn254LsigVerifier {
  return new Groth16Bn254LsigVerifier({
    algorand,
    vk: getVerificationKey(),
    appOffset: VERIFIER_APP_OFFSET,
    totalLsigs: SPONSORED_VERIFIER_TOTAL_LSIGS,
  });
}
