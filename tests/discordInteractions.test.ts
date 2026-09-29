import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import handler from "../netlify/functions/discord-interactions";
import {
  InteractionCallbackType,
  ScoreboardTimeoutError,
  handleInteraction,
  verifyDiscordSignature,
  type DailyScoreboard,
  type InteractionDeps,
} from "../netlify/functions/lib/interactions";
import { discordUserKey, sponsoredIdentityLabel } from "../src/algorand/identity";
import {
  DISCORD_GRAPH_COMMAND,
  DISCORD_PLAY_BUTTON_ID,
  DISCORD_SCORE_COMMAND,
  DISCORD_SHARE_COMMAND,
} from "../src/discord/share";

const USER_ID = "123456789012345678";
const OTHER_USER_ID = "987654321098765432";
const DATE_KEY = "2026-09-29";

const scoreboardState: { board: DailyScoreboard } = {
  board: { dateKey: DATE_KEY, scores: [] },
};

// The function file lazy-loads the chain reader; the handler tests never
// touch a network.
vi.mock("../netlify/functions/lib/scoreboard", () => ({
  loadDailyScoreboard: async () => scoreboardState.board,
}));

async function boardWith(...entries: { userId?: string; address?: string; score: number }[]) {
  const scores = [];
  for (const entry of entries) {
    scores.push({
      identity: entry.userId
        ? sponsoredIdentityLabel(await discordUserKey(entry.userId))
        : (entry.address ?? "WALLET"),
      score: entry.score,
    });
  }
  return { dateKey: DATE_KEY, scores };
}

function depsFor(board: DailyScoreboard | Error): InteractionDeps {
  return {
    loadDailyScoreboard: async () => {
      if (board instanceof Error) {
        throw board;
      }
      return board;
    },
  };
}

const noDeps = depsFor(new Error("scoreboard should not be loaded"));

function scoreCommand(invokerId: string, pickedUserId?: string) {
  return {
    type: 2,
    data: {
      name: DISCORD_SCORE_COMMAND,
      options: pickedUserId
        ? [{ name: "user", type: 6, value: pickedUserId }]
        : [],
    },
    member: { user: { id: invokerId } },
  };
}

