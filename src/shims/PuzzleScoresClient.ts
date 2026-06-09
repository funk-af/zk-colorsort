import { AppClient } from "@algorandfoundation/algokit-utils/types/app-client";
import type { AlgorandClient } from "@algorandfoundation/algokit-utils/types/algorand-client";
import type { SendParams } from "@algorandfoundation/algokit-utils/types/transaction";
import type { Transaction, TransactionSigner } from "algosdk";
import appSpec from "../../contracts/artifacts/PuzzleScores.arc56.json";

export interface Groth16Bn254Proof {
  piA: Uint8Array;
  piB: Uint8Array;
  piC: Uint8Array;
}

interface PuzzleScoresClientParams {
  appId: bigint;
  algorand: AlgorandClient;
  defaultSender?: string;
}

type UpdateScoreParams = {
  args: {
    signals: bigint[] | number[];
    proof: Groth16Bn254Proof;
    puzzleCode: Uint8Array;
    newScore: bigint | number;
    verifierTxn: unknown;
  };
  sender?: string;
  signer?: TransactionSigner;
  staticFee?: unknown;
  extraFee?: unknown;
  boxReferences?: unknown;
};

type AddScoreParams = {
  args: {
    signals: bigint[] | number[];
    proof: Groth16Bn254Proof;
    puzzleCode: Uint8Array;
    score: bigint | number;
    payMbr: unknown;
    verifierTxn: unknown;
  };
  sender?: string;
  signer?: TransactionSigner;
  staticFee?: unknown;
  extraFee?: unknown;
  boxReferences?: unknown;
};

type RemoveScoreParams = {
  args: {
    puzzleCode: Uint8Array;
  };
  sender?: string;
  signer?: TransactionSigner;
  staticFee?: unknown;
  extraFee?: unknown;
  boxReferences?: unknown;
};

type BoxMbrParams = {
  sender?: string;
  args?: [];
};

export class PuzzleScoresClient {
  private readonly appClient: AppClient;
  private readonly algorand: AlgorandClient;

  constructor(params: PuzzleScoresClientParams) {
    this.algorand = params.algorand;
    this.appClient = new AppClient({
      ...params,
      appSpec: appSpec as any,
    });
  }

  get appAddress(): string {
    return String(this.appClient.appAddress);
  }

  readonly state = {
    global: {
      verifier: async (): Promise<string | undefined> => {
        return (await this.appClient.state.global.getValue("verifier")) as
          | string
          | undefined;
      },
    },
  };

  readonly send = {
    boxMbr: async (params: BoxMbrParams = { args: [] }) => {
      const result = await this.appClient.send.call({
        ...params,
        method: "boxMbr()uint64",
        args: [],
      } as any);
      return { ...result, return: result.return as bigint | undefined };
    },
    removeScore: async (params: RemoveScoreParams) => {
      const result = await this.appClient.send.call({
        ...params,
        method: "removeScore(byte[])void",
        args: [params.args.puzzleCode],
      } as any);
      return { ...result, return: result.return as undefined };
    },
  };

  public newGroup() {
    const composer = this.algorand.newGroup();
    const group = {
      updateScore: async (params: UpdateScoreParams) => {
        composer.addAppCallMethodCall(
          await this.appClient.params.call({
            ...params,
            method:
              "updateScore(uint256[],(byte[64],byte[128],byte[64]),byte[],uint64,pay)void",
            args: [
              params.args.signals,
              params.args.proof,
              params.args.puzzleCode,
              params.args.newScore,
              params.args.verifierTxn,
            ],
          } as any),
        );
      },
      addScore: async (params: AddScoreParams) => {
        composer.addAppCallMethodCall(
          await this.appClient.params.call({
            ...params,
            method:
              "addScore(uint256[],(byte[64],byte[128],byte[64]),byte[],uint64,pay,pay)void",
            args: [
              params.args.signals,
              params.args.proof,
              params.args.puzzleCode,
              params.args.score,
              params.args.payMbr,
              params.args.verifierTxn,
            ],
          } as any),
        );
      },
      addTransaction: (txn: Transaction, signer?: TransactionSigner) => {
        composer.addTransaction(txn, signer);
        return group;
      },
      send: (params?: SendParams) => composer.send(params),
    };
    return group;
  }
}
