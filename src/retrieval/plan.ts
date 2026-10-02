import { DEFAULT_RRF_K, MIN_HYBRID_CANDIDATES } from "../constants.js";
import { ConfigError } from "../errors.js";
import type { HybridOptions, RetrievalMode, RetrievalOptions } from "../types.js";

const MODES: ReadonlySet<string> = new Set(["vector", "keyword", "hybrid"]);

/** Fully resolved retrieval settings for one search call. */
export interface RetrievalPlan {
  mode: RetrievalMode;
  topK: number;
  scoreThreshold: number;
  rrfK: number;
  candidates: number;
  weights: { vector: number; keyword: number };
}

/** Merges per-call options over the configured defaults and validates the result. */
export function resolveRetrievalPlan(
  defaults: RetrievalOptions,
  call: { mode?: RetrievalMode; hybrid?: HybridOptions },
  topK: number,
  scoreThreshold: number,
): RetrievalPlan {
  const mode = call.mode ?? defaults.mode ?? "vector";
  if (!MODES.has(mode)) {
    throw new ConfigError(`Unknown retrieval mode "${mode}". Use "vector", "keyword" or "hybrid".`);
  }
  const rrfK = call.hybrid?.rrfK ?? defaults.hybrid?.rrfK ?? DEFAULT_RRF_K;
  const candidates =
    call.hybrid?.candidates ??
    defaults.hybrid?.candidates ??
    Math.max(MIN_HYBRID_CANDIDATES, topK * 4);
  const weights = {
    vector: call.hybrid?.weights?.vector ?? defaults.hybrid?.weights?.vector ?? 1,
    keyword: call.hybrid?.weights?.keyword ?? defaults.hybrid?.weights?.keyword ?? 1,
  };

  if (!(rrfK > 0)) throw new ConfigError(`hybrid.rrfK must be positive, got ${rrfK}`);
  if (!Number.isInteger(candidates) || candidates <= 0) {
    throw new ConfigError(`hybrid.candidates must be a positive integer, got ${candidates}`);
  }
  if (!(weights.vector >= 0 && weights.keyword >= 0) || weights.vector + weights.keyword === 0) {
    throw new ConfigError("hybrid.weights must be non-negative and not both zero");
  }
  // Results can only come from the candidate lists, so never take fewer than topK.
  return { mode, topK, scoreThreshold, rrfK, candidates: Math.max(candidates, topK), weights };
}
