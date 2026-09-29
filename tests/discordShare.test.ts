import { describe, expect, it } from "vitest";
import {
  compareScores,
  formatScoreHistogramMessage,
  formatShareScoreMessage,
  formatUserScoreMessage,
  histogramBuckets,
} from "../src/discord/share";

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

describe("compareScores", () => {
  it("ranks a score against the others, excluding itself", () => {
    expect(compareScores([30, 32, 32, 34, 40], 32)).toEqual({
      userScore: 32,
      otherPlayersCount: 4,
      tiedPlayersCount: 1,
      betterThanPercent: 50,
    });
    expect(compareScores([32], 32)).toEqual({
      userScore: 32,
      otherPlayersCount: 0,
      tiedPlayersCount: 0,
      betterThanPercent: 0,
    });
  });
});

describe("formatUserScoreMessage", () => {
  it("mentions the player and ranks them", () => {
    expect(
      formatUserScoreMessage({
        userId: "123456789012345678",
        dateKey: "2026-09-29",
        score: 32,
        comparison: compareScores([32, 32, 34], 32),
      }),
    ).toBe(
      "<@123456789012345678> solved **Color Sort 2026-09-29** in **32 moves** 🧪\n" +
        "Better than 50% of 2 other players, tied with 1.",
    );
    expect(
      formatUserScoreMessage({
        userId: "123456789012345678",
        dateKey: "2026-09-29",
        score: 1,
        comparison: compareScores([1], 1),
      }),
    ).toBe(
      "<@123456789012345678> solved **Color Sort 2026-09-29** in **1 move** 🧪\n" +
        "First score on the board today.",
    );
  });
});

describe("formatScoreHistogramMessage", () => {
  it("buckets only the scores that were recorded, ascending", () => {
    expect(histogramBuckets([34, 32, 32, 40])).toEqual([
      { score: 32, count: 2 },
      { score: 34, count: 1 },
      { score: 40, count: 1 },
    ]);
  });

  it("draws one row per bucket scaled to the tallest bar", () => {
    const message = formatScoreHistogramMessage({
      dateKey: "2026-09-29",
      allScores: [34, 32, 32, 40, 32, 34, 9],
    });
    expect(message).toBe(
      [
        "**Color Sort 2026-09-29** · 7 scores on the board",
        "```",
        " 9 │ ███████ 1",
        "32 │ ████████████████████ 3",
        "34 │ █████████████ 2",
        "40 │ ███████ 1",
        "```",
      ].join("\n"),
    );
    expect(
      formatScoreHistogramMessage({ dateKey: "2026-09-29", allScores: [12] }),
    ).toContain("1 score on the board");
  });

  it("stays under Discord's message limit for a wild spread", () => {
    const allScores = Array.from({ length: 255 }, (_, index) => index + 1);
    const message = formatScoreHistogramMessage({ dateKey: "2026-09-29", allScores });
    expect(message.length).toBeLessThan(2000);
    expect(message).toContain("best 1 move, worst 255 moves");
  });
});
