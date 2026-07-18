import type { EmbeddingProviderConfig } from "../types.js";
import type { Embedder } from "./base.js";
import { LocalEmbedder } from "./local.js";
import { RemoteEmbedder } from "./remote.js";

export async function createEmbedder(config: EmbeddingProviderConfig): Promise<Embedder> {
  if (config.provider === "local") {
    return LocalEmbedder.create(config);
  }
  return RemoteEmbedder.create(config);
}
