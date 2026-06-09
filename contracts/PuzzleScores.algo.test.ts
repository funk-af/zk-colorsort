import {
  Bytes,
  Global,
  Uint64,
  type bytes,
} from "@algorandfoundation/algorand-typescript";
import { Uint256 } from "@algorandfoundation/algorand-typescript/arc4";
import { TestExecutionContext } from "@algorandfoundation/algorand-typescript-testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import PuzzleScores from "./PuzzleScores.algo";

function buildSignalsForPuzzle(puzzleCode: Uint8Array, score: bigint | number) {
  const signals = [] as Uint256[];

  const baseAt = signals.at.bind(signals);
  (
    signals as Uint256[] & { at(index: number | bigint): Uint256 | undefined }
  ).at = (index: number | bigint) => {
    let normalizedIndex: number;
    try {
      normalizedIndex = Number(
        BigInt(index as unknown as bigint | number | string),
      );
    } catch {
      normalizedIndex = Number(index as unknown as number);
    }

    return baseAt(normalizedIndex);
  };

  const toBigInt = (value: bigint | number): bigint => {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number") {
      return BigInt(value);
    }
    return BigInt(
      (value as unknown as { valueOf: () => number | bigint }).valueOf(),
    );
  };

  const toSignal = (value: bigint | number): Uint256 =>
    ({
      asBigUint: () => toBigInt(value),
    }) as unknown as Uint256;

  for (const byte of puzzleCode) {
    signals.push(toSignal((byte >> 4) & 0x0f));
    signals.push(toSignal(byte & 0x0f));
  }

  for (let index = 0; index < 8; index += 1) {
    signals.push(toSignal(0));
  }

  signals.push(toSignal(score));
  return signals;
}

function createPuzzleCode(offset = 0): { raw: Uint8Array; value: bytes<20> } {
  const raw = Uint8Array.from({ length: 20 }, (_, index) => {
    const high = (offset + index) % 10;
    const low = (offset + index + 1) % 10;
    return (high << 4) | low;
  });

  const hex = Array.from(raw, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    raw,
    value: Bytes.fromHex(hex) as bytes<20>,
  };
}

function withLinkedVerifierReceiver<T>(
  verifierTxn: object,
  callback: () => T,
): T {
  const globalObj = Global as unknown as object;
  const globalDescriptor = Object.getOwnPropertyDescriptor(
    globalObj,
    "currentApplicationAddress",
  );

  if (
    !globalDescriptor ||
    !globalDescriptor.get ||
    globalDescriptor.configurable === false
  ) {
    return callback();
  }

  const receiverDescriptor = Object.getOwnPropertyDescriptor(
    verifierTxn,
    "receiver",
  );
  if (receiverDescriptor?.configurable === false) {
    return callback();
  }

  let latestCurrentAppAddress: unknown;
  Object.defineProperty(globalObj, "currentApplicationAddress", {
    configurable: true,
    get: () => {
      latestCurrentAppAddress = globalDescriptor.get!.call(globalObj);
      return latestCurrentAppAddress;
    },
  });
  Object.defineProperty(verifierTxn, "receiver", {
    configurable: true,
    get: () => latestCurrentAppAddress ?? globalDescriptor.get!.call(globalObj),
  });

  try {
    return callback();
  } finally {
    Object.defineProperty(
      globalObj,
      "currentApplicationAddress",
      globalDescriptor,
    );

    if (receiverDescriptor) {
      Object.defineProperty(verifierTxn, "receiver", receiverDescriptor);
    } else {
      delete (verifierTxn as { receiver?: unknown }).receiver;
    }
  }
}

