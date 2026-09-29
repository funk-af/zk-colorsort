import { requireEnv } from "./lib/env";
import { json } from "./lib/http";
import {
  handleInteraction,
  verifyDiscordSignature,
  type DiscordInteraction,
} from "./lib/interactions";

/**
 * Discord Interactions Endpoint. Set the app's "Interactions Endpoint URL"
 * to `https://<site>/api/discord-interactions`; Discord validates it with a
 * signed PING on save.
 *
 * Handles the `/colorsort` slash command and the "Play" button on shared
 * score messages by answering with LAUNCH_ACTIVITY, which opens the Activity
 * for the user who clicked. No Algorand or Discord API calls are made here,
 * so the 3-second response deadline is comfortable even on a cold start.
 *
 * Only signed requests are accepted; the free plan's two code-based rate
 * limit rules are already used by the token and submit functions.
 */
export default async (request: Request) => {
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

  return json(handleInteraction(interaction));
};
