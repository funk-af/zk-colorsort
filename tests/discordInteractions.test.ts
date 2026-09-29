import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import handler from "../netlify/functions/discord-interactions";
import {
  InteractionCallbackType,
  handleInteraction,
  verifyDiscordSignature,
} from "../netlify/functions/lib/interactions";
import {
  DISCORD_PLAY_BUTTON_ID,
  DISCORD_SHARE_COMMAND,
} from "../src/discord/share";

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
  it("answers PING with PONG", () => {
    expect(handleInteraction({ type: 1 })).toEqual({
      type: InteractionCallbackType.PONG,
    });
  });

  it("launches the Activity for the slash command and the play button", () => {
    expect(
      handleInteraction({ type: 2, data: { name: DISCORD_SHARE_COMMAND } }),
    ).toEqual({ type: InteractionCallbackType.LAUNCH_ACTIVITY });
    expect(
      handleInteraction({
        type: 3,
        data: { custom_id: DISCORD_PLAY_BUTTON_ID, component_type: 2 },
      }),
    ).toEqual({ type: InteractionCallbackType.LAUNCH_ACTIVITY });
  });

  it("replies privately to anything else", () => {
    const unknownCommand = handleInteraction({ type: 2, data: { name: "nope" } });
    expect(unknownCommand.type).toBe(
      InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
    );
    if (unknownCommand.type === InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE) {
      expect(unknownCommand.data.flags & 64).toBe(64);
    }
    expect(handleInteraction({ type: 5 }).type).toBe(
      InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
    );
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

  it("rejects non-POST requests", async () => {
    const response = await handler(
      new Request("https://example.test/api/discord-interactions"),
    );
    expect(response.status).toBe(405);
  });
});
