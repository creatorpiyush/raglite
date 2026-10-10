import type { LLMProviderName } from "../types.js";

export const DEFAULT_LLM_MODELS: Record<LLMProviderName, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5-5",
  google: "gemini-3.8-flash",
  mistral: "mistral-large-latest",
  cohere: "command-a-03-2025",
  groq: "openai/gpt-oss-120b",
  xai: "grok-4.7",
  ollama: "llama3.2",
};
