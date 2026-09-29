/**
 * Exports the Groth16 BN254 verification key from the proving zkey so the
 * Netlify functions can build the verifier LogicSig without the 52 MiB zkey.
 *
 *   node scripts/export-vk.ts
 *
 * Re-run whenever src/zk/build/color_final.zkey changes.
 */
import { writeFileSync } from "node:fs";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { Groth16Bn254LsigVerifier } from "snarkjs-algorand";

const ZKEY_PATH = "src/zk/build/color_final.zkey";
const WASM_PATH = "src/zk/build/color_js/color.wasm";
const OUT_PATH = "netlify/functions/lib/verification_key.bn254.json";

type Vk = {
  vkAlpha_1: Uint8Array;
  vkBeta_2: Uint8Array;
  vkGamma_2: Uint8Array;
  vkDelta_2: Uint8Array;
  nPublic: bigint;
  ic: Uint8Array[];
};

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function main() {
  const verifier = new Groth16Bn254LsigVerifier({
    algorand: AlgorandClient.defaultLocalNet(),
    zKey: ZKEY_PATH,
    wasmProver: WASM_PATH,
    appOffset: 1,
    totalLsigs: 3,
  });
  const internal = verifier as unknown as {
    ensureCurveInstantiation: () => Promise<void>;
    getVkey: (zKey: string, curve: unknown) => Promise<Vk>;
    curve: unknown;
  };
  await internal.ensureCurveInstantiation();
  const vk = await internal.getVkey(ZKEY_PATH, internal.curve);

  const serialized = {
    curve: "bn254",
    source: ZKEY_PATH,
    vkAlpha_1: toBase64(vk.vkAlpha_1),
    vkBeta_2: toBase64(vk.vkBeta_2),
    vkGamma_2: toBase64(vk.vkGamma_2),
    vkDelta_2: toBase64(vk.vkDelta_2),
    nPublic: vk.nPublic.toString(),
    ic: vk.ic.map(toBase64),
  };
  writeFileSync(OUT_PATH, JSON.stringify(serialized, null, 2) + "\n");
  console.log(`Wrote ${OUT_PATH} (nPublic=${serialized.nPublic}, ic=${vk.ic.length})`);
  // snarkjs keeps worker threads alive; exit explicitly.
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
