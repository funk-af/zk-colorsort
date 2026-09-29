/**
 * Shared constants and message text for the Discord integration: the score
 * shared from the Activity and the replies to the slash commands.
 * Vite-free so the Netlify interactions function can import it too.
 */

/** Slash command that launches the Activity; also the command a shared score renders as. */
export const DISCORD_SHARE_COMMAND = "colorsort";

/** Slash command that posts a player's score for today's daily puzzle. */
export const DISCORD_SCORE_COMMAND = "score";

/** Name of the optional user option on the score command. */
export const DISCORD_SCORE_USER_OPTION = "user";

/** Slash command that posts the graph of today's recorded scores. */
export const DISCORD_GRAPH_COMMAND = "graph";

/** `custom_id` of the button in shared messages that launches the Activity. */
export const DISCORD_PLAY_BUTTON_ID = "play";

export const DISCORD_PLAY_BUTTON_LABEL = "Play today's puzzle";

const COMPONENT_ACTION_ROW = 1;
const COMPONENT_BUTTON = 2;
const BUTTON_STYLE_PRIMARY = 1;

export interface DiscordButtonComponent {
  type: typeof COMPONENT_BUTTON;
  style: number;
  label: string;
  custom_id: string;
}

export interface DiscordActionRow {
  type: typeof COMPONENT_ACTION_ROW;
  components: DiscordButtonComponent[];
}

/** The action row holding the "play" button, attached to every posted message. */
export function playButtonRow(): DiscordActionRow {
  return {
    type: COMPONENT_ACTION_ROW,
    components: [
      {
        type: COMPONENT_BUTTON,
        style: BUTTON_STYLE_PRIMARY,
        label: DISCORD_PLAY_BUTTON_LABEL,
        custom_id: DISCORD_PLAY_BUTTON_ID,
      },
    ],
  };
}

export interface ScoreComparison {
  userScore: number;
  otherPlayersCount: number;
  betterThanPercent: number;
  tiedPlayersCount: number;
}

/**
 * Ranks one score against every recorded score (which includes it), with the
 * same rounding as the in-app comparison.
 */
export function compareScores(
  allScores: readonly number[],
  userScore: number,
): ScoreComparison {
  const otherPlayersCount = Math.max(allScores.length - 1, 0);
  const playersBeaten = allScores.filter((score) => score > userScore).length;
  const tiedPlayersCount = Math.max(
    allScores.filter((score) => score === userScore).length - 1,
    0,
  );
  return {
    userScore,
    otherPlayersCount,
    tiedPlayersCount,
    betterThanPercent:
      otherPlayersCount > 0
        ? Math.round((playersBeaten / otherPlayersCount) * 100)
        : 0,
  };
}

function puzzleTitle(dateKey: string | null): string {
  return dateKey ? `Color Sort ${dateKey}` : "Color Sort custom puzzle";
}

function movesText(score: number): string {
  return score === 1 ? "1 move" : `${score} moves`;
}

function comparisonLine(comparison: ScoreComparison): string {
  if (comparison.otherPlayersCount === 0) {
    return "First score on the board today.";
  }
  const others =
    comparison.otherPlayersCount === 1
      ? "1 other player"
      : `${comparison.otherPlayersCount} other players`;
  const tied =
    comparison.tiedPlayersCount > 0
      ? `, tied with ${comparison.tiedPlayersCount}`
      : "";
  return `Better than ${comparison.betterThanPercent}% of ${others}${tied}.`;
}

export interface ShareScoreInput {
  /** Daily puzzle date key (YYYY-MM-DD), or null for a custom puzzle. */
  dateKey: string | null;
  /** Number of moves in the player's best solve. */
  score: number;
  /** On-chain comparison, when the score has been submitted. */
  comparison?: ScoreComparison | null;
}

/**
 * Text posted as the shared interaction's content. Kept short so it reads
 * well in a channel; the launch button is attached separately.
 */
export function formatShareScoreMessage(input: ShareScoreInput): string {
  const lines = [
    `**${puzzleTitle(input.dateKey)}** solved in **${movesText(input.score)}** 🧪`,
  ];
  const comparison = input.comparison;
  if (comparison && comparison.userScore === input.score) {
    lines.push(comparisonLine(comparison));
  }
  return lines.join("\n");
}

export interface UserScoreInput {
  /** Discord user id, rendered as a mention. */
  userId: string;
  dateKey: string;
  score: number;
  comparison: ScoreComparison;
}

/** Reply to the score command: the player's recorded score for today. */
export function formatUserScoreMessage(input: UserScoreInput): string {
  return [
    `<@${input.userId}> solved **${puzzleTitle(input.dateKey)}** in **${movesText(input.score)}** 🧪`,
    comparisonLine(input.comparison),
  ].join("\n");
}

export interface HistogramBucket {
  score: number;
  count: number;
}

/** Counts scores per move count, ascending; only observed scores get a row. */
export function histogramBuckets(allScores: readonly number[]): HistogramBucket[] {
  const counts = new Map<number, number>();
  for (const score of allScores) {
    counts.set(score, (counts.get(score) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([score, count]) => ({ score, count }));
}

const HISTOGRAM_BAR_WIDTH = 20;
/** Discord's message content limit, minus room for the title line. */
const HISTOGRAM_MAX_LENGTH = 1_900;

/**
 * Reply to the graph command: one row per recorded move count, with a
 * bar scaled to the most common score. Falls back to a summary if a wild
 * spread of scores would not fit in one Discord message.
 */
export function formatScoreHistogramMessage(input: {
  dateKey: string;
  allScores: readonly number[];
}): string {
  const total = input.allScores.length;
  const scoresText = total === 1 ? "1 score" : `${total} scores`;
  const title = `**${puzzleTitle(input.dateKey)}** · ${scoresText} on the board`;

  const buckets = histogramBuckets(input.allScores);
  if (buckets.length === 0) {
    return title;
  }

  const maxCount = Math.max(...buckets.map((bucket) => bucket.count));
  const labelWidth = String(buckets[buckets.length - 1].score).length;
  const rows = buckets.map((bucket) => {
    const bar = "█".repeat(
      Math.max(1, Math.round((bucket.count / maxCount) * HISTOGRAM_BAR_WIDTH)),
    );
    return `${String(bucket.score).padStart(labelWidth)} │ ${bar} ${bucket.count}`;
  });
  const chart = ["```", ...rows, "```"].join("\n");

  if (chart.length > HISTOGRAM_MAX_LENGTH) {
    const best = buckets[0].score;
    const worst = buckets[buckets.length - 1].score;
    return `${title}\nToo many distinct scores to chart: best ${movesText(best)}, worst ${movesText(worst)}.`;
  }
  return `${title}\n${chart}`;
}
