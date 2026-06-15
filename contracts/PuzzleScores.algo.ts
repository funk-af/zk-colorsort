import type {
  Account,
  bytes,
  gtxn,
  uint64,
} from "@algorandfoundation/algorand-typescript";
import {
  assert,
  BigUint,
  Contract,
  Global,
  GlobalState,
  itxn,
  readonly,
  Txn,
  Uint64,
} from "@algorandfoundation/algorand-typescript";
import { Uint256 } from "@algorandfoundation/algorand-typescript/arc4";
import {
  Box as BoxOp,
  btoi,
  itob,
} from "@algorandfoundation/algorand-typescript/op";

const BOX_BASE_MBR = Uint64(2_500);
const BOX_BYTE_MBR = Uint64(400);
const PUBLIC_SIGNAL_COUNT = Uint64(8);
const SCORE_SIGNAL_INDEX = Uint64(0);
const PUZZLE_LIMB_0_INDEX = Uint64(1);
const PUZZLE_LIMB_1_INDEX = Uint64(2);
const PUZZLE_LIMB_2_INDEX = Uint64(3);
const SENDER_LIMB_0_INDEX = Uint64(4);
const SENDER_LIMB_1_INDEX = Uint64(5);
const SENDER_LIMB_2_INDEX = Uint64(6);
const SENDER_LIMB_3_INDEX = Uint64(7);
const PUZZLE_CODE_LENGTH = Uint64(20);
const SCORE_LENGTH = Uint64(8);
const SCORE_KEY_LENGTH = Uint64(52);
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
      signals.length >= PUBLIC_SIGNAL_COUNT,
      "public signals length is invalid",
    );
    assert(
      puzzleCode.length === PUZZLE_CODE_LENGTH,
      "puzzle code length is invalid",
    );

    const expectedScore = BigUint(score);
    const scoreAtOutput =
      signals.at(SCORE_SIGNAL_INDEX)!.asBigUint() === expectedScore;

    const puzzleLimb0 = btoi(puzzleCode.slice(Uint64(0), Uint64(8)));
    const puzzleLimb1 = btoi(puzzleCode.slice(Uint64(8), Uint64(16)));
    const puzzleLimb2 = btoi(puzzleCode.slice(Uint64(16), Uint64(20)));

    const senderLimb0 = btoi(Txn.sender.bytes.slice(Uint64(0), Uint64(8)));
    const senderLimb1 = btoi(Txn.sender.bytes.slice(Uint64(8), Uint64(16)));
    const senderLimb2 = btoi(Txn.sender.bytes.slice(Uint64(16), Uint64(24)));
    const senderLimb3 = btoi(Txn.sender.bytes.slice(Uint64(24), Uint64(32)));

    const puzzleMatches =
      signals.at(PUZZLE_LIMB_0_INDEX)!.asBigUint() === BigUint(puzzleLimb0) &&
      signals.at(PUZZLE_LIMB_1_INDEX)!.asBigUint() === BigUint(puzzleLimb1) &&
      signals.at(PUZZLE_LIMB_2_INDEX)!.asBigUint() === BigUint(puzzleLimb2);

    const senderMatches =
      signals.at(SENDER_LIMB_0_INDEX)!.asBigUint() === BigUint(senderLimb0) &&
      signals.at(SENDER_LIMB_1_INDEX)!.asBigUint() === BigUint(senderLimb1) &&
      signals.at(SENDER_LIMB_2_INDEX)!.asBigUint() === BigUint(senderLimb2) &&
      signals.at(SENDER_LIMB_3_INDEX)!.asBigUint() === BigUint(senderLimb3);

    assert(scoreAtOutput, "public score must match");
    assert(puzzleMatches, "public puzzle code must match");
    assert(senderMatches, "public sender must match caller");
  }
}
