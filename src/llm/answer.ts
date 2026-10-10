import { generateText, streamText } from "ai";
import { LLMError } from "../errors.js";
import type { LLMProviderConfig, SearchResult } from "../types.js";
import { createLLM } from "./factory.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  type Citation,
  extractCitations,
  type PromptOptions,
} from "./prompt.js";

export interface GenerateAnswerOptions extends PromptOptions {
  llm: LLMProviderConfig;
  question: string;
  context: SearchResult[];
  signal?: AbortSignal;
}

export interface AnswerResult {
  text: string;
  provider: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  /** Passages the answer cites as [n], in order of first citation. */
  citations: Citation[];
}

export async function generateAnswer(options: GenerateAnswerOptions): Promise<AnswerResult> {
  const { llm: llmConfig, question, context, ...promptOptions } = options;

  const llm = await createLLM(llmConfig);

  try {
    const result = await generateText({
      model: llm.languageModel,
      system: buildSystemPrompt(promptOptions),
      prompt: buildUserPrompt(question, context, promptOptions),
      ...(llm.temperature !== undefined ? { temperature: llm.temperature } : {}),
      ...(llm.maxTokens !== undefined ? { maxOutputTokens: llm.maxTokens } : {}),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    });

    return {
      text: result.text,
      provider: llm.provider,
      model: llm.model,
      usage: result.usage,
      finishReason: result.finishReason,
      citations: extractCitations(result.text, context),
    };
  } catch (cause) {
    options.signal?.throwIfAborted();
    throw new LLMError(`Failed to generate answer via ${llm.provider} (${llm.model})`, { cause });
  }
}

export async function* streamAnswer(
  options: GenerateAnswerOptions,
): AsyncGenerator<string, void, void> {
  const { llm: llmConfig, question, context, ...promptOptions } = options;
  const llm = await createLLM(llmConfig);

  try {
    const result = streamText({
      model: llm.languageModel,
      system: buildSystemPrompt(promptOptions),
      prompt: buildUserPrompt(question, context, promptOptions),
      ...(llm.temperature !== undefined ? { temperature: llm.temperature } : {}),
      ...(llm.maxTokens !== undefined ? { maxOutputTokens: llm.maxTokens } : {}),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    });
    for await (const delta of result.textStream) {
      yield delta;
    }
  } catch (cause) {
    options.signal?.throwIfAborted();
    throw new LLMError(`Failed to stream answer via ${llm.provider} (${llm.model})`, { cause });
  }
}
