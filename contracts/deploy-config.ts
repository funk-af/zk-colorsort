import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Groth16Bn254LsigVerifier } from "snarkjs-algorand";
import { fileURLToPath } from "node:url";
import {
  APP_SPEC,
  PuzzleScoresClient,
  PuzzleScoresFactory,
} from "../src/algorand/PuzzleScoresClient";

const ZKEY_PATH = "src/zk/build/color_final.zkey";
const WASM_PATH = "src/zk/build/color_js/color.wasm";
const VERIFIER_APP_OFFSET = 1;
const ADD_SCORE_TOTAL_LSIGS = 2;

type NetworkConfig = {
  networkId: string;
  puzzleScoresAppId?: number;
};

/** Network whose `puzzleScoresAppId` in src/networks.json is the target. */
function getDeployNetworkId(): string {
  return (process.env.DEPLOY_NETWORK ?? "localnet").toLowerCase();
}

async function getTargetAppIdFromNetworks(): Promise<bigint | null> {
  const thisFilePath = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFilePath);
  const networksPath = resolve(thisDir, "../src/networks.json");
  const raw = await readFile(networksPath, "utf8");
  const networks = JSON.parse(raw) as NetworkConfig[];

  const networkId = getDeployNetworkId();
  const network = networks.find(
    (entry) => entry.networkId.toLowerCase() === networkId,
  );
  if (!network) {
    throw new Error(`Unknown DEPLOY_NETWORK "${networkId}" in src/networks.json`);
  }

  const appId = network.puzzleScoresAppId;
  if (typeof appId !== "number" || !Number.isInteger(appId) || appId <= 0) {
    return null;
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
  console.log(
    `Target network ${getDeployNetworkId()}, app id ${targetAppId?.toString() ?? "(none, will create)"}`,
  );

  let targetAppExists = false;
  if (targetAppId !== null) {
    try {
      await algorand.client.algod.getApplicationByID(Number(targetAppId)).do();
      targetAppExists = true;
    } catch {
      targetAppExists = false;
    }
  }

  if (targetAppExists && targetAppId !== null) {
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

    await updateAppInPlace(algorand, targetAppId, updateSender);

    console.log(
      `Updated app ${targetAppId.toString()} with sender ${updateSender}`,
    );

    await configureSponsor(algorand, appClient, updateSender);
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

  await configureSponsor(algorand, appClient, deployer.addr.toString());
}

/**
 * Configures the sponsor account used for Discord-sponsored score submissions.
 * The sponsor address is stored in a box (key "meta:sponsor"), so the app
 * account needs enough balance to cover that box's MBR plus the MBR float for
 * sponsored score boxes. SPONSOR_MBR_FLOAT_ALGO controls the top-up amount.
 */
async function configureSponsor(
  algorand: AlgorandClient,
  appClient: PuzzleScoresClient,
  deployerAddress: string,
): Promise<void> {
  const sponsor = await algorand.account.fromEnvironment("SPONSOR");
  const sponsorAddress = sponsor.addr.toString();

  const floatAlgo = Number(process.env.SPONSOR_MBR_FLOAT_ALGO ?? "1");
  if (Number.isFinite(floatAlgo) && floatAlgo > 0) {
    await algorand.send.payment({
      amount: floatAlgo.algo(),
      sender: deployerAddress,
      receiver: appClient.appAddress,
    });
  }

  await appClient.send.setSponsor({
    sender: deployerAddress,
    args: { sponsorAddress },
  });

  console.log(`Set sponsor to ${sponsorAddress}`);
}

/**
 * Updates an existing app in place with the current programs *and* the current
 * global schema. algokit-utils omits schema fields on update transactions, so
 * this uses algosdk directly. Growing the global schema on update is allowed
 * since AVM 13; the extra global-state MBR (28,500 per uint, 50,000 per byte
 * slice) is charged to the app creator's account.
 */
export async function updateAppInPlace(
  algorand: AlgorandClient,
  appId: bigint,
  sender: string,
): Promise<void> {
  const algod = algorand.client.algod;
  const decodeTeal = (base64: string) =>
    Buffer.from(base64, "base64").toString("utf8");
  const approval = await algorand.app.compileTeal(
    decodeTeal(APP_SPEC.source!.approval),
  );
  const clear = await algorand.app.compileTeal(
    decodeTeal(APP_SPEC.source!.clear),
  );
  const schema = APP_SPEC.state.schema;

  const updateMethod = new algosdk.ABIMethod({
    name: "updateApplication",
    args: [],
    returns: { type: "void" },
  });

  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: appId,
    method: updateMethod,
    methodArgs: [],
    sender,
    signer: algorand.account.getSigner(sender),
    suggestedParams: await algod.getTransactionParams().do(),
    onComplete: algosdk.OnApplicationComplete.UpdateApplicationOC,
    approvalProgram: approval.compiledBase64ToBytes,
    clearProgram: clear.compiledBase64ToBytes,
    // Only the global schema may grow on update; local schema fields are
    // rejected by algosdk for update calls.
    numGlobalInts: schema.global.ints,
    numGlobalByteSlices: schema.global.bytes,
  });
  await atc.execute(algod, 4);
}
