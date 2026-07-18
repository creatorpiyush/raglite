import { generateText, streamText } from "ai";
import { LLMError } from "../errors.js";
import type { LLMProviderConfig, SearchResult } from "../types.js";
import { createLLM } from "./factory.js";
import { buildSystemPrompt, buildUserPrompt, type PromptOptions } from "./prompt.js";

export interface GenerateAnswerOptions extends PromptOptions {
  llm: LLMProviderConfig;
  question: string;
  context: SearchResult[];
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
}

export async function generateAnswer(options: GenerateAnswerOptions): Promise<AnswerResult> {
  const { llm: llmConfig, question, context, ...promptOptions } = options;

  const llm = await createLLM(llmConfig);

  try {
    const result = await generateText({
      model: llm.languageModel,
      system: buildSystemPrompt(promptOptions),
      prompt: buildUserPrompt(question, context, promptOptions),
      temperature: llm.temperature,
      ...(llm.maxTokens !== undefined ? { maxTokens: llm.maxTokens } : {}),
    });

    return {
      text: result.text,
      provider: llm.provider,
      model: llm.model,
      usage: result.usage,
      finishReason: result.finishReason,
    };
  } catch (cause) {
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
      temperature: llm.temperature,
      ...(llm.maxTokens !== undefined ? { maxTokens: llm.maxTokens } : {}),
    });
    for await (const delta of result.textStream) {
      yield delta;
    }
  } catch (cause) {
    throw new LLMError(`Failed to stream answer via ${llm.provider} (${llm.model})`, { cause });
  }
}
