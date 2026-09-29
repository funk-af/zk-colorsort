import type { Config } from "@netlify/functions";
import { exchangeDiscordCode } from "./lib/discord";
import { requireEnv } from "./lib/env";
import { HttpError, errorResponse, json, readJsonBody } from "./lib/http";

/**
 * Exchanges the OAuth2 code from the Discord Embedded App SDK's `authorize()`
 * for an access token, which the Activity then passes to `authenticate()` and
 * to the sponsored submit endpoint. Stateless; the client secret never leaves
 * this function.
 */
export default async (request: Request) => {
  try {
    if (request.method !== "POST") {
      throw new HttpError(405, "Method not allowed");
    }
    const body = await readJsonBody<{ code?: unknown }>(request, 4_000);
    if (typeof body.code !== "string" || !/^[A-Za-z0-9._-]{10,200}$/.test(body.code)) {
      throw new HttpError(400, "Missing OAuth code");
    }

    const token = await exchangeDiscordCode({
      code: body.code,
      clientId: requireEnv("DISCORD_CLIENT_ID"),
      clientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
    });

    return json({ access_token: token.access_token, expires_in: token.expires_in });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config: Config = {
  // Routed from /api/discord-token by a forced redirect in netlify.toml.
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip"],
  },
};
