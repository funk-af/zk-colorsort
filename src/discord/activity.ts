/**
 * Discord Activity integration. The app runs unchanged as a website; when it
 * is loaded inside Discord's Activity iframe (detected by the `frame_id`
 * query parameter the Embedded App SDK relies on), this module:
 *
 *  - routes Algorand node/indexer traffic through Discord's proxy, which the
 *    Activity's Content Security Policy requires;
 *  - performs the OAuth handshake (authorize -> token exchange on our Netlify
 *    function -> authenticate) to learn the Discord user; and
 *  - derives the 32-byte user key that sponsored proofs are bound to.
 *
 * No wallet code runs inside the Activity: the permanent, wallet-signed score
 * path is reached by opening the website in an external browser.
 */
import { DiscordSDK, patchUrlMappings } from "@discord/embedded-app-sdk";
import { discordUserKey } from "../algorand/scoreGroups";

export interface DiscordIdentity {
  userId: string;
  displayName: string;
  accessToken: string;
  /** sha256("discord:" + userId): identity limbs for sponsored proofs. */
  userKey: Uint8Array;
}

// Hosts the app talks to. Discord's proxy needs a matching URL mapping in the
// developer portal for each: prefix -> target host.
export const DISCORD_PROXY_MAPPINGS = [
  { prefix: "/algod", target: "mainnet-api.algonode.cloud" },
  { prefix: "/algod-nodely", target: "mainnet-api.4160.nodely.dev" },
  { prefix: "/idx", target: "mainnet-idx.algonode.cloud" },
  { prefix: "/idx-nodely", target: "mainnet-idx.4160.nodely.dev" },
];

const TOKEN_ENDPOINT = "/api/discord-token";

let sdkInstance: DiscordSDK | null = null;

export function isDiscordActivity(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return new URLSearchParams(window.location.search).has("frame_id");
}

export function getDiscordClientId(): string {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  if (!clientId) {
    throw new Error("VITE_DISCORD_CLIENT_ID is not configured");
  }
  return clientId;
}

/** Must run before any request to the mapped hosts is made. */
export function applyDiscordProxyMappings(): void {
  patchUrlMappings(DISCORD_PROXY_MAPPINGS, {
    patchFetch: true,
    patchWebSocket: true,
    patchXhr: true,
    patchSrcAttributes: false,
  });
}

export async function connectDiscordActivity(): Promise<DiscordIdentity> {
  const clientId = getDiscordClientId();
  const sdk = sdkInstance ?? new DiscordSDK(clientId);
  sdkInstance = sdk;

  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Discord token exchange failed (${tokenResponse.status})`);
  }
  const { access_token: accessToken } = (await tokenResponse.json()) as {
    access_token: string;
  };

  const auth = await sdk.commands.authenticate({ access_token: accessToken });

  return {
    userId: auth.user.id,
    displayName: auth.user.global_name ?? auth.user.username,
    accessToken,
    userKey: await discordUserKey(auth.user.id),
  };
}

/** Opens a URL in the user's external browser (outside the Activity). */
export async function openExternalLink(url: string): Promise<boolean> {
  if (!sdkInstance) {
    window.open(url, "_blank", "noopener");
    return true;
  }
  const result = await sdkInstance.commands.openExternalLink({ url });
  return result.opened !== false;
}
