import { generateText, type RerankingModel, rerank } from "ai";
import { ConfigError, missingPackage } from "../errors.js";
import { createLLM } from "../llm/factory.js";
import type { LLMProviderConfig, SearchResult } from "../types.js";
import type { Logger } from "../utils/logger.js";

export type RerankProviderName = "cohere" | "voyage" | "llm";

export interface RerankConfig {
  provider: RerankProviderName;
  /** Defaults: cohere "rerank-v3.5", voyage "rerank-2.5". Ignored by "llm"; set `llm.model`. */
  model?: string;
  apiKey?: string;
  baseURL?: string;
  /** For provider "llm"; defaults to the document's `llm`. */
  llm?: LLMProviderConfig;
  /** Results retrieved and passed to the reranker before the topK cut (default max(30, topK)). */
  candidates?: number;
}

/** Your own reranker: return the hits best first; RAGLite keeps the first topK. */
export type Reranker = (query: string, hits: SearchResult[]) => Promise<SearchResult[]>;

export const DEFAULT_RERANK_MODELS = {
  cohere: "rerank-v3.5",
  voyage: "rerank-2.5",
} as const;

const DEFAULT_RERANK_CANDIDATES = 30;
const PROVIDERS: ReadonlySet<string> = new Set(["cohere", "voyage", "llm"]);

/** How many results to retrieve before reranking. */
export function rerankCandidates(rerank: RerankConfig | Reranker, topK: number): number {
  const candidates =
    typeof rerank === "function"
      ? DEFAULT_RERANK_CANDIDATES
      : (rerank.candidates ?? DEFAULT_RERANK_CANDIDATES);
  if (!Number.isInteger(candidates) || candidates <= 0) {
    throw new ConfigError(`rerank.candidates must be a positive integer, got ${candidates}`);
  }
  return Math.max(candidates, topK);
}

/**
 * Reorders `hits` with the reranker and keeps the first `topK`. Each result's
 * `score` becomes the reranker's score, kept in `scores.rerank` next to the
 * retrieval scores. A reranker that fails at run time logs a warning and the
 * original order is kept; a misconfigured one throws ConfigError.
 */
export async function rerankHits(
  query: string,
  hits: SearchResult[],
  rerank: RerankConfig | Reranker,
  topK: number,
  options: { logger: Logger; llm?: LLMProviderConfig; signal?: AbortSignal },
): Promise<SearchResult[]> {
  if (hits.length === 0) return hits;
  const run = typeof rerank === "function" ? rerank : await builtInReranker(rerank, options);
  let ranked: SearchResult[];
  try {
    ranked = await run(query, hits);
  } catch (err) {
    options.signal?.throwIfAborted();
    if (err instanceof ConfigError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    options.logger.warn(`Reranking failed, keeping the retrieval order: ${message}`);
    return hits.slice(0, topK);
  }
  return ranked.slice(0, topK);
}

async function builtInReranker(
  config: RerankConfig,
  options: { llm?: LLMProviderConfig; signal?: AbortSignal },
): Promise<Reranker> {
  if (!PROVIDERS.has(config.provider)) {
    throw new ConfigError(
      `Unknown rerank provider "${config.provider}". Use "cohere", "voyage" or "llm", or pass a function.`,
    );
  }
  if (config.provider === "llm") {
    const llm = config.llm ?? options.llm;
    if (!llm) {
      throw new ConfigError(
        'rerank provider "llm" needs an LLM: set rerank.llm or the document\'s llm.',
      );
    }
    return (query, hits) => llmRerank(query, hits, llm, options.signal);
  }
  const model = await rerankingModel(config);
  return async (query, hits) => {
    const { ranking } = await rerank({
      model,
      query,
      documents: hits.map((h) => h.text),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    });
    return ranking.map(({ originalIndex, score }) => withRerankScore(hits[originalIndex]!, score));
  };
}

async function rerankingModel(config: RerankConfig): Promise<RerankingModel> {
  const settings: Record<string, string> = {};
  if (config.apiKey) settings["apiKey"] = config.apiKey;
  if (config.baseURL) settings["baseURL"] = config.baseURL;
  if (config.provider === "cohere") {
    const { createCohere } = await import("@ai-sdk/cohere").catch(
      missingPackage("@ai-sdk/cohere", "Cohere reranking"),
    );
    return createCohere(settings).reranking(config.model ?? DEFAULT_RERANK_MODELS.cohere);
  }
  const { createVoyage } = await import("voyage-ai-provider").catch(
    missingPackage("voyage-ai-provider", "Voyage reranking"),
  );
  return createVoyage(settings).reranking(config.model ?? DEFAULT_RERANK_MODELS.voyage);
}

function withRerankScore(hit: SearchResult, score: number): SearchResult {
  const retrieval = hit.scores ?? { vector: hit.score };
  return { ...hit, score, distance: 1 - score, scores: { ...retrieval, rerank: score } };
}

/**
 * Asks the LLM to order the passages. Its score is rank-based: 1 for the
 * first passage down to 1/n for the last; passages it leaves out follow in
 * their retrieval order.
 */
async function llmRerank(
  query: string,
  hits: SearchResult[],
  config: LLMProviderConfig,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const llm = await createLLM(config);
  const passages = hits.map((h, i) => `[${i + 1}] ${h.text.replace(/\s+/g, " ")}`).join("\n\n");
  const { text } = await generateText({
    model: llm.languageModel,
    system: "You rank passages by how well they answer a search query.",
    prompt:
      `Query: ${query}\n\nPassages:\n${passages}\n\n` +
      "Reply with only a JSON array of the passage numbers, most relevant first, for example [3, 1, 2].",
    ...(llm.temperature !== undefined ? { temperature: llm.temperature } : {}),
    ...(signal ? { abortSignal: signal } : {}),
  });
  const order = parseRanking(text, hits.length);
  const rest = hits.map((_, i) => i).filter((i) => !order.includes(i));
  const n = hits.length;
  return [...order, ...rest].map((index, rank) => withRerankScore(hits[index]!, (n - rank) / n));
}

/** Zero-based passage indexes from the first JSON array of numbers in `text`. */
export function parseRanking(text: string, count: number): number[] {
  const match = /\[[\d\s,]*\]/.exec(text);
  if (!match) throw new Error(`the LLM did not reply with a JSON array: ${text.slice(0, 200)}`);
  const seen = new Set<number>();
  for (const n of JSON.parse(match[0]) as number[]) {
    if (Number.isInteger(n) && n >= 1 && n <= count) seen.add(n - 1);
  }
  return [...seen];
}
