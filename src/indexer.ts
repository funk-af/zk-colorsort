import algosdk from "algosdk";
import networks from "./networks.json";
import { asBytes, concatBytes, startsWithBytes } from "./utils/bytes";

const ADDRESS_BYTE_LENGTH = 32;
const SCORE_BYTE_LENGTH = 1;
const PUZZLE_CODE_BYTE_LENGTH = 20;
const SCORE_KEY_BYTE_LENGTH = PUZZLE_CODE_BYTE_LENGTH + ADDRESS_BYTE_LENGTH;

interface NetworkIndexerConfig {
  networkId: string;
  indexer: {
    url: string;
    port: string;
    token: string;
  };
}

type BoxListItem = {
  name: string | Uint8Array;
};

type LookupBoxesResponse = {
  boxes?: BoxListItem[];
  nextToken?: string;
  "next-token"?: string;
};

type LookupBoxValueResponse = {
  value?: string | Uint8Array;
  box?: { value?: string | Uint8Array };
  "application-box"?: { value?: string | Uint8Array };
};

export interface PuzzleScoreEntry {
  address: string;
  score: bigint;
}

const networkConfigs = networks as NetworkIndexerConfig[];
const indexerClients = new Map<string, algosdk.Indexer>();

function resolveNetworkId(networkId: string): string {
  const normalized = networkId.toLowerCase();
  return networkConfigs.some((config) => config.networkId === normalized)
    ? normalized
    : "localnet";
}

export function getIndexerClient(networkId: string): algosdk.Indexer {
  const resolvedNetworkId = resolveNetworkId(networkId);
  const cached = indexerClients.get(resolvedNetworkId);
  if (cached) return cached;

  const config = networkConfigs.find(
    (item) => item.networkId === resolvedNetworkId,
  );
  if (!config) {
    throw new Error(`Missing indexer config for network: ${resolvedNetworkId}`);
  }

  const client = new algosdk.Indexer(
    config.indexer.token,
    config.indexer.url,
    config.indexer.port,
  );

  indexerClients.set(resolvedNetworkId, client);
  return client;
}

export function getTransactionExplorerUrl(
  networkId: string,
  txId: string,
): string {
  const resolvedNetworkId = resolveNetworkId(networkId);
  return `https://lora.algokit.io/${resolvedNetworkId}/transaction/${txId}`;
}

export function buildPuzzleScorePrefix(puzzleCode: Uint8Array): Uint8Array {
  if (puzzleCode.length !== PUZZLE_CODE_BYTE_LENGTH) {
    throw new Error(`Puzzle code must be ${PUZZLE_CODE_BYTE_LENGTH} bytes`);
  }
  return puzzleCode;
}

export function buildPuzzleScoreBoxName(
  puzzleCode: Uint8Array,
  address: string,
): Uint8Array {
  if (puzzleCode.length !== PUZZLE_CODE_BYTE_LENGTH) {
    throw new Error(`Puzzle code must be ${PUZZLE_CODE_BYTE_LENGTH} bytes`);
  }
  const addressBytes = algosdk.decodeAddress(address).publicKey;
  return concatBytes([puzzleCode, addressBytes]);
}

export async function listPuzzleScores(
  networkId: string,
  appId: number,
  puzzleCode: Uint8Array,
): Promise<PuzzleScoreEntry[]> {
  const indexer = getIndexerClient(networkId);
  const prefix = buildPuzzleScorePrefix(puzzleCode);
  const entries: PuzzleScoreEntry[] = [];

  let nextToken: string | undefined;
  do {
    let request = indexer.searchForApplicationBoxes(appId).limit(1000);
    if (nextToken) {
      request = request.nextToken(nextToken);
    }

    const boxPage = (await request.do()) as LookupBoxesResponse;
    for (const box of boxPage.boxes ?? []) {
      const boxNameBytes = asBytes(box.name);
      if (!startsWithBytes(boxNameBytes, prefix)) {
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

      const boxValueResponse = (await indexer
        .lookupApplicationBoxByIDandName(appId, boxNameBytes)
        .do()) as LookupBoxValueResponse;
      const valueBase64 =
        boxValueResponse.value ??
        boxValueResponse.box?.value ??
        boxValueResponse["application-box"]?.value;
      if (!valueBase64) {
        continue;
      }

      const valueBytes = asBytes(valueBase64);
      if (valueBytes.length !== SCORE_BYTE_LENGTH) {
        continue;
      }

      entries.push({
        address,
        score: BigInt(valueBytes[0]),
      });
    }

    nextToken = boxPage.nextToken ?? boxPage["next-token"];
  } while (nextToken);

  entries.sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0));
  return entries;
}
