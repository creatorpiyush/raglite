import { ConfigError } from "./errors.js";
import type { MetadataFilter } from "./retrieval/filter.js";
import type { RerankConfig, Reranker } from "./retrieval/rerank.js";
import type { RetrievalMode, SearchResult } from "./types.js";

/**
 * What a relevant result looks like: a string the passage contains (case and
 * whitespace are ignored), or a location in the index.
 */
export type EvalExpected = string | { source: string; chunk?: number; page?: number };

export interface EvalQuestion {
  question: string;
  expected: EvalExpected[];
}

export interface EvalOptions {
  /** Results scored per question (default 5). */
  topK?: number;
  /** Retrieval modes to compare (default vector, keyword and hybrid). */
  modes?: RetrievalMode[];
  /** Also score each mode with this reranker, as "<mode>+rerank". */
  rerank?: RerankConfig | Reranker;
  filter?: MetadataFilter;
}

export interface EvalRow {
  /** The retrieval mode, with "+rerank" when reranked. */
  mode: string;
  /** Mean share of each question's expected items found in the top k. */
  recall: number;
  /** Mean reciprocal rank of the first relevant result (0 when none). */
  mrr: number;
  /** Share of questions with at least one relevant result in the top k. */
  hitRate: number;
  /** Questions with no relevant result in the top k. */
  missed: string[];
}

export interface EvalReport {
  topK: number;
  questions: number;
  results: EvalRow[];
}

interface Searchable {
  search(
    query: string,
    options: {
      topK: number;
      mode: RetrievalMode;
      rerank: RerankConfig | Reranker | false;
      filter?: MetadataFilter;
    },
  ): Promise<SearchResult[]>;
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** True when `hit` is what `expected` describes. */
export function matchesExpected(hit: SearchResult, expected: EvalExpected): boolean {
  if (typeof expected === "string") return normalize(hit.text).includes(normalize(expected));
  const m = hit.metadata;
  if (m.source !== expected.source) return false;
  if (expected.chunk !== undefined && m.chunk !== expected.chunk) return false;
  if (expected.page !== undefined) {
    if (m.page === undefined) return false;
    if (expected.page < m.page || expected.page > (m.pageEnd ?? m.page)) return false;
  }
  return true;
}

/** Scores one question's results: [recall, reciprocal rank]. */
export function scoreResults(hits: SearchResult[], expected: EvalExpected[]): [number, number] {
  const found = expected.filter((e) => hits.some((h) => matchesExpected(h, e))).length;
  const first = hits.findIndex((h) => expected.some((e) => matchesExpected(h, e)));
  return [found / expected.length, first === -1 ? 0 : 1 / (first + 1)];
}

/**
 * Runs every question through each mode (and each mode with `rerank`) and
 * reports recall@k, MRR and hit rate.
 */
export async function evaluate(
  target: Searchable,
  questions: EvalQuestion[],
  options: EvalOptions = {},
): Promise<EvalReport> {
  const topK = options.topK ?? 5;
  const modes = options.modes ?? ["vector", "keyword", "hybrid"];
  if (questions.length === 0) throw new ConfigError("No questions to evaluate");
  const runs: { mode: string; rerank: RerankConfig | Reranker | false; base: RetrievalMode }[] =
    modes.map((mode) => ({ mode, rerank: false, base: mode }));
  if (options.rerank) {
    for (const mode of modes)
      runs.push({ mode: `${mode}+rerank`, rerank: options.rerank, base: mode });
  }

  const results: EvalRow[] = [];
  for (const run of runs) {
    let recall = 0;
    let mrr = 0;
    const missed: string[] = [];
    for (const q of questions) {
      const hits = await target.search(q.question, {
        topK,
        mode: run.base,
        rerank: run.rerank,
        ...(options.filter ? { filter: options.filter } : {}),
      });
      const [r, rr] = scoreResults(hits, q.expected);
      recall += r;
      mrr += rr;
      if (rr === 0) missed.push(q.question);
    }
    const n = questions.length;
    results.push({
      mode: run.mode,
      recall: recall / n,
      mrr: mrr / n,
      hitRate: (n - missed.length) / n,
      missed,
    });
  }
  return { topK, questions: questions.length, results };
}

/** Parses JSONL: one `{ "question": "...", "expected": [...] }` per line. */
export function parseQuestions(jsonl: string): EvalQuestion[] {
  const questions: EvalQuestion[] = [];
  jsonl.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === "") return;
    const where = `line ${i + 1}`;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new ConfigError(`${where}: not valid JSON`);
    }
    const q = value as Partial<EvalQuestion> | null;
    if (typeof q?.question !== "string" || q.question.trim() === "") {
      throw new ConfigError(`${where}: "question" must be a non-empty string`);
    }
    if (!Array.isArray(q.expected) || q.expected.length === 0) {
      throw new ConfigError(`${where}: "expected" must be a non-empty array`);
    }
    for (const e of q.expected as unknown[]) {
      const ok =
        (typeof e === "string" && e.trim() !== "") ||
        (typeof e === "object" &&
          e !== null &&
          typeof (e as { source?: unknown }).source === "string" &&
          ["chunk", "page"].every((k) => {
            const v = (e as Record<string, unknown>)[k];
            return v === undefined || Number.isInteger(v);
          }));
      if (!ok) {
        throw new ConfigError(
          `${where}: each "expected" item must be a string or { "source", "chunk"?, "page"? }`,
        );
      }
    }
    questions.push({ question: q.question, expected: q.expected as EvalExpected[] });
  });
  return questions;
}

/** The report as an aligned text table. */
export function formatReport(report: EvalReport): string {
  const header = ["mode", `recall@${report.topK}`, "MRR", "hit rate"];
  const rows = report.results.map((r) => [
    r.mode,
    r.recall.toFixed(3),
    r.mrr.toFixed(3),
    r.hitRate.toFixed(3),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("   ");
  const noun = report.questions === 1 ? "question" : "questions";
  return [
    `${report.questions} ${noun}, top ${report.topK}`,
    "",
    line(header),
    ...rows.map(line),
  ].join("\n");
}
