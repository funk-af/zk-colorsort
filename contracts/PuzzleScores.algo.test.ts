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

function buildSignalsForSubmission(
  puzzleCode: Uint8Array,
  senderBytes: Uint8Array,
  score: bigint | number,
) {
  const signals = [] as Uint256[];

  const baseAt = signals.at.bind(signals);
  (
    signals as Uint256[] & { at(index: number | bigint): Uint256 | undefined }
  ).at = (index: number | bigint) => {
    const unknownIndex = index as unknown;
    const valueFromObject =
      unknownIndex && typeof unknownIndex === "object"
        ? (unknownIndex as { valueOf?: () => unknown }).valueOf?.()
        : undefined;

    const primitiveIndex = valueFromObject ?? unknownIndex;

    let normalizedIndex: number;
    if (typeof primitiveIndex === "bigint") {
      normalizedIndex = Number(primitiveIndex);
    } else if (typeof primitiveIndex === "number") {
      normalizedIndex = primitiveIndex;
    } else if (typeof primitiveIndex === "string") {
      normalizedIndex = Number(primitiveIndex);
    } else {
      normalizedIndex = Number(unknownIndex as number);
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

  const packBigEndian = (bytes: Uint8Array): bigint => {
    let packed = 0n;
    for (const byte of bytes) {
      packed = packed * 256n + BigInt(byte);
    }
    return packed;
  };

  const senderHi = senderBytes.slice(0, 16);
  const senderLo = senderBytes.slice(16, 32);

  // Output-first signal ordering: score, packed puzzle, sender high-half, sender low-half.
  signals.push(toSignal(score));
  signals.push(toSignal(packBigEndian(puzzleCode)));
  signals.push(toSignal(packBigEndian(senderHi)));
  signals.push(toSignal(packBigEndian(senderLo)));
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
  const makeSignal = (value: bigint | number): Uint256 =>
    ({
      asBigUint: () => BigInt(value),
    }) as unknown as Uint256;
  type TestAccount = {
    raw: Uint8Array;
    value: ReturnType<typeof ctx.any.account>;
  };

  const buildProof = () => ({
    piA: ctx.any.bytes(64) as bytes<64>,
    piB: ctx.any.bytes(128) as bytes<128>,
    piC: ctx.any.bytes(64) as bytes<64>,
  });

  const createAccount = (offset = 0): TestAccount => {
    const raw = Uint8Array.from(
      { length: 32 },
      (_, index) => (offset + index) % 256,
    );
    const hex = Array.from(raw, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    return {
      raw,
      value: ctx.any.account({ address: Bytes.fromHex(hex) as bytes<32> }),
    };
  };

  afterEach(() => {
    ctx.reset();
  });

  const addScoreAs = (
    contract: PuzzleScores,
    verifier: TestAccount,
    sender: TestAccount,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    score: ReturnType<typeof Uint64>,
  ) => {
    ctx.defaultSender = sender.value;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appAccount = (
      app as unknown as { address: ReturnType<typeof ctx.any.account> }
    ).address;
    const mbr = contract.boxMbr();
    const appCall = ctx.any.txn.applicationCall({
      sender: sender.value,
      appId: app,
    });

    ctx.txn.createScope([appCall], 0).execute(() => {
      const verifierTxn = ctx.any.txn.payment({
        sender: verifier.value,
        receiver: appAccount,
        amount: Uint64(0),
        fee: Uint64(0),
      });
      withLinkedVerifierReceiver(verifierTxn, () => {
        const pay = ctx.any.txn.payment({
          sender: sender.value,
          receiver: appAccount,
          amount: mbr,
        });
        contract.addScore(
          buildSignalsForSubmission(puzzleCode.raw, sender.raw, score),
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
    verifier: TestAccount,
    sender: TestAccount,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    score: ReturnType<typeof Uint64>,
  ) => {
    ctx.defaultSender = sender.value;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appAccount = (
      app as unknown as { address: ReturnType<typeof ctx.any.account> }
    ).address;
    const appCall = ctx.any.txn.applicationCall({
      sender: sender.value,
      appId: app,
    });

    ctx.txn.createScope([appCall], 0).execute(() => {
      const verifierTxn = ctx.any.txn.payment({
        sender: verifier.value,
        receiver: appAccount,
        amount: Uint64(0),
        fee: Uint64(0),
      });
      withLinkedVerifierReceiver(verifierTxn, () => {
        contract.updateScore(
          buildSignalsForSubmission(puzzleCode.raw, sender.raw, score),
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
    sender: TestAccount,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
  ) => {
    ctx.defaultSender = sender.value;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appCall = ctx.any.txn.applicationCall({
      sender: sender.value,
      appId: app,
    });

    ctx.txn.createScope([appCall], 0).execute(() => {
      contract.removeScore(puzzleCode.value);
    });
  };

  const getScoreForUserAs = (
    contract: PuzzleScores,
    sender: TestAccount,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    user: TestAccount,
  ) => {
    ctx.defaultSender = sender.value;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appCall = ctx.any.txn.applicationCall({
      sender: sender.value,
      appId: app,
    });

    return ctx.txn.createScope([appCall], 0).execute(() => {
      return contract.getScoreForUser(puzzleCode.value, user.value);
    });
  };

  test("two users can add and manage scores on the same puzzle independently", () => {
    const creator = createAccount(0);
    ctx.defaultSender = creator.value;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {});
    const userA = createAccount(32);
    const userB = createAccount(64);
    const verifier = creator;
    const puzzleCode = createPuzzleCode(0);

    ctx.defaultSender = creator.value;
    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier.value);
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
    expect(refund.receiver).toEqual(userA.value);
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
    const creator = createAccount(1);
    ctx.defaultSender = creator.value;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {});
    const user = createAccount(48);
    const verifier = creator;
    const puzzleCode = createPuzzleCode(1);

    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier.value);
    });

    const mbr = addScoreAs(contract, verifier, user, puzzleCode, Uint64(9));
    expect(mbr).toEqual(contract.boxMbr());

    expect(() =>
      addScoreAs(contract, verifier, user, puzzleCode, Uint64(7)),
    ).toThrow("score already exists for puzzle");
  });

  test("user cannot update another user's score", () => {
    const creator = createAccount(2);
    ctx.defaultSender = creator.value;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {});
    const userA = createAccount(80);
    const userB = createAccount(112);
    const verifier = creator;
    const puzzleCode = createPuzzleCode(2);

    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier.value);
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
    const creator = createAccount(3);
    ctx.defaultSender = creator.value;
    const contract = ctx.contract.create(PuzzleScores);
    const user = createAccount(144);
    const verifier = creator;
    const puzzleCodeA = createPuzzleCode(3);
    const puzzleCodeB = createPuzzleCode(5);

    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier.value);
    });

    ctx.defaultSender = user.value;
    const appCall = ctx.any.txn.applicationCall({
      sender: user.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    const appAccount = (
      ctx.ledger.getApplicationForContract(contract) as unknown as {
        address: ReturnType<typeof ctx.any.account>;
      }
    ).address;

    expect(() =>
      ctx.txn.createScope([appCall], 0).execute(() => {
        const wrongSignals = buildSignalsForSubmission(
          puzzleCodeA.raw,
          user.raw,
          9,
        );
        const pay = ctx.any.txn.payment({
          sender: user.value,
          receiver: appAccount,
          amount: contract.boxMbr(),
        });
        const verifierTxn = ctx.any.txn.payment({
          sender: verifier.value,
          receiver: appAccount,
          amount: Uint64(0),
          fee: Uint64(0),
        });
        withLinkedVerifierReceiver(verifierTxn, () => {
          contract.addScore(
            wrongSignals,
            buildProof(),
            puzzleCodeB.value,
            Uint64(9),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow("public puzzle code must match");
  });

  test("score upload rejects tampered packed sender signals", () => {
    const creator = createAccount(4);
    ctx.defaultSender = creator.value;
    const contract = ctx.contract.create(PuzzleScores);
    const user = createAccount(176);
    const verifier = creator;
    const puzzleCode = createPuzzleCode(4);

    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier.value);
    });

    ctx.defaultSender = user.value;
    const appCall = ctx.any.txn.applicationCall({
      sender: user.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    const appAccount = (
      ctx.ledger.getApplicationForContract(contract) as unknown as {
        address: ReturnType<typeof ctx.any.account>;
      }
    ).address;

    expect(() =>
      ctx.txn.createScope([appCall], 0).execute(() => {
        const signals = buildSignalsForSubmission(puzzleCode.raw, user.raw, 9);
        signals[2] = makeSignal(1);
        const pay = ctx.any.txn.payment({
          sender: user.value,
          receiver: appAccount,
          amount: contract.boxMbr(),
        });
        const verifierTxn = ctx.any.txn.payment({
          sender: verifier.value,
          receiver: appAccount,
          amount: Uint64(0),
          fee: Uint64(0),
        });
        withLinkedVerifierReceiver(verifierTxn, () => {
          contract.addScore(
            signals,
            buildProof(),
            puzzleCode.value,
            Uint64(9),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow();
  });

  test("score upload rejects score mismatch", () => {
    const creator = createAccount(5);
    ctx.defaultSender = creator.value;
    const contract = ctx.contract.create(PuzzleScores);
    const user = createAccount(96);
    const verifier = creator;
    const puzzleCode = createPuzzleCode(6);

    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier.value);
    });

    ctx.defaultSender = user.value;
    const appCall = ctx.any.txn.applicationCall({
      sender: user.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    const appAccount = (
      ctx.ledger.getApplicationForContract(contract) as unknown as {
        address: ReturnType<typeof ctx.any.account>;
      }
    ).address;

    expect(() =>
      ctx.txn.createScope([appCall], 0).execute(() => {
        const wrongScoreSignals = buildSignalsForSubmission(
          puzzleCode.raw,
          user.raw,
          8,
        );
        const pay = ctx.any.txn.payment({
          sender: user.value,
          receiver: appAccount,
          amount: contract.boxMbr(),
        });
        const verifierTxn = ctx.any.txn.payment({
          sender: verifier.value,
          receiver: appAccount,
          amount: Uint64(0),
          fee: Uint64(0),
        });
        withLinkedVerifierReceiver(verifierTxn, () => {
          contract.addScore(
            wrongScoreSignals,
            buildProof(),
            puzzleCode.value,
            Uint64(9),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow("public score must match");
  });

  test("score upload rejects replayed proof from another sender", () => {
    const creator = createAccount(6);
    ctx.defaultSender = creator.value;
    const contract = ctx.contract.create(PuzzleScores);
    const userA = createAccount(16);
    const userB = createAccount(48);
    const verifier = creator;
    const puzzleCode = createPuzzleCode(7);

    const verifierAppCall = ctx.any.txn.applicationCall({
      sender: creator.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([verifierAppCall], 0).execute(() => {
      contract.setVerifier(verifier.value);
    });

    ctx.defaultSender = userB.value;
    const appCall = ctx.any.txn.applicationCall({
      sender: userB.value,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    const appAccount = (
      ctx.ledger.getApplicationForContract(contract) as unknown as {
        address: ReturnType<typeof ctx.any.account>;
      }
    ).address;

    expect(() =>
      ctx.txn.createScope([appCall], 0).execute(() => {
        const replayedSignals = buildSignalsForSubmission(
          puzzleCode.raw,
          userA.raw,
          9,
        );
        const pay = ctx.any.txn.payment({
          sender: userB.value,
          receiver: appAccount,
          amount: contract.boxMbr(),
        });
        const verifierTxn = ctx.any.txn.payment({
          sender: verifier.value,
          receiver: appAccount,
          amount: Uint64(0),
          fee: Uint64(0),
        });
        withLinkedVerifierReceiver(verifierTxn, () => {
          contract.addScore(
            replayedSignals,
            buildProof(),
            puzzleCode.value,
            Uint64(9),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow(/public sender (high|low) bytes must match caller/);
  });
});
