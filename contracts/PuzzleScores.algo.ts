import type {
  Account,
  bytes,
  gtxn,
  uint64,
} from "@algorandfoundation/algorand-typescript";
import {
  abimethod,
  assert,
  BigUint,
  Contract,
  ensureBudget,
  Global,
  GlobalState,
  itxn,
  OpUpFeeSource,
  readonly,
  Txn,
  Uint64,
} from "@algorandfoundation/algorand-typescript";
import { Uint256 } from "@algorandfoundation/algorand-typescript/arc4";
import {
  Box as BoxOp,
  btoi,
  getByte,
  itob,
} from "@algorandfoundation/algorand-typescript/op";

const BOX_BASE_MBR = Uint64(2_500);
const BOX_BYTE_MBR = Uint64(400);
const PUZZLE_CODE_LENGTH = Uint64(20);
const PUBLIC_SIGNALS_LENGTH = Uint64(4);
const PUBLIC_SCORE_INDEX = Uint64(0);
const PUBLIC_PUZZLE_INDEX = Uint64(1);
const PUBLIC_SENDER_HI_INDEX = Uint64(2);
const PUBLIC_SENDER_LO_INDEX = Uint64(3);
const PUBLIC_SENDER_HALF_LENGTH = Uint64(16);
const PACKED_BYTE_BASE = BigUint(Uint64(256));
const ZERO_BIGUINT = BigUint(Uint64(0));
const SCORE_LENGTH = Uint64(8);
const SCORE_KEY_LENGTH = Uint64(52);
const VERIFY_OPCODE_BUDGET = Uint64(4900);
type PublicSignals = Uint256[];
type Groth16Bn254Proof = {
  piA: bytes<64>;
  piB: bytes<128>;
  piC: bytes<64>;
};

export default class PuzzleScores extends Contract {
  verifier = GlobalState<Account>({ key: "verifier" });

  @readonly
  public boxMbr(): uint64 {
    return this.scoreBoxMbr();
  }

  public setVerifier(verifierAddress: Account): void {
    assert(
      Txn.sender === Global.creatorAddress,
      "only the creator can set the verifier",
    );
    this.verifier.value = verifierAddress;
  }

  public updateApplication(): void {
    assert(
      Txn.sender === Global.creatorAddress,
      "only the creator can update the app",
    );
  }

  public addScore(
    signals: PublicSignals,
    proof: Groth16Bn254Proof,
    puzzleCode: bytes,
    score: uint64,
    payMbr: gtxn.PaymentTxn,
    verifierTxn: gtxn.PaymentTxn,
  ): void {
    const key = this.scoreKey(puzzleCode, Txn.sender);
    const [, exists] = BoxOp.get(key);
    assert(!exists, "score already exists for puzzle");

    this.verifyVerifierTxn(verifierTxn, signals, proof, puzzleCode, score);

    const requiredMbr = this.scoreBoxMbr();
    assert(
      Txn.sender.bytes
        .slice(0, Uint64(32))
        .equals(payMbr.sender.bytes.slice(0, Uint64(32))),
      "payment sender must match caller",
    );
    assert(
      Global.currentApplicationAddress.bytes
        .slice(0, Uint64(32))
        .equals(payMbr.receiver.bytes.slice(0, Uint64(32))),
      "payment receiver must be app account",
    );
    assert(payMbr.amount === requiredMbr, "payment must cover box MBR exactly");

    BoxOp.put(key, itob(score));
  }

  public updateScore(
    signals: PublicSignals,
    proof: Groth16Bn254Proof,
    puzzleCode: bytes,
    newScore: uint64,
    verifierTxn: gtxn.PaymentTxn,
  ): void {
    const key = this.scoreKey(puzzleCode, Txn.sender);
    const [scoreBytes, exists] = BoxOp.get(key);
    assert(exists, "score does not exist for puzzle");

    this.verifyVerifierTxn(verifierTxn, signals, proof, puzzleCode, newScore);

    assert(newScore < btoi(scoreBytes), "new score must be better");
    BoxOp.put(key, itob(newScore));
  }

