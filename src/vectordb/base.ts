import type { ChunkMetadata, IndexMetadata, StoredChunk } from "../types.js";

/** A stored chunk without its embedding. */
export type IndexedChunk = Pick<StoredChunk, "id" | "text" | "metadata">;

export interface VectorSearchHit {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  score: number;
  distance: number;
}

export interface VectorStore {
  readonly namespace: string;
  load(): Promise<void>;
  reset(): Promise<void>;
  add(chunks: StoredChunk[]): Promise<void>;
  search(embedding: number[], topK: number): Promise<VectorSearchHit[]>;
  count(): number;
  saveIndexMetadata(metadata: IndexMetadata): Promise<void>;
  readIndexMetadata(): Promise<IndexMetadata | null>;
  /**
   * Optional. Every stored chunk, without embeddings. Lets keyword and hybrid
   * search rebuild a missing keyword index from the store instead of asking
   * for a full rebuild.
   */
  listChunks?(): Promise<IndexedChunk[]>;
  /**
   * Optional. Native keyword search (for example a full-text index), used in
   * place of the built-in BM25 index. Higher `score` means a better match.
   */
  keywordSearch?(query: string, topK: number): Promise<VectorSearchHit[]>;
}
