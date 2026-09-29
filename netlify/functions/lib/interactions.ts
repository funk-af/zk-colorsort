import { createPublicKey, verify } from "node:crypto";
import {
  DISCORD_PLAY_BUTTON_ID,
  DISCORD_SHARE_COMMAND,
} from "../../../src/discord/share";

/** Discord interaction types we handle. */
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

/** Interaction callback types. */
export const InteractionCallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  /** Launches the app's Activity for the invoking user. */
  LAUNCH_ACTIVITY: 12,
} as const;

const EPHEMERAL_FLAG = 1 << 6;

export interface DiscordInteraction {
  type: number;
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
  };
}

export type InteractionResponse =
  | { type: typeof InteractionCallbackType.PONG }
  | { type: typeof InteractionCallbackType.LAUNCH_ACTIVITY }
  | {
      type: typeof InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE;
      data: { content: string; flags: number };
    };

// DER prefix for an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verifies Discord's request signature: Ed25519 over `timestamp + rawBody`
 * with the application's public key from the developer portal.
 */
export function verifyDiscordSignature(params: {
  publicKeyHex: string;
  signatureHex: string | null;
  timestamp: string | null;
  rawBody: string;
}): boolean {
  const { publicKeyHex, signatureHex, timestamp, rawBody } = params;
  if (
    !signatureHex ||
    !timestamp ||
    !/^[0-9a-fA-F]{128}$/.test(signatureHex) ||
    !/^[0-9a-fA-F]{64}$/.test(publicKeyHex)
  ) {
    return false;
  }
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(timestamp + rawBody, "utf8"),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

function ephemeral(content: string): InteractionResponse {
  return {
    type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL_FLAG },
  };
}

/**
 * Pure interaction router. The slash command and the "play" button on shared
 * score messages both launch the Activity; anything else gets a private
 * explanation instead of an error, so Discord never shows "interaction failed".
 */
export function handleInteraction(interaction: DiscordInteraction): InteractionResponse {
  switch (interaction.type) {
    case InteractionType.PING:
      return { type: InteractionCallbackType.PONG };
    case InteractionType.APPLICATION_COMMAND:
      if (interaction.data?.name === DISCORD_SHARE_COMMAND) {
        return { type: InteractionCallbackType.LAUNCH_ACTIVITY };
      }
      return ephemeral(`Unknown command. Try /${DISCORD_SHARE_COMMAND}.`);
    case InteractionType.MESSAGE_COMPONENT:
      if (interaction.data?.custom_id === DISCORD_PLAY_BUTTON_ID) {
        return { type: InteractionCallbackType.LAUNCH_ACTIVITY };
      }
      return ephemeral("This button is no longer available.");
    default:
      return ephemeral("Unsupported interaction.");
  }
}
