import { ConfigError } from "../errors.js";
import type { VectorStoreProviderConfig } from "../types.js";
import type { VectorStore } from "./base.js";
import { LanceDbVectorStore } from "./lancedb.js";
import { MemoryVectorStore } from "./memory.js";
import { PineconeVectorStore } from "./pinecone.js";
import { QdrantVectorStore } from "./qdrant.js";

export function createVectorStore(
  config: VectorStoreProviderConfig,
  namespace: string,
): VectorStore {
  switch (config.provider) {
    case "memory":
      return new MemoryVectorStore(config.storeDir ?? ".raglite", namespace);
    case "qdrant":
      return new QdrantVectorStore(config, namespace);
    case "pinecone":
      return new PineconeVectorStore(config, namespace);
    case "lancedb":
      return new LanceDbVectorStore(config.storeDir ?? ".raglite", namespace);
    default: {
      const _exhaustive: never = config.provider;
      throw new ConfigError(`Unsupported vector store provider: ${String(_exhaustive)}`);
    }
  }
}
