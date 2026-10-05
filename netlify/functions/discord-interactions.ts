import type { Context } from "@netlify/functions";
import { postInteractionFollowUp } from "./lib/discord";
import { requireEnv } from "./lib/env";
import { json } from "./lib/http";
import {
  handleInteraction,
  verifyDiscordSignature,
  type DiscordInteraction,
  type InteractionDeps,
} from "./lib/interactions";

/**
 * Discord Interactions Endpoint. Set the app's "Interactions Endpoint URL"
 * to `https://<site>/api/discord-interactions`; Discord validates it with a
 * signed PING on save.
 *
 * Handles the `/colorsort` slash command and the "Play" button on posted
 * messages by answering with LAUNCH_ACTIVITY, which opens the Activity for
 * the user who clicked. The App Launcher's "Launch" Entry Point command does
 * the same and then posts a one-line "playing" follow-up, kept alive past the
 * response with `context.waitUntil`. `/score` and `/graph` read today's scores from
 * the chain and post them to the channel; that read is bounded by a time
 * budget so the answer always lands inside Discord's 3-second deadline. The
 * chain module is imported lazily so the launch paths stay fast on a cold
 * start.
 *
 * Only signed requests are accepted; the free plan's two code-based rate
 * limit rules are already used by the token and submit functions.
 */
function depsFor(context?: Context): InteractionDeps {
  return {
    loadDailyScoreboard: async () =>
      (await import("./lib/scoreboard")).loadDailyScoreboard(),
    sendFollowUp: (message) => {
      const task = postInteractionFollowUp(message);
      context?.waitUntil?.(task);
    },
  };
}

export default async (request: Request, context?: Context) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const rawBody = await request.text();
  const valid = verifyDiscordSignature({
    publicKeyHex: requireEnv("DISCORD_PUBLIC_KEY"),
    signatureHex: request.headers.get("x-signature-ed25519"),
    timestamp: request.headers.get("x-signature-timestamp"),
    rawBody,
  });
  if (!valid) {
    // Discord's endpoint check expects 401 for a bad signature.
    return json({ error: "Invalid request signature" }, 401);
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return json({ error: "Request body must be JSON" }, 400);
  }
  if (!interaction || typeof interaction.type !== "number") {
    return json({ error: "Malformed interaction" }, 400);
  }

  return json(await handleInteraction(interaction, depsFor(context)));
};
