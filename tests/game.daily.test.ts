import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIndexerClient } from "../src/indexer";
import {
  dateKeyFromDate,
  generateDailyPuzzleFromIndexer,
  getDailySeedFromIndexer,
  parseDateKey,
  shiftDateKey,
} from "../src/game/daily";
import { encodePuzzle } from "../src/game/serialize";

vi.mock("../src/indexer", () => ({
  getIndexerClient: vi.fn(),
}));

const getIndexerClientMock = vi.mocked(getIndexerClient);

describe("daily puzzle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("formats a date key as YYYY-MM-DD", () => {
    const key = dateKeyFromDate(new Date(Date.UTC(2026, 4, 27)));
    expect(key).toBe("2026-05-27");
  });

  it("uses UTC day boundaries for date keys", () => {
    const key = dateKeyFromDate(new Date("2026-05-27T23:30:00-07:00"));
    expect(key).toBe("2026-05-28");
  });

  it("parses valid date keys and rejects invalid values", () => {
    expect(parseDateKey("2026-05-27")).not.toBeNull();
    expect(parseDateKey("2026-02-31")).toBeNull();
    expect(parseDateKey("05-27-2026")).toBeNull();
  });

  it("shifts date keys by day offsets", () => {
    expect(shiftDateKey("2026-05-27", -1)).toBe("2026-05-26");
    expect(shiftDateKey("2026-05-27", 1)).toBe("2026-05-28");
  });

  it("derives the daily seed from the first block header seed", async () => {
    getIndexerClientMock.mockReturnValue({
      searchForBlockHeaders: () => ({
        afterTime: () => ({
          limit: () => ({
            do: async () => ({
              blocks: [{ seed: new TextEncoder().encode("abc123") }],
            }),
          }),
        }),
      }),
    } as never);

    await expect(getDailySeedFromIndexer("2026-05-27")).resolves.toBeTypeOf(
      "number",
    );
  });

  it("generates the same puzzle for the same block header seed", async () => {
    getIndexerClientMock.mockReturnValue({
      searchForBlockHeaders: () => ({
        afterTime: () => ({
          limit: () => ({
            do: async () => ({
              blocks: [{ seed: new TextEncoder().encode("abc123") }],
            }),
          }),
        }),
      }),
    } as never);

    const a = (await generateDailyPuzzleFromIndexer("2026-05-28")).puzzle;
    const b = (await generateDailyPuzzleFromIndexer("2026-05-28")).puzzle;
    expect(encodePuzzle(a)).toBe(encodePuzzle(b));
  });

  it("reuses a previously fetched seed for the same date", async () => {
    const doMock = vi.fn(async () => ({
      blocks: [{ seed: new TextEncoder().encode("abc123") }],
    }));

    getIndexerClientMock.mockReturnValue({
      searchForBlockHeaders: () => ({
        afterTime: () => ({
          limit: () => ({
            do: doMock,
          }),
        }),
      }),
    } as never);

    const first = await getDailySeedFromIndexer("2026-05-29");
    const second = await getDailySeedFromIndexer("2026-05-29");

    expect(second).toBe(first);
    expect(doMock).toHaveBeenCalledTimes(1);
  });

  it("fails when the indexer returns no first block header", async () => {
    getIndexerClientMock.mockReturnValue({
      searchForBlockHeaders: () => ({
        afterTime: () => ({
          limit: () => ({
            do: async () => ({
              blocks: [],
            }),
          }),
        }),
      }),
    } as never);

    await expect(getDailySeedFromIndexer("2026-05-30")).rejects.toThrow(
      "No block header found",
    );
  });
});
