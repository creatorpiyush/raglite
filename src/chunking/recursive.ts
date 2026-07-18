import { ChunkingError } from "../errors.js";
import { BaseChunker } from "./base.js";

/**
 * Word-based recursive chunker with overlap.
 *
 * Words rather than characters produce chunks that align to natural
 * boundaries. Overlap keeps context across chunk edges.
 */
export class RecursiveChunker extends BaseChunker {
  override split(text: string): string[] {
    if (!text.trim()) return [];
    if (this.overlap >= this.chunkSize) {
      throw new ChunkingError(
        `overlap (${this.overlap}) must be smaller than chunkSize (${this.chunkSize})`,
      );
    }

    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= this.chunkSize) {
      return [words.join(" ")];
    }

    const step = this.chunkSize - this.overlap;
    const chunks: string[] = [];

    for (let start = 0; start < words.length; start += step) {
      const end = start + this.chunkSize;
      const slice = words.slice(start, end);
      if (slice.length === 0) continue;
      chunks.push(slice.join(" "));
      if (end >= words.length) break;
    }

    return chunks;
  }
}
