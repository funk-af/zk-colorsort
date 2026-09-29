/**
 * Shared constants and the message text for posting a score to Discord.
 * Vite-free so the Netlify interactions function can import it too.
 */

/** Slash command name registered by `scripts/register-discord-commands.ts`. */
export const DISCORD_SHARE_COMMAND = "colorsort";

/** `custom_id` of the button in shared messages that launches the Activity. */
export const DISCORD_PLAY_BUTTON_ID = "play";

export const DISCORD_PLAY_BUTTON_LABEL = "Play today's puzzle";

export interface ShareScoreInput {
  /** Daily puzzle date key (YYYY-MM-DD), or null for a custom puzzle. */
  dateKey: string | null;
  /** Number of moves in the player's best solve. */
  score: number;
  /** On-chain comparison, when the score has been submitted. */
  comparison?: {
    userScore: number;
    otherPlayersCount: number;
    betterThanPercent: number;
    tiedPlayersCount: number;
  } | null;
}

/**
 * Text posted as the shared interaction's content. Kept short so it reads
 * well in a channel; the launch button is attached separately.
 */
export function formatShareScoreMessage(input: ShareScoreInput): string {
  const title = input.dateKey
    ? `Color Sort ${input.dateKey}`
    : "Color Sort custom puzzle";
  const moves = input.score === 1 ? "1 move" : `${input.score} moves`;
  const lines = [`**${title}** solved in **${moves}** 🧪`];

  const comparison = input.comparison;
  if (comparison && comparison.userScore === input.score) {
    if (comparison.otherPlayersCount === 0) {
      lines.push("First score on the board today.");
    } else {
      const others =
        comparison.otherPlayersCount === 1
          ? "1 other player"
          : `${comparison.otherPlayersCount} other players`;
      const tied =
        comparison.tiedPlayersCount > 0
          ? `, tied with ${comparison.tiedPlayersCount}`
          : "";
      lines.push(
        `Better than ${comparison.betterThanPercent}% of ${others}${tied}.`,
      );
    }
  }

  return lines.join("\n");
}
