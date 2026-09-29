import type {
  Account,
  bytes,
  gtxn,
  uint64,
} from "@algorandfoundation/algorand-typescript";
import {
  assert,
  BigUint,
  Bytes,
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
const SCORE_LENGTH = Uint64(1);
const SCORE_KEY_LENGTH = Uint64(52);
const MAX_STORED_SCORE = Uint64(255);
// Sponsored scores: boxes keyed by "s" + puzzleCode(20) + userKey(32), holding
// score(1) + updates(1). MBR for these boxes comes from the app account's own
// balance, so no payment txn is required and deleting them releases the MBR
// back to the app account automatically.
const SPONSORED_PREFIX = Bytes("s");
const USER_KEY_LENGTH = Uint64(32);
const SPONSORED_KEY_LENGTH = Uint64(53);
const SPONSORED_VALUE_LENGTH = Uint64(2);
const MAX_SPONSORED_UPDATES = Uint64(8);
const SPONSORED_DAILY_CAP = Uint64(1_000);
type PublicSignals = Uint256[];
type Groth16Bn254Proof = {
  piA: bytes<64>;
  piB: bytes<128>;
  piC: bytes<64>;
};

export default class PuzzleScores extends Contract {
  verifier = GlobalState<Account>({ key: "verifier" });
  // Sponsor configuration. Note: adding these globals grows the schema
  // (ints 1, bytes 3); an existing deployment must be updated with an update
  // transaction that carries the new schema (see contracts/deploy-config.ts).
  sponsor = GlobalState<Account>({ key: "sponsor" });
  sponsoredPuzzle = GlobalState<bytes>({ key: "sponsoredPuzzle" });
  sponsoredCount = GlobalState<uint64>({ key: "sponsoredCount" });

  @readonly
  public boxMbr(): uint64 {
    return this.scoreBoxMbr();
  }

  @readonly
  public sponsoredBoxMbr(): uint64 {
    return BOX_BASE_MBR + BOX_BYTE_MBR * (SPONSORED_KEY_LENGTH + SPONSORED_VALUE_LENGTH);
  }

  public setVerifier(verifierAddress: Account): void {
    assert(
      Txn.sender === Global.creatorAddress,
      "only the creator can set the verifier",
    );
    this.verifier.value = verifierAddress;
  }

  public setSponsor(sponsorAddress: Account): void {
    assert(
      Txn.sender === Global.creatorAddress,
      "only the creator can set the sponsor",
    );
    this.sponsor.value = sponsorAddress;
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
    assert(score <= MAX_STORED_SCORE, "score exceeds one-byte storage");

    const key = this.scoreKey(puzzleCode, Txn.sender);
    const [, exists] = BoxOp.get(key);
    assert(!exists, "score already exists for puzzle");

    this.verifyVerifierTxn(
      verifierTxn,
      signals,
      proof,
      puzzleCode,
      score,
      Txn.sender.bytes,
    );

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

    BoxOp.put(key, this.encodeScoreByte(score));
  }

  public updateScore(
    signals: PublicSignals,
    proof: Groth16Bn254Proof,
    puzzleCode: bytes,
    newScore: uint64,
    verifierTxn: gtxn.PaymentTxn,
  ): void {
    assert(newScore <= MAX_STORED_SCORE, "score exceeds one-byte storage");

    const key = this.scoreKey(puzzleCode, Txn.sender);
    const [scoreBytes, exists] = BoxOp.get(key);
    assert(exists, "score does not exist for puzzle");

    this.verifyVerifierTxn(
      verifierTxn,
      signals,
      proof,
      puzzleCode,
      newScore,
      Txn.sender.bytes,
    );

    assert(newScore < btoi(scoreBytes), "new score must be better");
    BoxOp.put(key, this.encodeScoreByte(newScore));
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

  /**
   * Sponsored add: the configured sponsor submits a score on behalf of a
   * 32-byte user key (e.g. a hash of a Discord user id). The proof's identity
   * limbs must match `userKey`. Box MBR is taken from the app account balance.
   */
  public addSponsoredScore(
    signals: PublicSignals,
    proof: Groth16Bn254Proof,
    puzzleCode: bytes,
    userKey: bytes,
    score: uint64,
    verifierTxn: gtxn.PaymentTxn,
  ): void {
    this.assertSponsor();
    assert(score <= MAX_STORED_SCORE, "score exceeds one-byte storage");
    assert(userKey.length === USER_KEY_LENGTH, "user key length is invalid");

    const key = this.sponsoredKey(puzzleCode, userKey);
    const [, exists] = BoxOp.get(key);
    assert(!exists, "sponsored score already exists for puzzle");

    this.verifyVerifierTxn(
      verifierTxn,
      signals,
      proof,
      puzzleCode,
      score,
      userKey,
    );

    let count: uint64 = Uint64(0);
    if (
      this.sponsoredPuzzle.hasValue &&
      this.sponsoredPuzzle.value.equals(puzzleCode)
    ) {
      count = this.sponsoredCount.hasValue ? this.sponsoredCount.value : Uint64(0);
    } else {
      this.sponsoredPuzzle.value = puzzleCode;
    }
    assert(count < SPONSORED_DAILY_CAP, "sponsored daily cap reached");
    this.sponsoredCount.value = count + Uint64(1);

    BoxOp.put(key, this.encodeSponsoredValue(score, Uint64(0)));
  }

  public updateSponsoredScore(
    signals: PublicSignals,
    proof: Groth16Bn254Proof,
    puzzleCode: bytes,
    userKey: bytes,
    newScore: uint64,
    verifierTxn: gtxn.PaymentTxn,
  ): void {
    this.assertSponsor();
    assert(newScore <= MAX_STORED_SCORE, "score exceeds one-byte storage");
    assert(userKey.length === USER_KEY_LENGTH, "user key length is invalid");

    const key = this.sponsoredKey(puzzleCode, userKey);
    const [valueBytes, exists] = BoxOp.get(key);
    assert(exists, "sponsored score does not exist for puzzle");

    this.verifyVerifierTxn(
      verifierTxn,
      signals,
      proof,
      puzzleCode,
      newScore,
      userKey,
    );

    const currentScore = this.decodeSponsoredScore(valueBytes);
    const updates = this.decodeSponsoredUpdates(valueBytes);
    assert(updates < MAX_SPONSORED_UPDATES, "sponsored update cap reached");
    assert(newScore < currentScore, "new score must be better");

    BoxOp.put(key, this.encodeSponsoredValue(newScore, updates + Uint64(1)));
  }

  /**
   * Deletes sponsored score boxes for a puzzle. Missing keys are ignored so
   * the sweep is idempotent. Deleting a box releases its MBR to the app
   * account. Callers should pass at most 8 keys per call (box reference limit).
   */
  public sweepSponsoredScores(puzzleCode: bytes, userKeys: bytes[]): void {
    this.assertSponsor();
    assert(
      puzzleCode.length === PUZZLE_CODE_LENGTH,
      "puzzle code length is invalid",
    );

    for (const userKey of userKeys) {
      assert(userKey.length === USER_KEY_LENGTH, "user key length is invalid");
      BoxOp.delete(this.sponsoredKey(puzzleCode, userKey));
    }
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

  @readonly
  public getSponsoredScore(
    puzzleCode: bytes,
    userKey: bytes,
  ): [uint64, uint64, boolean] {
    assert(userKey.length === USER_KEY_LENGTH, "user key length is invalid");
    const [valueBytes, exists] = BoxOp.get(
      this.sponsoredKey(puzzleCode, userKey),
    );

    if (!exists) {
      return [Uint64(0), Uint64(0), false];
    }

    return [
      this.decodeSponsoredScore(valueBytes),
      this.decodeSponsoredUpdates(valueBytes),
      true,
    ];
  }

  private assertSponsor(): void {
    assert(this.sponsor.hasValue, "sponsor is not configured");
    assert(
      Txn.sender === this.sponsor.value,
      "only the sponsor can manage sponsored scores",
    );
  }

  private scoreKey(puzzleCode: bytes, user: Account): bytes {
    return puzzleCode.concat(user.bytes);
  }

  private sponsoredKey(puzzleCode: bytes, userKey: bytes): bytes {
    return SPONSORED_PREFIX.concat(puzzleCode).concat(userKey);
  }

  private scoreBoxMbr(): uint64 {
    return BOX_BASE_MBR + BOX_BYTE_MBR * (SCORE_KEY_LENGTH + SCORE_LENGTH);
  }

  private encodeScoreByte(score: uint64): bytes {
    return itob(score).slice(Uint64(7), Uint64(8));
  }

  private encodeSponsoredValue(score: uint64, updates: uint64): bytes {
    return this.encodeScoreByte(score).concat(this.encodeScoreByte(updates));
  }

  private decodeSponsoredScore(valueBytes: bytes): uint64 {
    return btoi(valueBytes.slice(Uint64(0), Uint64(1)));
  }

  private decodeSponsoredUpdates(valueBytes: bytes): uint64 {
    return btoi(valueBytes.slice(Uint64(1), Uint64(2)));
  }

  private verifyVerifierTxn(
    verifierTxn: gtxn.PaymentTxn,
    signals: PublicSignals,
    _proof: Groth16Bn254Proof,
    puzzleCode: bytes,
    score: uint64,
    identity: bytes,
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
    assert(identity.length === USER_KEY_LENGTH, "identity length is invalid");

    const expectedScore = BigUint(score);
    const scoreAtOutput =
      signals.at(SCORE_SIGNAL_INDEX)!.asBigUint() === expectedScore;

    const puzzleLimb0 = btoi(puzzleCode.slice(Uint64(0), Uint64(8)));
    const puzzleLimb1 = btoi(puzzleCode.slice(Uint64(8), Uint64(16)));
    const puzzleLimb2 = btoi(puzzleCode.slice(Uint64(16), Uint64(20)));

    const identityLimb0 = btoi(identity.slice(Uint64(0), Uint64(8)));
    const identityLimb1 = btoi(identity.slice(Uint64(8), Uint64(16)));
    const identityLimb2 = btoi(identity.slice(Uint64(16), Uint64(24)));
    const identityLimb3 = btoi(identity.slice(Uint64(24), Uint64(32)));

    const puzzleMatches =
      signals.at(PUZZLE_LIMB_0_INDEX)!.asBigUint() === BigUint(puzzleLimb0) &&
      signals.at(PUZZLE_LIMB_1_INDEX)!.asBigUint() === BigUint(puzzleLimb1) &&
      signals.at(PUZZLE_LIMB_2_INDEX)!.asBigUint() === BigUint(puzzleLimb2);

    const identityMatches =
      signals.at(SENDER_LIMB_0_INDEX)!.asBigUint() === BigUint(identityLimb0) &&
      signals.at(SENDER_LIMB_1_INDEX)!.asBigUint() === BigUint(identityLimb1) &&
      signals.at(SENDER_LIMB_2_INDEX)!.asBigUint() === BigUint(identityLimb2) &&
      signals.at(SENDER_LIMB_3_INDEX)!.asBigUint() === BigUint(identityLimb3);

    assert(scoreAtOutput, "public score must match");
    assert(puzzleMatches, "public puzzle code must match");
    assert(identityMatches, "public sender must match caller");
  }
}
