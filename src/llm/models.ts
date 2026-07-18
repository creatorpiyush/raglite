import type { LLMProviderName } from "../types.js";

export const DEFAULT_LLM_MODELS: Record<LLMProviderName, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  google: "gemini-2.0-flash",
  mistral: "mistral-large-latest",
  cohere: "command-r-plus",
  groq: "llama-3.3-70b-versatile",
  xai: "grok-2-latest",
  ollama: "llama3.2",
};
