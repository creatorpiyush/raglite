import type { LanguageModel } from "ai";
import { LLMError, missingPackage } from "../errors.js";
import type { LLMProviderConfig, LLMProviderName } from "../types.js";
import { DEFAULT_LLM_MODELS } from "./models.js";

export interface ResolvedLLM {
  provider: LLMProviderName;
  model: string;
  languageModel: LanguageModel;
  /** Unset for Anthropic unless configured: Claude 5 models reject non-default sampling values. */
  temperature?: number;
  maxTokens?: number;
}

export async function createLLM(config: LLMProviderConfig): Promise<ResolvedLLM> {
  const model = config.model ?? DEFAULT_LLM_MODELS[config.provider];
  const languageModel = await buildLanguageModel(config.provider, model, config);
  const temperature = config.temperature ?? (config.provider === "anthropic" ? undefined : 0);
  return {
    provider: config.provider,
    model,
    languageModel,
    ...(temperature !== undefined ? { temperature } : {}),
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
      const { createOpenAI } = await import("@ai-sdk/openai").catch(
        missingPackage("@ai-sdk/openai", `The "${provider}" LLM provider`),
      );
      return createOpenAI(opts)(model);
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic").catch(
        missingPackage("@ai-sdk/anthropic", `The "${provider}" LLM provider`),
      );
      return createAnthropic(opts)(model);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google").catch(
        missingPackage("@ai-sdk/google", `The "${provider}" LLM provider`),
      );
      return createGoogleGenerativeAI(opts)(model);
    }
    case "mistral": {
      const { createMistral } = await import("@ai-sdk/mistral").catch(
        missingPackage("@ai-sdk/mistral", `The "${provider}" LLM provider`),
      );
      return createMistral(opts)(model);
    }
    case "cohere": {
      const { createCohere } = await import("@ai-sdk/cohere").catch(
        missingPackage("@ai-sdk/cohere", `The "${provider}" LLM provider`),
      );
      return createCohere(opts)(model);
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq").catch(
        missingPackage("@ai-sdk/groq", `The "${provider}" LLM provider`),
      );
      return createGroq(opts)(model);
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai").catch(
        missingPackage("@ai-sdk/xai", `The "${provider}" LLM provider`),
      );
      return createXai(opts)(model);
    }
    case "ollama": {
      const { createOllama } = await import("ollama-ai-provider-v2").catch(
        missingPackage("ollama-ai-provider-v2", `The "${provider}" LLM provider`),
      );
      const client = createOllama(config.baseURL ? { baseURL: config.baseURL } : {});
      return client(model);
    }
    default: {
      const _exhaustive: never = provider;
      throw new LLMError(`Unsupported LLM provider: ${String(_exhaustive)}`);
    }
  }
}
