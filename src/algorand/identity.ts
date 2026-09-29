/**
 * Identity derivation for sponsored (Discord) scores. Dependency-free so the
 * Discord interactions function can import it without pulling in algosdk.
 */

export const USER_KEY_BYTE_LENGTH = 32;

export function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

/**
 * Identity bytes for a Discord user: sha256("discord:" + userId).
 * Uses WebCrypto so it works in browsers and Node alike.
 */
export async function discordUserKey(userId: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`discord:${userId}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

/** Identity label used for sponsored entries in score listings. */
export function sponsoredIdentityLabel(userKey: Uint8Array): string {
  return `sponsored:${bytesToHex(userKey)}`;
}
