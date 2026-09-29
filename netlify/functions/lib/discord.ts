import { HttpError } from "./http";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_EPOCH_MS = 1_420_070_400_000;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

/** Creation time encoded in a Discord snowflake id. */
export function discordAccountCreatedAt(id: string): Date {
  const timestamp = (BigInt(id) >> 22n) + BigInt(DISCORD_EPOCH_MS);
  return new Date(Number(timestamp));
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  if (!/^[A-Za-z0-9._-]{10,200}$/.test(accessToken)) {
    throw new HttpError(401, "Invalid Discord access token", "discord_auth");
  }
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(401, "Discord rejected the access token", "discord_auth");
  }
  if (!response.ok) {
    throw new HttpError(502, `Discord API error ${response.status}`, "discord_api");
  }
  const user = (await response.json()) as DiscordUser;
  if (!user?.id || !/^\d{15,22}$/.test(user.id)) {
    throw new HttpError(502, "Discord returned an invalid user", "discord_api");
  }
  return user;
}

export async function exchangeDiscordCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ access_token: string; expires_in: number; scope: string }> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "authorization_code",
    code: params.code,
  });
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new HttpError(401, "Discord code exchange failed", "discord_auth");
  }
  return (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope: string;
  };
}
