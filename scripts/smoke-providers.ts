/**
 * Live smoke test: one embedding call and one answer per provider, with the default models.
 *
 *   npm run smoke:providers
 *
 * A provider runs only when its API key is set (Ollama: OLLAMA_BASE_URL). Exits 1 if any
 * provider that ran failed, so a retired or mistyped default model fails before a release.
 * The Python SDK's scripts/smoke_providers.py reads the same variables.
 */
import { createEmbedder } from "../src/embeddings/index.js";
import { DEFAULT_EMBEDDING_MODELS } from "../src/embeddings/models.js";
import { generateAnswer } from "../src/llm/index.js";
import { DEFAULT_LLM_MODELS } from "../src/llm/models.js";
import type { EmbeddingProviderName, LLMProviderName, SearchResult } from "../src/types.js";

const KEY_VARS = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cohere: "COHERE_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  voyage: "VOYAGE_API_KEY",
  ollama: "OLLAMA_BASE_URL",
} as const;

const LLM_PROVIDERS: LLMProviderName[] = [
  "openai",
  "anthropic",
  "google",
  "mistral",
  "cohere",
  "groq",
  "xai",
  "ollama",
];
const EMBEDDING_PROVIDERS: Exclude<EmbeddingProviderName, "local">[] = [
  "openai",
  "google",
  "mistral",
  "cohere",
  "voyage",
  "ollama",
];

const CONTEXT: SearchResult[] = [
  {
    id: "smoke_000001",
    text: "The refund window is 30 days from the date of purchase.",
    metadata: { source: "smoke", chunk: 1, totalChunks: 1 },
    score: 1,
    distance: 0,
  },
];

/** apiKey, or baseURL for Ollama; undefined when the variable is unset. */
function credentials(provider: keyof typeof KEY_VARS): { apiKey?: string; baseURL?: string } | undefined {
  const value = process.env[KEY_VARS[provider]];
  if (!value) return undefined;
  return provider === "ollama" ? { baseURL: value } : { apiKey: value };
}

let failures = 0;
let ran = 0;

async function check(kind: string, provider: keyof typeof KEY_VARS, model: string, run: () => Promise<string>) {
  const label = `${kind.padEnd(9)} ${provider.padEnd(9)} ${model}`;
  if (!credentials(provider)) {
    console.log(`SKIP  ${label}  (${KEY_VARS[provider]} not set)`);
    return;
  }
  ran++;
  const start = Date.now();
  try {
    const detail = await run();
    console.log(`PASS  ${label}  ${((Date.now() - start) / 1000).toFixed(1)}s  ${detail}`);
  } catch (err) {
    failures++;
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = cause instanceof Error ? cause.message : String(cause);
    console.log(`FAIL  ${label}  ${message.split("\n")[0]?.slice(0, 200)}`);
  }
}

for (const provider of EMBEDDING_PROVIDERS) {
  await check("embedding", provider, DEFAULT_EMBEDDING_MODELS[provider], async () => {
    const embedder = await createEmbedder({ provider, ...credentials(provider) });
    const vector = await embedder.embedQuery("refund policy");
    if (vector.length === 0) throw new Error("empty embedding");
    return `${vector.length} dims`;
  });
}

for (const provider of LLM_PROVIDERS) {
  await check("llm", provider, DEFAULT_LLM_MODELS[provider], async () => {
    const answer = await generateAnswer({
      llm: { provider, ...credentials(provider) },
      question: "How long is the refund window? Answer in a few words.",
      context: CONTEXT,
    });
    if (!answer.text.trim()) throw new Error(`empty answer (finish reason: ${answer.finishReason})`);
    return JSON.stringify(answer.text.trim().slice(0, 60));
  });
}

if (ran === 0) console.log("\nNo provider credentials set; nothing was tested.");
console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures > 0 ? 1 : 0);
