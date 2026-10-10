import type { SearchResult } from "../types.js";

export interface PromptOptions {
  includeCitations?: boolean;
  systemHint?: string;
}

export function buildSystemPrompt(options: PromptOptions = {}): string {
  const base =
    "You are a precise assistant that answers questions strictly from the provided context. " +
    "If the answer is not contained in the context, respond exactly: " +
    '"I could not find the answer in the provided documents."';
  return options.systemHint ? `${base}\n\n${options.systemHint}` : base;
}

export function buildUserPrompt(
  question: string,
  context: SearchResult[],
  options: PromptOptions = {},
): string {
  const includeCitations = options.includeCitations ?? true;

  const contextBlock = context
    .map((chunk, index) => {
      const tag = includeCitations ? `[${index + 1}] (${describeSource(chunk)})` : `[${index + 1}]`;
      return `${tag}\n${chunk.text}`;
    })
    .join("\n\n---\n\n");

  const citationInstruction = includeCitations
    ? "\n\nCite the passages you used with their bracketed numbers, e.g. [1], [2]."
    : "";

  return `Context:\n${contextBlock}\n\nQuestion: ${question}${citationInstruction}\n\nAnswer:`;
}

/** "policy.pdf #3, p. 12, Refunds": what the model sees next to each passage number. */
function describeSource(chunk: SearchResult): string {
  const { source, chunk: n, page, pageEnd, section } = chunk.metadata;
  let label = `${source} #${n}`;
  if (page !== undefined)
    label += pageEnd !== undefined ? `, pp. ${page}-${pageEnd}` : `, p. ${page}`;
  if (section) label += `, ${section}`;
  return label;
}

/** A passage the answer cited as [n]. */
export interface Citation {
  /** The number used in the answer, e.g. 2 for "[2]". */
  n: number;
  source: string;
  chunk: number;
  page?: number;
  pageEnd?: number;
  section?: string;
  /** The cited passage. */
  text: string;
}

const CITATION = /\[([0-9]+(?:[ \t]*,[ \t]*[0-9]+)*)\]/g;

/**
 * The passages cited in an answer, in order of first citation. Understands
 * "[2]", "[1][3]" and "[1, 3]"; numbers outside the context are ignored.
 */
export function extractCitations(answer: string, context: SearchResult[]): Citation[] {
  const seen = new Set<number>();
  const citations: Citation[] = [];
  for (const match of answer.matchAll(CITATION)) {
    for (const part of match[1]!.split(",")) {
      const n = Number(part.trim());
      const chunk = context[n - 1];
      if (!chunk || seen.has(n)) continue;
      seen.add(n);
      const { source, chunk: index, page, pageEnd, section } = chunk.metadata;
      citations.push({
        n,
        source,
        chunk: index,
        ...(page !== undefined ? { page } : {}),
        ...(pageEnd !== undefined ? { pageEnd } : {}),
        ...(section !== undefined ? { section } : {}),
        text: chunk.text,
      });
    }
  }
  return citations;
}
