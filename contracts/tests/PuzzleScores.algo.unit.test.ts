import {
  Global,
  Uint64,
  type bytes,
} from "@algorandfoundation/algorand-typescript";
import { Uint256 } from "@algorandfoundation/algorand-typescript/arc4";
import { TestExecutionContext } from "@algorandfoundation/algorand-typescript-testing";
import algosdk from "algosdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import PuzzleScores from "../PuzzleScores.algo";

function toAddressBytes(address: string): Uint8Array {
  return algosdk.decodeAddress(address).publicKey;
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "asUint8Array" in value &&
    typeof (value as { asUint8Array?: unknown }).asUint8Array === "function"
  ) {
    const bytes = (value as { asUint8Array: () => Uint8Array }).asUint8Array();
    if (bytes instanceof Uint8Array) {
      return bytes;
    }
  }

  return null;
}

function getSenderBytes(sender: unknown): Uint8Array {
  const directSenderBytes = toUint8Array(sender);
  if (directSenderBytes) {
    return directSenderBytes;
  }

  if (typeof sender === "string") {
    return toAddressBytes(sender);
  }

  const senderBytes = toUint8Array((sender as { bytes?: unknown }).bytes);
  if (senderBytes) {
    return senderBytes;
  }

  const senderPublicKey = toUint8Array(
    (sender as { publicKey?: unknown }).publicKey,
  );
  if (senderPublicKey) {
    return senderPublicKey;
  }

  throw new Error("Unable to derive sender bytes");
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function buildSignalsForPuzzle(
  puzzleCode: Uint8Array,
  score: bigint | number,
  senderAddress: unknown,
  options?: {
    scoreSignal?: bigint | number;
    puzzleLimbOverrides?: Partial<Record<0 | 1 | 2, bigint>>;
    senderLimbOverrides?: Partial<Record<0 | 1 | 2 | 3, bigint>>;
    truncateToLength?: number;
  },
) {
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

  const puzzleLimb0 = bytesToBigInt(puzzleCode.slice(0, 8));
  const puzzleLimb1 = bytesToBigInt(puzzleCode.slice(8, 16));
  const puzzleLimb2 = bytesToBigInt(puzzleCode.slice(16, 20));
  const senderBytes = getSenderBytes(senderAddress);
  const senderLimb0 = bytesToBigInt(senderBytes.slice(0, 8));
  const senderLimb1 = bytesToBigInt(senderBytes.slice(8, 16));
  const senderLimb2 = bytesToBigInt(senderBytes.slice(16, 24));
  const senderLimb3 = bytesToBigInt(senderBytes.slice(24, 32));

  signals.push(toSignal(options?.scoreSignal ?? score));
  signals.push(toSignal(options?.puzzleLimbOverrides?.[0] ?? puzzleLimb0));
  signals.push(toSignal(options?.puzzleLimbOverrides?.[1] ?? puzzleLimb1));
  signals.push(toSignal(options?.puzzleLimbOverrides?.[2] ?? puzzleLimb2));
  signals.push(toSignal(options?.senderLimbOverrides?.[0] ?? senderLimb0));
  signals.push(toSignal(options?.senderLimbOverrides?.[1] ?? senderLimb1));
  signals.push(toSignal(options?.senderLimbOverrides?.[2] ?? senderLimb2));
  signals.push(toSignal(options?.senderLimbOverrides?.[3] ?? senderLimb3));

  if (options?.truncateToLength !== undefined) {
    signals.length = options.truncateToLength;
  }

  return signals;
}

function createPuzzleCode(ctx: TestExecutionContext): {
  raw: Uint8Array;
  value: bytes<20>;
} {
  const value = ctx.any.bytes(20) as bytes<20> & {
    asUint8Array: () => Uint8Array;
  };
  const raw = new Uint8Array(value.asUint8Array());

  return {
    raw,
    value,
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
          buildSignalsForPuzzle(puzzleCode.raw, score, sender),
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
          buildSignalsForPuzzle(puzzleCode.raw, score, sender),
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
    const puzzleCode = createPuzzleCode(ctx);

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
    const puzzleCode = createPuzzleCode(ctx);

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
    const puzzleCode = createPuzzleCode(ctx);

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
    const puzzleCode = createPuzzleCode(ctx);

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
          puzzleCode.raw,
          Uint64(9),
          user,
          {
            puzzleLimbOverrides: { 0: 1n },
          },
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

  test("score upload rejects mismatched public sender signals", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {
      throw new Error("public sender must match caller");
    });
    const user = ctx.any.account();
    const verifier = creator;
    const puzzleCode = createPuzzleCode(ctx);

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
        const signals = buildSignalsForPuzzle(
          puzzleCode.raw,
          Uint64(7),
          verifier,
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
            signals,
            buildProof(),
            puzzleCode.value,
            Uint64(7),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow("public sender must match caller");
  });

  test("score upload rejects when verifier is not configured", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    const user = ctx.any.account();
    const verifier = ctx.any.account();
    const puzzleCode = createPuzzleCode(ctx);

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
        const signals = buildSignalsForPuzzle(puzzleCode.raw, Uint64(6), user);
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
            signals,
            buildProof(),
            puzzleCode.value,
            Uint64(6),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow("verifier is not configured");
  });

  test("score upload rejects when verifier transaction sender is not configured verifier", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    const user = ctx.any.account();
    const verifier = creator;
    const wrongVerifier = ctx.any.account();
    const puzzleCode = createPuzzleCode(ctx);

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
        const signals = buildSignalsForPuzzle(puzzleCode.raw, Uint64(8), user);
        const pay = ctx.any.txn.payment({
          sender: user,
          receiver: appAccount,
          amount: contract.boxMbr(),
        });
        const verifierTxn = ctx.any.txn.payment({
          sender: wrongVerifier,
          receiver: appAccount,
          amount: Uint64(0),
          fee: Uint64(0),
        });
        withLinkedVerifierReceiver(verifierTxn, () => {
          contract.addScore(
            signals,
            buildProof(),
            puzzleCode.value,
            Uint64(8),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow("verifier txn must come from the verifier");
  });

  test("score upload rejects when verifier transaction receiver is not app account", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    const user = ctx.any.account();
    const verifier = creator;
    const puzzleCode = createPuzzleCode(ctx);

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
        const signals = buildSignalsForPuzzle(puzzleCode.raw, Uint64(11), user);
        const pay = ctx.any.txn.payment({
          sender: user,
          receiver: appAccount,
          amount: contract.boxMbr(),
        });
        const verifierTxn = ctx.any.txn.payment({
          sender: verifier,
          receiver: ctx.any.account(),
          amount: Uint64(0),
          fee: Uint64(0),
        });
        contract.addScore(
          signals,
          buildProof(),
          puzzleCode.value,
          Uint64(11),
          pay,
          verifierTxn,
        );
      }),
    ).toThrow("verifier txn receiver must be app account");
  });

  test("score upload rejects short public signal arrays", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    const user = ctx.any.account();
    const verifier = creator;
    const puzzleCode = createPuzzleCode(ctx);

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
        const shortSignals = buildSignalsForPuzzle(
          puzzleCode.raw,
          Uint64(10),
          user,
          {
            truncateToLength: 7,
          },
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
            shortSignals,
            buildProof(),
            puzzleCode.value,
            Uint64(10),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow("public signals length is invalid");
  });

  test("score upload rejects mismatched public score signal", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {
      throw new Error("public score must match");
    });
    const user = ctx.any.account();
    const verifier = creator;
    const puzzleCode = createPuzzleCode(ctx);

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
        const badScoreSignals = buildSignalsForPuzzle(
          puzzleCode.raw,
          Uint64(10),
          user,
          {
            scoreSignal: 9n,
          },
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
            badScoreSignals,
            buildProof(),
            puzzleCode.value,
            Uint64(10),
            pay,
            verifierTxn,
          );
        });
      }),
    ).toThrow("public score must match");
  });

  const setupSponsoredContract = (options?: { mockVerify?: boolean }) => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    if (options?.mockVerify !== false) {
      vi.spyOn(
        contract as unknown as { verifyVerifierTxn: () => void },
        "verifyVerifierTxn",
      ).mockImplementation(() => {});
    }
    const verifier = creator;
    const sponsor = ctx.any.account();
    const app = ctx.ledger.getApplicationForContract(contract);

    const configCall = ctx.any.txn.applicationCall({
      sender: creator,
      appId: app,
    });
    ctx.txn.createScope([configCall], 0).execute(() => {
      contract.setVerifier(verifier);
      contract.setSponsor(sponsor);
    });

    return { contract, creator, verifier, sponsor };
  };

  const createUserKey = (): { raw: Uint8Array; value: bytes<32> } => {
    const value = ctx.any.bytes(32) as bytes<32> & {
      asUint8Array: () => Uint8Array;
    };
    return { raw: new Uint8Array(value.asUint8Array()), value };
  };

  const addSponsoredScoreAs = (
    contract: PuzzleScores,
    verifier: ReturnType<typeof ctx.any.account>,
    sender: ReturnType<typeof ctx.any.account>,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    userKey: { raw: Uint8Array; value: bytes<32> },
    score: ReturnType<typeof Uint64>,
    signalIdentity?: Uint8Array,
  ) => {
    ctx.defaultSender = sender;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appAccount = (
      app as unknown as { address: ReturnType<typeof ctx.any.account> }
    ).address;
    const appCall = ctx.any.txn.applicationCall({ sender, appId: app });

    ctx.txn.createScope([appCall], 0).execute(() => {
      const verifierTxn = ctx.any.txn.payment({
        sender: verifier,
        receiver: appAccount,
        amount: Uint64(0),
        fee: Uint64(0),
      });
      withLinkedVerifierReceiver(verifierTxn, () => {
        contract.addSponsoredScore(
          buildSignalsForPuzzle(
            puzzleCode.raw,
            score,
            signalIdentity ?? userKey.raw,
          ),
          buildProof(),
          puzzleCode.value,
          userKey.value,
          score,
          verifierTxn,
        );
      });
    });
  };

  const updateSponsoredScoreAs = (
    contract: PuzzleScores,
    verifier: ReturnType<typeof ctx.any.account>,
    sender: ReturnType<typeof ctx.any.account>,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    userKey: { raw: Uint8Array; value: bytes<32> },
    score: ReturnType<typeof Uint64>,
  ) => {
    ctx.defaultSender = sender;
    const app = ctx.ledger.getApplicationForContract(contract);
    const appAccount = (
      app as unknown as { address: ReturnType<typeof ctx.any.account> }
    ).address;
    const appCall = ctx.any.txn.applicationCall({ sender, appId: app });

    ctx.txn.createScope([appCall], 0).execute(() => {
      const verifierTxn = ctx.any.txn.payment({
        sender: verifier,
        receiver: appAccount,
        amount: Uint64(0),
        fee: Uint64(0),
      });
      withLinkedVerifierReceiver(verifierTxn, () => {
        contract.updateSponsoredScore(
          buildSignalsForPuzzle(puzzleCode.raw, score, userKey.raw),
          buildProof(),
          puzzleCode.value,
          userKey.value,
          score,
          verifierTxn,
        );
      });
    });
  };

  const sweepSponsoredAs = (
    contract: PuzzleScores,
    sender: ReturnType<typeof ctx.any.account>,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    userKeys: { raw: Uint8Array; value: bytes<32> }[],
  ) => {
    ctx.defaultSender = sender;
    const appCall = ctx.any.txn.applicationCall({
      sender,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    ctx.txn.createScope([appCall], 0).execute(() => {
      contract.sweepSponsoredScores(
        puzzleCode.value,
        userKeys.map((key) => key.value),
      );
    });
  };

  const getSponsoredScoreAs = (
    contract: PuzzleScores,
    sender: ReturnType<typeof ctx.any.account>,
    puzzleCode: { raw: Uint8Array; value: bytes<20> },
    userKey: { raw: Uint8Array; value: bytes<32> },
  ) => {
    ctx.defaultSender = sender;
    const appCall = ctx.any.txn.applicationCall({
      sender,
      appId: ctx.ledger.getApplicationForContract(contract),
    });
    return ctx.txn.createScope([appCall], 0).execute(() => {
      return contract.getSponsoredScore(puzzleCode.value, userKey.value);
    });
  };

  test("sponsored box MBR covers a 53-byte key and 2-byte value", () => {
    const { contract } = setupSponsoredContract();
    expect(contract.sponsoredBoxMbr()).toEqual(Uint64(2_500 + 400 * 55));
  });

  test("sponsor can add, update, read and sweep sponsored scores", () => {
    const { contract, verifier, sponsor } = setupSponsoredContract();
    const puzzleCode = createPuzzleCode(ctx);
    const userA = createUserKey();
    const userB = createUserKey();
    const missing = createUserKey();

    addSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, userA, Uint64(20));
    addSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, userB, Uint64(30));

    expect(getSponsoredScoreAs(contract, sponsor, puzzleCode, userA)).toEqual([
      Uint64(20),
      Uint64(0),
      true,
    ]);
    expect(getSponsoredScoreAs(contract, sponsor, puzzleCode, userB)).toEqual([
      Uint64(30),
      Uint64(0),
      true,
    ]);

    updateSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, userA, Uint64(15));
    expect(getSponsoredScoreAs(contract, sponsor, puzzleCode, userA)).toEqual([
      Uint64(15),
      Uint64(1),
      true,
    ]);

    expect(() =>
      updateSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, userA, Uint64(15)),
    ).toThrow("new score must be better");

    // Sweep tolerates keys that do not exist and is idempotent.
    sweepSponsoredAs(contract, sponsor, puzzleCode, [userA, missing, userB]);
    expect(getSponsoredScoreAs(contract, sponsor, puzzleCode, userA)).toEqual([
      Uint64(0),
      Uint64(0),
      false,
    ]);
    expect(getSponsoredScoreAs(contract, sponsor, puzzleCode, userB)).toEqual([
      Uint64(0),
      Uint64(0),
      false,
    ]);
    sweepSponsoredAs(contract, sponsor, puzzleCode, [userA]);
  });

  test("sponsored methods reject callers other than the sponsor", () => {
    const { contract, verifier, sponsor } = setupSponsoredContract();
    const puzzleCode = createPuzzleCode(ctx);
    const user = createUserKey();
    const stranger = ctx.any.account();

    expect(() =>
      addSponsoredScoreAs(contract, verifier, stranger, puzzleCode, user, Uint64(10)),
    ).toThrow("only the sponsor can manage sponsored scores");

    addSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, user, Uint64(10));

    expect(() =>
      updateSponsoredScoreAs(contract, verifier, stranger, puzzleCode, user, Uint64(5)),
    ).toThrow("only the sponsor can manage sponsored scores");
    expect(() =>
      sweepSponsoredAs(contract, stranger, puzzleCode, [user]),
    ).toThrow("only the sponsor can manage sponsored scores");

    expect(getSponsoredScoreAs(contract, sponsor, puzzleCode, user)).toEqual([
      Uint64(10),
      Uint64(0),
      true,
    ]);
  });

  test("sponsored add rejects when sponsor is not configured", () => {
    const creator = ctx.any.account();
    ctx.defaultSender = creator;
    const contract = ctx.contract.create(PuzzleScores);
    vi.spyOn(
      contract as unknown as { verifyVerifierTxn: () => void },
      "verifyVerifierTxn",
    ).mockImplementation(() => {});
    const puzzleCode = createPuzzleCode(ctx);
    const user = createUserKey();

    expect(() =>
      addSponsoredScoreAs(contract, creator, creator, puzzleCode, user, Uint64(10)),
    ).toThrow("sponsor is not configured");
  });

  test("sponsored add rejects duplicate user key for the same puzzle", () => {
    const { contract, verifier, sponsor } = setupSponsoredContract();
    const puzzleCode = createPuzzleCode(ctx);
    const user = createUserKey();

    addSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, user, Uint64(10));
    expect(() =>
      addSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, user, Uint64(9)),
    ).toThrow("sponsored score already exists for puzzle");
  });

  test("sponsored update cap stops after eight improvements", () => {
    const { contract, verifier, sponsor } = setupSponsoredContract();
    const puzzleCode = createPuzzleCode(ctx);
    const user = createUserKey();

    addSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, user, Uint64(40));
    for (let i = 1; i <= 8; i += 1) {
      updateSponsoredScoreAs(
        contract,
        verifier,
        sponsor,
        puzzleCode,
        user,
        Uint64(40 - i),
      );
    }
    expect(getSponsoredScoreAs(contract, sponsor, puzzleCode, user)).toEqual([
      Uint64(32),
      Uint64(8),
      true,
    ]);

    expect(() =>
      updateSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, user, Uint64(31)),
    ).toThrow("sponsored update cap reached");
  });

  test("sponsored daily cap limits adds per puzzle and resets on a new puzzle", () => {
    const { contract, verifier, sponsor } = setupSponsoredContract();
    const puzzleCode = createPuzzleCode(ctx);

    for (let i = 0; i < 1_000; i += 1) {
      addSponsoredScoreAs(
        contract,
        verifier,
        sponsor,
        puzzleCode,
        createUserKey(),
        Uint64(10),
      );
    }

    expect(() =>
      addSponsoredScoreAs(
        contract,
        verifier,
        sponsor,
        puzzleCode,
        createUserKey(),
        Uint64(10),
      ),
    ).toThrow("sponsored daily cap reached");

    const nextPuzzle = createPuzzleCode(ctx);
    const user = createUserKey();
    addSponsoredScoreAs(contract, verifier, sponsor, nextPuzzle, user, Uint64(10));
    expect(getSponsoredScoreAs(contract, sponsor, nextPuzzle, user)).toEqual([
      Uint64(10),
      Uint64(0),
      true,
    ]);
  });

  test("sponsored add binds the proof identity limbs to the user key", () => {
    const { contract, verifier, sponsor } = setupSponsoredContract({
      mockVerify: false,
    });
    const puzzleCode = createPuzzleCode(ctx);
    const user = createUserKey();
    const other = createUserKey();

    expect(() =>
      addSponsoredScoreAs(
        contract,
        verifier,
        sponsor,
        puzzleCode,
        user,
        Uint64(12),
        other.raw,
      ),
    ).toThrow("public sender must match caller");

    addSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, user, Uint64(12));
    expect(getSponsoredScoreAs(contract, sponsor, puzzleCode, user)).toEqual([
      Uint64(12),
      Uint64(0),
      true,
    ]);
  });

  test("sponsored boxes do not collide with wallet score boxes", () => {
    const { contract, verifier, sponsor } = setupSponsoredContract();
    const puzzleCode = createPuzzleCode(ctx);
    const wallet = ctx.any.account();
    const user = createUserKey();

    addScoreAs(contract, verifier, wallet, puzzleCode, Uint64(21));
    addSponsoredScoreAs(contract, verifier, sponsor, puzzleCode, user, Uint64(19));

    expect(getScoreForUserAs(contract, wallet, puzzleCode, wallet)).toEqual([
      Uint64(21),
      true,
    ]);
    expect(getSponsoredScoreAs(contract, sponsor, puzzleCode, user)).toEqual([
      Uint64(19),
      Uint64(0),
      true,
    ]);

    sweepSponsoredAs(contract, sponsor, puzzleCode, [user]);
    expect(getScoreForUserAs(contract, wallet, puzzleCode, wallet)).toEqual([
      Uint64(21),
      true,
    ]);
  });
});
