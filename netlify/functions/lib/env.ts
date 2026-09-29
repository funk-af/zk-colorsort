import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";
import networks from "../../../src/networks.json";

interface NetworkConfig {
  networkId: string;
  puzzleScoresAppId?: number;
}

const LOCALNET_TOKEN = "a".repeat(64);

const DEFAULT_ALGOD: Record<string, { server: string; port: string; token: string }> = {
  mainnet: { server: "https://mainnet-api.algonode.cloud", port: "", token: "" },
  testnet: { server: "https://testnet-api.algonode.cloud", port: "", token: "" },
  localnet: { server: "http://localhost", port: "4001", token: LOCALNET_TOKEN },
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/** Network id used for the daily seed, indexer, and default app id. */
export function getNetworkId(): string {
  return (process.env.ALGORAND_NETWORK ?? "mainnet").toLowerCase();
}

export function getAppId(): bigint {
  const fromEnv = process.env.PUZZLE_SCORES_APP_ID;
  if (fromEnv) {
    return BigInt(fromEnv);
  }
  const config = (networks as NetworkConfig[]).find(
    (item) => item.networkId === getNetworkId(),
  );
  if (!config?.puzzleScoresAppId) {
    throw new Error(`No puzzleScoresAppId for network ${getNetworkId()}`);
  }
  return BigInt(config.puzzleScoresAppId);
}

export function getAlgodClient(): algosdk.Algodv2 {
  const defaults = DEFAULT_ALGOD[getNetworkId()] ?? DEFAULT_ALGOD.mainnet;
  const server = process.env.ALGOD_URL ?? defaults.server;
  const port = process.env.ALGOD_PORT ?? defaults.port;
  const token = process.env.ALGOD_TOKEN ?? defaults.token;
  return new algosdk.Algodv2(token, server, port);
}

export function getAlgorandClient(): AlgorandClient {
  return AlgorandClient.fromClients({ algod: getAlgodClient() });
}

export function getSponsorAccount(): algosdk.Account {
  return algosdk.mnemonicToSecretKey(requireEnv("SPONSOR_MNEMONIC"));
}

/** Minimum sponsor balance (microAlgos) below which submissions pause. */
export function getSponsorMinBalance(): bigint {
  return BigInt(process.env.SPONSOR_MIN_BALANCE ?? "500000");
}

export function getMinDiscordAccountAgeDays(): number {
  const parsed = Number(process.env.MIN_DISCORD_ACCOUNT_AGE_DAYS ?? "14");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 14;
}