  public removeScore(puzzleCode: bytes): void {
    const key = this.scoreKey(puzzleCode, Txn.sender);
    const deleted = BoxOp.delete(key);
    assert(deleted, "score does not exist for puzzle");

    itxn
      .payment({
        receiver: Txn.sender,
        amount: this.scoreBoxMbr(),
        fee: 0,
      })
      .submit();
  }

  @readonly
  public getMyScore(puzzleCode: bytes): [uint64, boolean] {
    return this.getScoreForUser(puzzleCode, Txn.sender);
  }

  @readonly
  public getScoreForUser(puzzleCode: bytes, user: Account): [uint64, boolean] {
    const [scoreBytes, exists] = BoxOp.get(this.scoreKey(puzzleCode, user));

    if (!exists) {
      return [Uint64(0), false];
    }

    return [btoi(scoreBytes), true];
  }

  private scoreKey(puzzleCode: bytes, user: Account): bytes {
    return puzzleCode.concat(user.bytes);
  }

  private scoreBoxMbr(): uint64 {
    return BOX_BASE_MBR + BOX_BYTE_MBR * (SCORE_KEY_LENGTH + SCORE_LENGTH);
  }

  private verifyVerifierTxn(
    verifierTxn: gtxn.PaymentTxn,
    signals: PublicSignals,
    _proof: Groth16Bn254Proof,
    puzzleCode: bytes,
    score: uint64,
  ): void {
    // Ensure enough budget for bigint packing/comparison checks in this routine.
    ensureBudget(VERIFY_OPCODE_BUDGET, OpUpFeeSource.GroupCredit);

    assert(this.verifier.hasValue, "verifier is not configured");
    assert(
      verifierTxn.sender === this.verifier.value,
      "verifier txn must come from the verifier",
    );
    assert(
      Global.currentApplicationAddress === verifierTxn.receiver,
      "verifier txn receiver must be app account",
    );

    assert(
      signals.length >= PUBLIC_SIGNALS_LENGTH &&
        signals.length <= PUBLIC_SIGNALS_LENGTH,
      "public signals length is invalid",
    );
    assert(
      puzzleCode.length >= PUZZLE_CODE_LENGTH &&
        puzzleCode.length <= PUZZLE_CODE_LENGTH,
      "puzzle code length is invalid",
    );

    const packedPuzzle = this.packBytesToBigUint(
      puzzleCode,
      Uint64(0),
      PUZZLE_CODE_LENGTH,
    );
    assert(
      signals.at(PUBLIC_PUZZLE_INDEX)!.asBigUint() === packedPuzzle,
      "public puzzle code must match",
    );

    const packedSenderHi = this.packBytesToBigUint(
      Txn.sender.bytes,
      Uint64(0),
      PUBLIC_SENDER_HALF_LENGTH,
    );
    const packedSenderLo = this.packBytesToBigUint(
      Txn.sender.bytes,
      PUBLIC_SENDER_HALF_LENGTH,
      PUBLIC_SENDER_HALF_LENGTH,
    );

    assert(
      signals.at(PUBLIC_SENDER_HI_INDEX)!.asBigUint() === packedSenderHi,
      "public sender high bytes must match caller",
    );
    assert(
      signals.at(PUBLIC_SENDER_LO_INDEX)!.asBigUint() === packedSenderLo,
      "public sender low bytes must match caller",
    );

    const expectedScore = BigUint(score);
    assert(
      signals.at(PUBLIC_SCORE_INDEX)!.asBigUint() === expectedScore,
      "public score must match",
    );
  }

  private packBytesToBigUint(source: bytes, start: uint64, length: uint64) {
    let packedValue = ZERO_BIGUINT;

    for (
      let byteIndex = Uint64(0);
      byteIndex < length;
      byteIndex = byteIndex + Uint64(1)
    ) {
      packedValue =
        packedValue * PACKED_BYTE_BASE +
        BigUint(getByte(source, start + byteIndex));
    }

    return packedValue;
  }
}
