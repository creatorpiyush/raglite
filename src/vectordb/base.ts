import type { ChunkMetadata, IndexMetadata, StoredChunk } from "../types.js";

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
}
