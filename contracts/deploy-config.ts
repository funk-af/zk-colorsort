import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Groth16Bn254LsigVerifier } from "snarkjs-algorand";
import { fileURLToPath } from "node:url";
import {
  PuzzleScoresClient,
  PuzzleScoresFactory,
} from "../src/algorand/PuzzleScoresClient";

const ZKEY_PATH = "src/zk/build/color_final.zkey";
const WASM_PATH = "src/zk/build/color_js/color.wasm";
const VERIFIER_APP_OFFSET = 1;
const ADD_SCORE_TOTAL_LSIGS = 3;

type NetworkConfig = {
  networkId: string;
  puzzleScoresAppId?: number;
};

async function getTargetAppIdFromNetworks(): Promise<bigint> {
  const thisFilePath = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFilePath);
  const networksPath = resolve(thisDir, "../src/networks.json");
  const raw = await readFile(networksPath, "utf8");
  const networks = JSON.parse(raw) as NetworkConfig[];

  const localnet = networks.find(
    (network) => network.networkId.toLowerCase() === "localnet",
  );

  const appId = localnet?.puzzleScoresAppId;
  if (typeof appId !== "number" || !Number.isInteger(appId) || appId <= 0) {
    throw new Error(
      "LocalNet puzzleScoresAppId is missing or invalid in src/networks.json",
    );
  }

  return BigInt(appId);
}

async function deriveVerifierLsigAddress(
  algorand: AlgorandClient,
): Promise<string> {
  const verifier = new Groth16Bn254LsigVerifier({
    algorand,
    zKey: ZKEY_PATH,
    wasmProver: WASM_PATH,
    appOffset: VERIFIER_APP_OFFSET,
    totalLsigs: ADD_SCORE_TOTAL_LSIGS,
  });

  const lsig = await verifier.lsigAccount();
  return lsig.addr.toString();
}

export async function deploy() {
  console.log("=== Deploying PuzzleScores ===");

  const algorand = AlgorandClient.fromEnvironment();
  const deployer = await algorand.account.fromEnvironment("DEPLOYER");
  const targetAppId = await getTargetAppIdFromNetworks();

  let targetAppExists = false;
  try {
    await algorand.client.algod.getApplicationByID(Number(targetAppId)).do();
    targetAppExists = true;
  } catch {
    targetAppExists = false;
  }

  if (targetAppExists) {
    const app = await algorand.client.algod
      .getApplicationByID(Number(targetAppId))
      .do();
    const creatorAddress = app.params.creator.toString();

    let updateSender = deployer.addr.toString();
    if (updateSender !== creatorAddress) {
      const dispenser = await algorand.account.dispenserFromEnvironment();
      const dispenserAddress = dispenser.addr.toString();

      if (dispenserAddress !== creatorAddress) {
        throw new Error(
          `App ${targetAppId.toString()} can only be updated by creator ${creatorAddress}`,
        );
      }

      updateSender = dispenserAddress;
    }

    const appClient = algorand.client.getTypedAppClientById(
      PuzzleScoresClient,
      {
        appId: targetAppId,
        defaultSender: updateSender,
      },
    );

    await appClient.send.update.updateApplication({
      args: [],
      sender: updateSender,
    });

    console.log(
      `Updated app ${targetAppId.toString()} with sender ${updateSender}`,
    );
    return;
  }

  const factory = algorand.client.getTypedAppFactory(PuzzleScoresFactory, {
    defaultSender: deployer.addr,
  });

  const { appClient, result } = await factory.deploy({
    onUpdate: "append",
    onSchemaBreak: "append",
  });

  // If app was just created fund the app account and set the verifier address
  if (["create", "replace"].includes(result.operationPerformed)) {
    await algorand.send.payment({
      amount: (0.1).algo(),
      sender: deployer.addr,
      receiver: appClient.appAddress,
    });

    const verifierAddress = await deriveVerifierLsigAddress(algorand);
    await appClient.send.setVerifier({
      sender: deployer.addr,
      args: { verifierAddress },
    });

    console.log(`Set verifier to ${verifierAddress}`);
  }
}
