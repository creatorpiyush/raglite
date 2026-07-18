import { EmbeddingError } from "../errors.js";
import type { EmbeddingProviderConfig, EmbeddingProviderName } from "../types.js";
import type { Embedder } from "./base.js";
import { DEFAULT_EMBEDDING_MODELS } from "./models.js";

type FeatureExtractionPipeline = (
  input: string | string[],
  options?: Record<string, unknown>,
) => Promise<{
  tolist: () => number[] | number[][];
}>;

/**
 * Embedder that runs a small sentence-transformer locally using
 * `@huggingface/transformers`. Optional dependency; installed on demand.
 */
export class LocalEmbedder implements Embedder {
  readonly provider: EmbeddingProviderName = "local";
  readonly model: string;
  dimensions: number | null = null;

  private pipe: FeatureExtractionPipeline | null = null;

  private constructor(model: string) {
    this.model = model;
  }

  static async create(config: EmbeddingProviderConfig): Promise<LocalEmbedder> {
    const model = config.model ?? DEFAULT_EMBEDDING_MODELS.local;
    return new LocalEmbedder(model);
  }

  private async ensurePipeline(): Promise<FeatureExtractionPipeline> {
    if (this.pipe) return this.pipe;
    let transformers: typeof import("@huggingface/transformers");
    try {
      transformers = await import("@huggingface/transformers");
    } catch (cause) {
      throw new EmbeddingError(
        "Local embeddings require the '@huggingface/transformers' package. " +
          "Install it with: npm install @huggingface/transformers",
        { cause },
      );
    }
    this.pipe = (await transformers.pipeline(
      "feature-extraction",
      this.model,
    )) as unknown as FeatureExtractionPipeline;
    return this.pipe;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const pipe = await this.ensurePipeline();
    const output = await pipe(texts, { pooling: "mean", normalize: true });
    const raw = output.tolist();
    const vectors = Array.isArray(raw[0]) ? (raw as number[][]) : [raw as number[]];
    if (this.dimensions === null && vectors[0]) {
      this.dimensions = vectors[0].length;
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vec] = await this.embedDocuments([text]);
    if (!vec) throw new EmbeddingError("Empty embedding returned by local model");
    return vec;
  }
}
