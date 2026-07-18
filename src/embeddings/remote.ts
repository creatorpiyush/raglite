import { type EmbeddingModel, embed, embedMany } from "ai";
import { EmbeddingError } from "../errors.js";
import type { EmbeddingProviderConfig, EmbeddingProviderName } from "../types.js";
import type { Embedder } from "./base.js";
import { DEFAULT_EMBEDDING_MODELS } from "./models.js";

/**
 * Embedder backed by any AI-SDK compatible remote provider
 * (OpenAI, Google, Mistral, Cohere, Voyage).
 */
export class RemoteEmbedder implements Embedder {
  readonly provider: EmbeddingProviderName;
  readonly model: string;
  dimensions: number | null = null;

  private readonly embeddingModel: EmbeddingModel;

  private constructor(
    provider: EmbeddingProviderName,
    model: string,
    embeddingModel: EmbeddingModel,
  ) {
    this.provider = provider;
    this.model = model;
    this.embeddingModel = embeddingModel;
  }

  static async create(config: EmbeddingProviderConfig): Promise<RemoteEmbedder> {
    if (config.provider === "local") {
      throw new EmbeddingError("RemoteEmbedder cannot be constructed for the 'local' provider");
    }
    const model = config.model ?? DEFAULT_EMBEDDING_MODELS[config.provider];
    const embeddingModel = await buildEmbeddingModel(config.provider, model, config);
    return new RemoteEmbedder(config.provider, model, embeddingModel);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    try {
      const { embeddings } = await embedMany({
        model: this.embeddingModel,
        values: texts,
      });
      this.rememberDimensions(embeddings[0]);
      return embeddings.map((v) => normalize(v));
    } catch (cause) {
      throw new EmbeddingError(`Failed to embed ${texts.length} document(s) via ${this.provider}`, {
        cause,
      });
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      const { embedding } = await embed({ model: this.embeddingModel, value: text });
      this.rememberDimensions(embedding);
      return normalize(embedding);
    } catch (cause) {
      throw new EmbeddingError(`Failed to embed query via ${this.provider}`, {
        cause,
      });
    }
  }

  private rememberDimensions(vector: number[] | undefined): void {
    if (vector && this.dimensions === null) {
      this.dimensions = vector.length;
    }
  }
}

async function buildEmbeddingModel(
  provider: EmbeddingProviderName,
  model: string,
  config: EmbeddingProviderConfig,
): Promise<EmbeddingModel> {
  const opts: Record<string, string | undefined> = {};
  if (config.apiKey) opts["apiKey"] = config.apiKey;
  if (config.baseURL) opts["baseURL"] = config.baseURL;

  switch (provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const client = createOpenAI(opts);
      return client.embedding(model);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const client = createGoogleGenerativeAI(opts);
      return client.textEmbeddingModel(model);
    }
    case "mistral": {
      const { createMistral } = await import("@ai-sdk/mistral");
      const client = createMistral(opts);
      return client.textEmbeddingModel(model);
    }
    case "cohere": {
      const { createCohere } = await import("@ai-sdk/cohere");
      const client = createCohere(opts);
      return client.textEmbeddingModel(model);
    }
    case "voyage": {
      const { createVoyage } = await import("voyage-ai-provider");
      const client = createVoyage(opts);
      return client.textEmbeddingModel(model);
    }
    case "ollama": {
      const { createOllama } = await import("ollama-ai-provider-v2");
      const client = createOllama(config.baseURL ? { baseURL: config.baseURL } : {});
      return client.textEmbeddingModel(model);
    }
    default:
      throw new EmbeddingError(`Unsupported remote embedding provider: ${provider}`);
  }
}

function normalize(vector: number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector.slice();
  return vector.map((v) => v / norm);
}
