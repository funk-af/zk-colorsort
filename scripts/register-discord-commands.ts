/**
 * Registers the `/colorsort` slash command for the Discord application.
 *
 *   pnpm run discord:register-commands
 *
 * Reads DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN from the environment,
 * `.env.local`, or `.env` (in that order of precedence). Uses POST, which
 * upserts by name, rather than the bulk PUT that would also wipe the Entry
 * Point command Discord created for the Activity. Global commands can take up
 * to an hour to appear in clients.
 */
import { DISCORD_SHARE_COMMAND } from "../src/discord/share";

// loadEnvFile never overrides variables that are already set, so loading
// .env.local first gives it precedence over .env, matching Vite.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile?.(file);
  } catch {
    // File absent; keep going.
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const CHAT_INPUT = 1;

async function main() {
  const applicationId = requireEnv("DISCORD_CLIENT_ID");
  const botToken = requireEnv("DISCORD_BOT_TOKEN");

  // integration_types / contexts are omitted so the command inherits the
  // installation contexts enabled for the app in the developer portal.
  const command = {
    name: DISCORD_SHARE_COMMAND,
    description: "Play today's Color Sort puzzle",
    type: CHAT_INPUT,
  };

  const response = await fetch(
    `https://discord.com/api/v10/applications/${applicationId}/commands`,
    {
      method: "POST",
      headers: {
        authorization: `Bot ${botToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    },
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Discord returned ${response.status}: ${body}`);
  }
  const created = JSON.parse(body) as { id: string; name: string };
  console.log(`Registered /${created.name} (command id ${created.id})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
