import type { EmbeddingProviderName } from "../types.js";

export interface Embedder {
  readonly provider: EmbeddingProviderName;
  readonly model: string;
  readonly dimensions: number | null;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
