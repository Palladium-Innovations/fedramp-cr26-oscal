import { createHash } from "node:crypto";

const UUID_NAMESPACE_DNS = "6ba7b8109dad11d180b400c04fd430c8";

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/../g).map((byte) => Number.parseInt(byte, 16)));
}

function bytesToUuid(bytes) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}

/**
 * Generate a deterministic UUIDv5-compatible identifier from a stable name.
 *
 * @param {string} name Stable name used as UUID input.
 * @param {string} [namespaceHex=UUID_NAMESPACE_DNS] Namespace UUID encoded as 32 hex characters.
 * @returns {string} Deterministic UUID string.
 */
export function deterministicUuid(name, namespaceHex = UUID_NAMESPACE_DNS) {
  const namespace = hexToBytes(namespaceHex);
  const hash = createHash("sha1")
    .update(namespace)
    .update(name)
    .digest();

  const bytes = Uint8Array.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}
