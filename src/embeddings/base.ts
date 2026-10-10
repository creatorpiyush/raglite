import type { EmbeddingProviderName } from "../types.js";

export interface Embedder {
  readonly provider: EmbeddingProviderName;
  readonly model: string;
  readonly dimensions: number | null;
  /** `signal` is optional to honour; build() also checks it between batches. */
  embedDocuments(texts: string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
