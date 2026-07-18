import type { LanguageModel } from "ai";
import { LLMError } from "../errors.js";
import type { LLMProviderConfig, LLMProviderName } from "../types.js";
import { DEFAULT_LLM_MODELS } from "./models.js";

export interface ResolvedLLM {
  provider: LLMProviderName;
  model: string;
  languageModel: LanguageModel;
  temperature: number;
  maxTokens?: number;
}

export async function createLLM(config: LLMProviderConfig): Promise<ResolvedLLM> {
  const model = config.model ?? DEFAULT_LLM_MODELS[config.provider];
  const languageModel = await buildLanguageModel(config.provider, model, config);
  return {
    provider: config.provider,
    model,
    languageModel,
    temperature: config.temperature ?? 0,
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
  };
}

async function buildLanguageModel(
  provider: LLMProviderName,
  model: string,
  config: LLMProviderConfig,
): Promise<LanguageModel> {
  const opts: Record<string, string | undefined> = {};
  if (config.apiKey) opts["apiKey"] = config.apiKey;
  if (config.baseURL) opts["baseURL"] = config.baseURL;

  switch (provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI(opts)(model);
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic(opts)(model);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI(opts)(model);
    }
    case "mistral": {
      const { createMistral } = await import("@ai-sdk/mistral");
      return createMistral(opts)(model);
    }
    case "cohere": {
      const { createCohere } = await import("@ai-sdk/cohere");
      return createCohere(opts)(model);
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq(opts)(model);
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      return createXai(opts)(model);
    }
    case "ollama": {
      const { createOllama } = await import("ollama-ai-provider-v2");
      const client = createOllama(config.baseURL ? { baseURL: config.baseURL } : {});
      return client(model);
    }
    default: {
      const _exhaustive: never = provider;
      throw new LLMError(`Unsupported LLM provider: ${String(_exhaustive)}`);
    }
  }
}
