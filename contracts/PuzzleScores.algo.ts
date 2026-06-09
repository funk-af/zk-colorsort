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
const PUBLIC_SCORE_INDEX = Uint64(48);
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
    _puzzleCode: bytes,
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
      signals.length >= PUBLIC_SCORE_INDEX + Uint64(1),
      "public signals length is invalid",
    );

    const expectedScore = BigUint(score);
    const scoreAtEnd =
      signals.at(PUBLIC_SCORE_INDEX)!.asBigUint() === expectedScore;
    const scoreAtStart = signals.at(Uint64(0))!.asBigUint() === expectedScore;

    assert(scoreAtEnd || scoreAtStart, "public score must match");
  }
}
