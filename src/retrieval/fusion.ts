import type { ChunkMetadata, SearchResult, SearchScores } from "../types.js";
import { byScoreThenId } from "./keyword-index.js";

interface RankedHit {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  score: number;
}

export interface RankedList {
  name: "vector" | "keyword";
  weight: number;
  /** Best first. */
  hits: RankedHit[];
}

/**
 * Reciprocal Rank Fusion: `fused(d) = Σ weight / (rrfK + rank(d))` over the
 * lists, with ranks starting at 1. `score` is the fused score divided by the
 * highest possible one, so 1 means "ranked first by every list", and
 * `scores` keeps each list's own score.
 */
export function reciprocalRankFusion(
  lists: RankedList[],
  rrfK: number,
  topK: number,
): SearchResult[] {
  const active = lists.filter((l) => l.weight > 0);
  const maxFused = active.reduce((sum, l) => sum + l.weight / (rrfK + 1), 0);
  if (maxFused === 0) return [];

  const fused = new Map<string, { hit: RankedHit; fused: number; scores: SearchScores }>();
  for (const list of active) {
    list.hits.forEach((hit, i) => {
      let entry = fused.get(hit.id);
      if (!entry) {
        entry = { hit, fused: 0, scores: {} };
        fused.set(hit.id, entry);
      }
      entry.fused += list.weight / (rrfK + i + 1);
      entry.scores[list.name] = hit.score;
    });
  }

  const results: SearchResult[] = [];
  for (const { hit, fused: raw, scores } of fused.values()) {
    const score = raw / maxFused;
    results.push({
      id: hit.id,
      text: hit.text,
      metadata: hit.metadata,
      score,
      distance: 1 - score,
      scores: { ...scores, fused: raw },
    });
  }
  results.sort(byScoreThenId);
  return results.slice(0, topK);
}
