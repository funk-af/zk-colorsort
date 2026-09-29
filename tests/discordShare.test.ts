import { describe, expect, it } from "vitest";
import { formatShareScoreMessage } from "../src/discord/share";

describe("formatShareScoreMessage", () => {
  it("names the daily puzzle and the move count", () => {
    expect(formatShareScoreMessage({ dateKey: "2026-09-29", score: 27 })).toBe(
      "**Color Sort 2026-09-29** solved in **27 moves** 🧪",
    );
    expect(formatShareScoreMessage({ dateKey: null, score: 1 })).toBe(
      "**Color Sort custom puzzle** solved in **1 move** 🧪",
    );
  });

  it("adds the comparison line only when it matches the shared score", () => {
    const comparison = {
      userScore: 27,
      otherPlayersCount: 4,
      betterThanPercent: 75,
      tiedPlayersCount: 1,
    };
    expect(
      formatShareScoreMessage({ dateKey: "2026-09-29", score: 27, comparison }),
    ).toBe(
      "**Color Sort 2026-09-29** solved in **27 moves** 🧪\n" +
        "Better than 75% of 4 other players, tied with 1.",
    );
    // A newer local solve that has not been submitted yet: stale comparison.
    expect(
      formatShareScoreMessage({ dateKey: "2026-09-29", score: 25, comparison }),
    ).not.toContain("Better than");
    expect(
      formatShareScoreMessage({
        dateKey: "2026-09-29",
        score: 27,
        comparison: { ...comparison, otherPlayersCount: 0 },
      }),
    ).toContain("First score on the board today.");
  });
});
