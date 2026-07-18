import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

/**
 * SHA-256 hash of an arbitrary string.
 */
export function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Streaming SHA-256 of a file's contents. Streaming avoids loading
 * large PDFs into memory just to fingerprint them.
 */
export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

/**
 * A short, filesystem-safe namespace derived from a document's
 * absolute path. Used to scope each `Document` to its own on-disk
 * collection so two documents never overwrite each other.
 */
export function namespaceFromPath(absolutePath: string): string {
  return hashString(absolutePath).slice(0, 16);
}