describe("PuzzleScores contract", () => {
  const ctx = new TestExecutionContext();

  const buildProof = () => ({
    piA: ctx.any.bytes(64) as bytes<64>,
    piB: ctx.any.bytes(128) as bytes<128>,
    piC: ctx.any.bytes(64) as bytes<64>,
  });

  afterEach(() => {
    ctx.reset();
  });

  const addScoreAs = (
    contract: PuzzleScores,
    verifier: ReturnType<typeof ctx.any.account>,
    sender: ReturnType<typeof ctx.any.account>,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    score: ReturnType<typeof Uint64>,
  ) => {
    ctx.defaultSender = sender;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appAccount = (
      app as unknown as { address: ReturnType<typeof ctx.any.account> }
    ).address;
    const mbr = contract.boxMbr();
    const appCall = ctx.any.txn.applicationCall({
      sender,
      appId: app,
    });

    ctx.txn.createScope([appCall], 0).execute(() => {
      const verifierTxn = ctx.any.txn.payment({
        sender: verifier,
        receiver: appAccount,
        amount: Uint64(0),
        fee: Uint64(0),
      });
      withLinkedVerifierReceiver(verifierTxn, () => {
        const pay = ctx.any.txn.payment({
          sender,
          receiver: appAccount,
          amount: mbr,
        });
        contract.addScore(
          buildSignalsForPuzzle(puzzleCode.raw, score),
          buildProof(),
          puzzleCode.value,
          score,
          pay,
          verifierTxn,
        );
      });
    });
    return mbr;
  };

  const updateScoreAs = (
    contract: PuzzleScores,
    verifier: ReturnType<typeof ctx.any.account>,
    sender: ReturnType<typeof ctx.any.account>,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    score: ReturnType<typeof Uint64>,
  ) => {
    ctx.defaultSender = sender;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appAccount = (
      app as unknown as { address: ReturnType<typeof ctx.any.account> }
    ).address;
    const appCall = ctx.any.txn.applicationCall({
      sender,
      appId: app,
    });

    ctx.txn.createScope([appCall], 0).execute(() => {
      const verifierTxn = ctx.any.txn.payment({
        sender: verifier,
        receiver: appAccount,
        amount: Uint64(0),
        fee: Uint64(0),
      });
      withLinkedVerifierReceiver(verifierTxn, () => {
        contract.updateScore(
          buildSignalsForPuzzle(puzzleCode.raw, score),
          buildProof(),
          puzzleCode.value,
          score,
          verifierTxn,
        );
      });
    });
  };

  const removeScoreAs = (
    contract: PuzzleScores,
    sender: ReturnType<typeof ctx.any.account>,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
  ) => {
    ctx.defaultSender = sender;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appCall = ctx.any.txn.applicationCall({
      sender,
      appId: app,
    });

    ctx.txn.createScope([appCall], 0).execute(() => {
      contract.removeScore(puzzleCode.value);
    });
  };

  const getScoreForUserAs = (
    contract: PuzzleScores,
    sender: ReturnType<typeof ctx.any.account>,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    user: ReturnType<typeof ctx.any.account>,
  ) => {
    ctx.defaultSender = sender;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appCall = ctx.any.txn.applicationCall({
      sender,
      appId: app,
    });

    return ctx.txn.createScope([appCall], 0).execute(() => {
      return contract.getScoreForUser(puzzleCode.value, user);
    });
  };

  test("two users can add and manage scores on the same puzzle independently", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {});
    const userA = ctx.any.account();
    const userB = ctx.any.account();
    const verifier = creator;
    const puzzleCode = createPuzzleCode(0);

    ctx.defaultSender = creator;
    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier);
    });

    const mbrA = addScoreAs(contract, verifier, userA, puzzleCode, Uint64(22));
    const mbrB = addScoreAs(contract, verifier, userB, puzzleCode, Uint64(31));
    expect(mbrA).toEqual(mbrB);

    expect(getScoreForUserAs(contract, userA, puzzleCode, userA)).toEqual([
      Uint64(22),
      true,
    ]);
    expect(getScoreForUserAs(contract, userA, puzzleCode, userB)).toEqual([
      Uint64(31),
      true,
    ]);

    updateScoreAs(contract, verifier, userA, puzzleCode, Uint64(18));

    expect(getScoreForUserAs(contract, userA, puzzleCode, userA)).toEqual([
      Uint64(18),
      true,
    ]);
    expect(getScoreForUserAs(contract, userA, puzzleCode, userB)).toEqual([
      Uint64(31),
      true,
    ]);

    removeScoreAs(contract, userA, puzzleCode);

    const refund = ctx.txn.lastGroup.lastItxnGroup().getPaymentInnerTxn();
    expect(refund.receiver).toEqual(userA);
    expect(refund.amount).toEqual(mbrA);

    expect(getScoreForUserAs(contract, userB, puzzleCode, userA)).toEqual([
      Uint64(0),
      false,
    ]);
    expect(getScoreForUserAs(contract, userB, puzzleCode, userB)).toEqual([
      Uint64(31),
      true,
    ]);
  });

  test("same user cannot add duplicate score for the same puzzle", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {});
    const user = ctx.any.account();
    const verifier = creator;
    const puzzleCode = createPuzzleCode(1);

    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier);
    });

    const mbr = addScoreAs(contract, verifier, user, puzzleCode, Uint64(9));
    expect(mbr).toEqual(contract.boxMbr());

    expect(() =>
      addScoreAs(contract, verifier, user, puzzleCode, Uint64(7)),
    ).toThrow("score already exists for puzzle");
  });

  test("user cannot update another user's score", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {});
    const userA = ctx.any.account();
    const userB = ctx.any.account();
    const verifier = creator;
    const puzzleCode = createPuzzleCode(2);

    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier);
    });

    addScoreAs(contract, verifier, userA, puzzleCode, Uint64(12));

    expect(() =>
      updateScoreAs(contract, verifier, userB, puzzleCode, Uint64(5)),
    ).toThrow("score does not exist for puzzle");

    expect(getScoreForUserAs(contract, userA, puzzleCode, userA)).toEqual([
      Uint64(12),
      true,
    ]);
  });

  test("score upload rejects mismatched public puzzle signals", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {
      throw new Error("public puzzle code must match");
    });
    const user = ctx.any.account();
    const verifier = creator;
    const puzzleCode = createPuzzleCode(3);

    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier);
    });

    ctx.defaultSender = user;
    const appCall = ctx.any.txn.applicationCall({
      sender: user,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    const appAccount = (
      ctx.ledger.getApplicationForContract(contract) as unknown as {
        address: ReturnType<typeof ctx.any.account>;
      }
    ).address;

    expect(() =>
      ctx.txn.createScope([appCall], 0).execute(() => {
        const wrongSignals = buildSignalsForPuzzle(
          new Uint8Array(20),
          Uint64(9),
        );
        const pay = ctx.any.txn.payment({
          sender: user,
          receiver: appAccount,
          amount: contract.boxMbr(),
        });
        const verifierTxn = ctx.any.txn.payment({
          sender: verifier,
          receiver: appAccount,
          amount: Uint64(0),
          fee: Uint64(0),
        });
        withLinkedVerifierReceiver(verifierTxn, () => {
          contract.addScore(
            wrongSignals,
            buildProof(),
            puzzleCode.value,
            Uint64(9),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow("public puzzle code must match");
  });
});
