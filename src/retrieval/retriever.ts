import type { Embedder } from "../embeddings/index.js";
import type { SearchResult } from "../types.js";
import type { VectorStore } from "../vectordb/index.js";

export interface RetrieveOptions {
  topK: number;
  scoreThreshold?: number;
}

export class Retriever {
  constructor(
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
  ) {}

  async retrieve(query: string, options: RetrieveOptions): Promise<SearchResult[]> {
    const embedding = await this.embedder.embedQuery(query);
    const hits = await this.store.search(embedding, options.topK);
    const threshold = options.scoreThreshold ?? 0;
    return hits.filter((h) => h.score >= threshold);
  }
}
