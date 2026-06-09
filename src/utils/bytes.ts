import algosdk from "algosdk";

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

export function decodeUint64BigEndian(value: Uint8Array): bigint {
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  return view.getBigUint64(0, false);
}

export function encodeUint64BigEndian(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value, false);
  return bytes;
}

export function asBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? algosdk.base64ToBytes(value) : value;
}

export function startsWithBytes(
  value: Uint8Array,
  prefix: Uint8Array,
): boolean {
  if (value.length < prefix.length) {
    return false;
  }

  for (let i = 0; i < prefix.length; i += 1) {
    if (value[i] !== prefix[i]) {
      return false;
    }
  }

  return true;
}
