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
      const tag = includeCitations
        ? `[${index + 1}] (${chunk.metadata.source} #${chunk.metadata.chunk})`
        : `[${index + 1}]`;
      return `${tag}\n${chunk.text}`;
    })
    .join("\n\n---\n\n");

  const citationInstruction = includeCitations
    ? "\n\nCite the passages you used with their bracketed numbers, e.g. [1], [2]."
    : "";

  return `Context:\n${contextBlock}\n\nQuestion: ${question}${citationInstruction}\n\nAnswer:`;
}