function messageData(response: Awaited<ReturnType<typeof handleInteraction>>) {
  expect(response.type).toBe(InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE);
  if (response.type !== InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE) {
    throw new Error("unreachable");
  }
  return response.data;
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
// Raw 32-byte key is the tail of the DER SubjectPublicKeyInfo.
const publicKeyHex = (publicKey.export({ format: "der", type: "spki" }) as Buffer)
  .subarray(-32)
  .toString("hex");

function signBody(body: string, timestamp = "1700000000") {
  const signature = sign(null, Buffer.from(timestamp + body), privateKey);
  return { signature: signature.toString("hex"), timestamp };
}

function signedRequest(body: unknown, tamper?: (headers: Headers) => void) {
  const raw = JSON.stringify(body);
  const { signature, timestamp } = signBody(raw);
  const headers = new Headers({
    "content-type": "application/json",
    "x-signature-ed25519": signature,
    "x-signature-timestamp": timestamp,
  });
  tamper?.(headers);
  return new Request("https://example.test/api/discord-interactions", {
    method: "POST",
    headers,
    body: raw,
  });
}

describe("verifyDiscordSignature", () => {
  it("accepts a signature over timestamp + body", () => {
    const rawBody = '{"type":1}';
    const { signature, timestamp } = signBody(rawBody);
    expect(
      verifyDiscordSignature({
        publicKeyHex,
        signatureHex: signature,
        timestamp,
        rawBody,
      }),
    ).toBe(true);
  });

  it("rejects a modified body, timestamp, or missing headers", () => {
    const rawBody = '{"type":1}';
    const { signature, timestamp } = signBody(rawBody);
    expect(
      verifyDiscordSignature({
        publicKeyHex,
        signatureHex: signature,
        timestamp,
        rawBody: '{"type":2}',
      }),
    ).toBe(false);
    expect(
      verifyDiscordSignature({
        publicKeyHex,
        signatureHex: signature,
        timestamp: "1700000001",
        rawBody,
      }),
    ).toBe(false);
    expect(
      verifyDiscordSignature({
        publicKeyHex,
        signatureHex: null,
        timestamp,
        rawBody,
      }),
    ).toBe(false);
    expect(
      verifyDiscordSignature({
        publicKeyHex: "00".repeat(32),
        signatureHex: signature,
        timestamp,
        rawBody,
      }),
    ).toBe(false);
  });
});

describe("handleInteraction", () => {
  it("answers PING with PONG", async () => {
    expect(await handleInteraction({ type: 1 }, noDeps)).toEqual({
      type: InteractionCallbackType.PONG,
    });
  });

  it("launches the Activity for the slash command and the play button", async () => {
    expect(
      await handleInteraction({ type: 2, data: { name: DISCORD_SHARE_COMMAND } }, noDeps),
    ).toEqual({ type: InteractionCallbackType.LAUNCH_ACTIVITY });
    expect(
      await handleInteraction(
        {
          type: 3,
          data: { custom_id: DISCORD_PLAY_BUTTON_ID, component_type: 2 },
        },
        noDeps,
      ),
    ).toEqual({ type: InteractionCallbackType.LAUNCH_ACTIVITY });
  });

  it("replies privately to anything else", async () => {
    const unknownCommand = await handleInteraction(
      { type: 2, data: { name: "nope" } },
      noDeps,
    );
    expect(messageData(unknownCommand).flags & 64).toBe(64);
    expect((await handleInteraction({ type: 5 }, noDeps)).type).toBe(
      InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
    );
  });
});

describe("/score", () => {
  it("posts the invoking user's score with a play button and no ping", async () => {
    const board = await boardWith(
      { userId: USER_ID, score: 32 },
      { userId: OTHER_USER_ID, score: 32 },
      { address: "WALLET", score: 34 },
    );
    const data = messageData(
      await handleInteraction(scoreCommand(USER_ID), depsFor(board)),
    );
    expect(data.flags).toBe(0);
    expect(data.content).toBe(
      `<@${USER_ID}> solved **Color Sort ${DATE_KEY}** in **32 moves** 🧪\n` +
        "Better than 50% of 2 other players, tied with 1.",
    );
    expect(data.allowed_mentions).toEqual({ parse: [] });
    expect(data.components?.[0].components[0].custom_id).toBe(DISCORD_PLAY_BUTTON_ID);
  });

  it("posts another user's score when one is picked", async () => {
    const board = await boardWith({ userId: OTHER_USER_ID, score: 12 });
    const data = messageData(
      await handleInteraction(scoreCommand(USER_ID, OTHER_USER_ID), depsFor(board)),
    );
    expect(data.flags).toBe(0);
    expect(data.content).toContain(`<@${OTHER_USER_ID}> solved`);
    expect(data.content).toContain("First score on the board today.");
  });

  it("explains privately when there is no score yet", async () => {
    const board = await boardWith({ userId: OTHER_USER_ID, score: 12 });
    const mine = messageData(
      await handleInteraction(scoreCommand(USER_ID), depsFor(board)),
    );
    expect(mine.flags & 64).toBe(64);
    expect(mine.content).toContain("You have no score on today's puzzle yet");

    const theirs = messageData(
      await handleInteraction(scoreCommand(OTHER_USER_ID, USER_ID), depsFor(board)),
    );
    expect(theirs.flags & 64).toBe(64);
    expect(theirs.content).toContain(`<@${USER_ID}> has no score`);
  });

  it("works from a DM, where the user is top-level", async () => {
    const board = await boardWith({ userId: USER_ID, score: 20 });
    const data = messageData(
      await handleInteraction(
        { type: 2, data: { name: DISCORD_SCORE_COMMAND }, user: { id: USER_ID } },
        depsFor(board),
      ),
    );
    expect(data.content).toContain(`<@${USER_ID}> solved`);
  });

  it("rejects an unidentifiable user without reading the chain", async () => {
    const data = messageData(
      await handleInteraction(
        { type: 2, data: { name: DISCORD_SCORE_COMMAND, options: [{ name: "user", type: 6, value: "x" }] } },
        noDeps,
      ),
    );
    expect(data.flags & 64).toBe(64);
  });

  it("apologises privately when the chain read fails or times out", async () => {
    const failed = messageData(
      await handleInteraction(scoreCommand(USER_ID), depsFor(new Error("boom"))),
    );
    expect(failed.flags & 64).toBe(64);
    expect(failed.content).toContain("Could not read today's scores");

    const slow = messageData(
      await handleInteraction(
        scoreCommand(USER_ID),
        depsFor(new ScoreboardTimeoutError()),
      ),
    );
    expect(slow.flags & 64).toBe(64);
    expect(slow.content).toContain("taking too long");
  });
});

describe("/graph", () => {
  it("posts today's graph with a play button", async () => {
    const board = await boardWith(
      { userId: USER_ID, score: 32 },
      { userId: OTHER_USER_ID, score: 32 },
      { address: "WALLET", score: 34 },
    );
    const data = messageData(
      await handleInteraction(
        { type: 2, data: { name: DISCORD_GRAPH_COMMAND } },
        depsFor(board),
      ),
    );
    expect(data.flags).toBe(0);
    expect(data.content).toContain(`**Color Sort ${DATE_KEY}** · 3 scores on the board`);
    expect(data.content).toContain("32 │ ████████████████████ 2");
    expect(data.content).toContain("34 │ ██████████ 1");
    expect(data.components?.[0].components[0].custom_id).toBe(DISCORD_PLAY_BUTTON_ID);
  });

  it("replies privately when the board is empty", async () => {
    const data = messageData(
      await handleInteraction(
        { type: 2, data: { name: DISCORD_GRAPH_COMMAND } },
        depsFor({ dateKey: DATE_KEY, scores: [] }),
      ),
    );
    expect(data.flags & 64).toBe(64);
    expect(data.content).toContain("No scores on the board");
  });
});

describe("discord-interactions handler", () => {
  it("responds to Discord's signed PING", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
    const response = await handler(signedRequest({ type: 1 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 1 });
  });

  it("returns 401 for a bad signature", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
    const response = await handler(
      signedRequest({ type: 1 }, (headers) =>
        headers.set("x-signature-timestamp", "1"),
      ),
    );
    expect(response.status).toBe(401);
  });

  it("launches the Activity for /colorsort", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
    const response = await handler(
      signedRequest({ type: 2, data: { name: DISCORD_SHARE_COMMAND } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 12 });
  });

  it("posts the graph for /graph through the lazy scoreboard loader", async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
    scoreboardState.board = await boardWith({ userId: USER_ID, score: 18 });
    const response = await handler(
      signedRequest({ type: 2, data: { name: DISCORD_GRAPH_COMMAND } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { type: number; data: { content: string } };
    expect(body.type).toBe(4);
    expect(body.data.content).toContain("18 │ ████████████████████ 1");
  });

  it("rejects non-POST requests", async () => {
    const response = await handler(
      new Request("https://example.test/api/discord-interactions"),
    );
    expect(response.status).toBe(405);
  });
});
