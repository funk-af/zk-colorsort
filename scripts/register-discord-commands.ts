/**
 * Registers the `/colorsort`, `/score`, and `/graph` slash commands for
 * the Discord application, and points the Activity's "Launch" Entry Point
 * command at the app's interactions endpoint so it can post a short
 * "playing" message instead of Discord's Activity embed.
 *
 *   pnpm run discord:register-commands
 *
 * Reads DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN from the environment,
 * `.env.local`, or `.env` (in that order of precedence). Uses POST, which
 * upserts by name, rather than the bulk PUT that would also wipe the Entry
 * Point command Discord created for the Activity. Global commands can take up
 * to an hour to appear in clients.
 */
import {
  DISCORD_GRAPH_COMMAND,
  DISCORD_SCORE_COMMAND,
  DISCORD_SCORE_USER_OPTION,
  DISCORD_SHARE_COMMAND,
} from "../src/discord/share";

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
const PRIMARY_ENTRY_POINT = 4;
/** Entry Point handler: the app answers the interaction itself. */
const APP_HANDLER = 1;
const OPTION_TYPE_USER = 6;

// integration_types / contexts are omitted so the commands inherit the
// installation contexts enabled for the app in the developer portal.
const commands = [
  {
    name: DISCORD_SHARE_COMMAND,
    description: "Play today's Color Sort puzzle",
    type: CHAT_INPUT,
  },
  {
    name: DISCORD_SCORE_COMMAND,
    description: "Post a player's score for today's Color Sort puzzle",
    type: CHAT_INPUT,
    options: [
      {
        type: OPTION_TYPE_USER,
        name: DISCORD_SCORE_USER_OPTION,
        description: "Whose score to post (defaults to you)",
        required: false,
      },
    ],
  },
  {
    name: DISCORD_GRAPH_COMMAND,
    description: "Post a graph of today's Color Sort scores",
    type: CHAT_INPUT,
  },
];

async function registerCommand(
  applicationId: string,
  botToken: string,
  command: (typeof commands)[number],
) {
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
    throw new Error(`Discord returned ${response.status} for /${command.name}: ${body}`);
  }
  const created = JSON.parse(body) as { id: string; name: string };
  console.log(`Registered /${created.name} (command id ${created.id})`);
}

/**
 * Switches the existing Entry Point command to APP_HANDLER. Discord creates
 * that command when Activities are enabled; it is patched, not recreated.
 */
async function useAppHandlerForEntryPoint(applicationId: string, botToken: string) {
  const base = `https://discord.com/api/v10/applications/${applicationId}/commands`;
  const headers = {
    authorization: `Bot ${botToken}`,
    "content-type": "application/json",
  };
  const listResponse = await fetch(base, { headers });
  const listBody = await listResponse.text();
  if (!listResponse.ok) {
    throw new Error(`Discord returned ${listResponse.status} listing commands: ${listBody}`);
  }
  const entryPoint = (
    JSON.parse(listBody) as { id: string; name: string; type: number; handler?: number }[]
  ).find((command) => command.type === PRIMARY_ENTRY_POINT);
  if (!entryPoint) {
    console.warn("No Entry Point command found; enable Activities for the app first.");
    return;
  }
  if (entryPoint.handler === APP_HANDLER) {
    console.log(`Entry Point /${entryPoint.name} already uses the app handler`);
    return;
  }
  const patchResponse = await fetch(`${base}/${entryPoint.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ handler: APP_HANDLER }),
  });
  const patchBody = await patchResponse.text();
  if (!patchResponse.ok) {
    throw new Error(
      `Discord returned ${patchResponse.status} for Entry Point /${entryPoint.name}: ${patchBody}`,
    );
  }
  console.log(`Entry Point /${entryPoint.name} now uses the app handler`);
}

async function main() {
  const applicationId = requireEnv("DISCORD_CLIENT_ID");
  const botToken = requireEnv("DISCORD_BOT_TOKEN");
  for (const command of commands) {
    await registerCommand(applicationId, botToken, command);
  }
  await useAppHandlerForEntryPoint(applicationId, botToken);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
