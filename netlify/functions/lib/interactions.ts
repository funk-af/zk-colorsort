import { createPublicKey, verify } from "node:crypto";
import { discordUserKey, sponsoredIdentityLabel } from "../../../src/algorand/identity";
import {
  DISCORD_GRAPH_COMMAND,
  DISCORD_PLAY_BUTTON_ID,
  DISCORD_SCORE_COMMAND,
  DISCORD_SCORE_USER_OPTION,
  DISCORD_SHARE_COMMAND,
  type DiscordActionRow,
  compareScores,
  formatScoreHistogramMessage,
  formatUserScoreMessage,
  playButtonRow,
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

/** Application command option type for a user picker. */
const OPTION_TYPE_USER = 6;

const EPHEMERAL_FLAG = 1 << 6;

export interface DiscordInteractionUser {
  id?: string;
}

export interface DiscordInteraction {
  type: number;
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    options?: { name?: string; type?: number; value?: unknown }[];
  };
  /** Set when invoked in a guild. */
  member?: { user?: DiscordInteractionUser };
  /** Set when invoked in a DM. */
  user?: DiscordInteractionUser;
}

export interface MessageResponseData {
  content: string;
  flags: number;
  components?: DiscordActionRow[];
  /** Rendered mentions never ping anyone. */
  allowed_mentions?: { parse: never[] };
}

export type InteractionResponse =
  | { type: typeof InteractionCallbackType.PONG }
  | { type: typeof InteractionCallbackType.LAUNCH_ACTIVITY }
  | {
      type: typeof InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE;
      data: MessageResponseData;
    };

export interface DailyScore {
  /** Wallet address, or `sponsored:<hex user key>` for Discord players. */
  identity: string;
  score: number;
}

export interface DailyScoreboard {
  /** UTC date key of today's daily puzzle. */
  dateKey: string;
  /** Every recorded score for it, wallet and sponsored. */
  scores: DailyScore[];
}

/** Thrown by the scoreboard loader when the chain read exceeds its budget. */
export class ScoreboardTimeoutError extends Error {
  constructor() {
    super("Timed out reading today's scores");
    this.name = "ScoreboardTimeoutError";
  }
}

/** Chain access, injected so the router stays testable without a network. */
export interface InteractionDeps {
  loadDailyScoreboard(): Promise<DailyScoreboard>;
}

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

/** A message everyone in the channel sees, with the play button attached. */
function channelMessage(content: string): InteractionResponse {
  return {
    type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: 0,
      components: [playButtonRow()],
      allowed_mentions: { parse: [] },
    },
  };
}

const SNOWFLAKE = /^\d{15,22}$/;

function invokingUserId(interaction: DiscordInteraction): string | null {
  const id = interaction.member?.user?.id ?? interaction.user?.id;
  return typeof id === "string" && SNOWFLAKE.test(id) ? id : null;
}

/** The `user` option of the score command, if one was picked. */
function selectedUserId(interaction: DiscordInteraction): string | null {
  const option = interaction.data?.options?.find(
    (item) => item.name === DISCORD_SCORE_USER_OPTION && item.type === OPTION_TYPE_USER,
  );
  const value = option?.value;
  return typeof value === "string" && SNOWFLAKE.test(value) ? value : null;
}

async function loadScoreboard(
  deps: InteractionDeps,
): Promise<DailyScoreboard | InteractionResponse> {
  try {
    return await deps.loadDailyScoreboard();
  } catch (error) {
    console.error("Failed to load today's scoreboard", error);
    return ephemeral(
      error instanceof ScoreboardTimeoutError
        ? "Today's scores are taking too long to load. Try again in a moment."
        : "Could not read today's scores right now. Try again later.",
    );
  }
}

async function handleScoreCommand(
  interaction: DiscordInteraction,
  deps: InteractionDeps,
): Promise<InteractionResponse> {
  const invoker = invokingUserId(interaction);
  const targetId = selectedUserId(interaction) ?? invoker;
  if (!targetId) {
    return ephemeral("Could not tell which Discord user to look up.");
  }
  const isSelf = targetId === invoker;

  const board = await loadScoreboard(deps);
  if ("type" in board) {
    return board;
  }

  const identity = sponsoredIdentityLabel(await discordUserKey(targetId));
  const entry = board.scores.find((score) => score.identity === identity);
  if (!entry) {
    return ephemeral(
      isSelf
        ? `You have no score on today's puzzle yet. Play it with /${DISCORD_SHARE_COMMAND} and submit your solve.`
        : `<@${targetId}> has no score on today's puzzle yet.`,
    );
  }

  return channelMessage(
    formatUserScoreMessage({
      userId: targetId,
      dateKey: board.dateKey,
      score: entry.score,
      comparison: compareScores(
        board.scores.map((score) => score.score),
        entry.score,
      ),
    }),
  );
}

async function handleGraphCommand(
  deps: InteractionDeps,
): Promise<InteractionResponse> {
  const board = await loadScoreboard(deps);
  if ("type" in board) {
    return board;
  }
  if (board.scores.length === 0) {
    return ephemeral(
      `No scores on the board for today's puzzle yet. Be the first with /${DISCORD_SHARE_COMMAND}.`,
    );
  }
  return channelMessage(
    formatScoreHistogramMessage({
      dateKey: board.dateKey,
      allScores: board.scores.map((score) => score.score),
    }),
  );
}

/**
 * Interaction router. `/colorsort` and the "play" button on posted messages
 * launch the Activity; `/score` and `/graph` post today's on-chain
 * results to the channel. Anything else gets a private explanation instead
 * of an error, so Discord never shows "interaction failed".
 */
export async function handleInteraction(
  interaction: DiscordInteraction,
  deps: InteractionDeps,
): Promise<InteractionResponse> {
  switch (interaction.type) {
    case InteractionType.PING:
      return { type: InteractionCallbackType.PONG };
    case InteractionType.APPLICATION_COMMAND:
      switch (interaction.data?.name) {
        case DISCORD_SHARE_COMMAND:
          return { type: InteractionCallbackType.LAUNCH_ACTIVITY };
        case DISCORD_SCORE_COMMAND:
          return handleScoreCommand(interaction, deps);
        case DISCORD_GRAPH_COMMAND:
          return handleGraphCommand(deps);
        default:
          return ephemeral(
            `Unknown command. Try /${DISCORD_SHARE_COMMAND}, /${DISCORD_SCORE_COMMAND}, or /${DISCORD_GRAPH_COMMAND}.`,
          );
      }
    case InteractionType.MESSAGE_COMPONENT:
      if (interaction.data?.custom_id === DISCORD_PLAY_BUTTON_ID) {
        return { type: InteractionCallbackType.LAUNCH_ACTIVITY };
      }
      return ephemeral("This button is no longer available.");
    default:
      return ephemeral("Unsupported interaction.");
  }
}
