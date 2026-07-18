import { Document, type LLMProviderConfig } from "../src/index.js";

async function main(): Promise<void> {
  const doc = new Document("./whitepaper.pdf", {
    embeddings: { provider: "local" },
  });

  await doc.build();

  const question = "Summarize the paper in three bullet points.";

  const providers: LLMProviderConfig[] = [
    { provider: "openai", model: "gpt-4o-mini", apiKey: process.env["OPENAI_API_KEY"] },
    {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      apiKey: process.env["ANTHROPIC_API_KEY"],
    },
    {
      provider: "google",
      model: "gemini-2.0-flash",
      apiKey: process.env["GOOGLE_GENERATIVE_AI_API_KEY"],
    },
    { provider: "mistral", model: "mistral-large-latest", apiKey: process.env["MISTRAL_API_KEY"] },
    { provider: "cohere", model: "command-r-plus", apiKey: process.env["COHERE_API_KEY"] },
    { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: process.env["GROQ_API_KEY"] },
  ];

  for (const llm of providers) {
    if (!llm.apiKey) {
      console.log(`\n== ${llm.provider} (${llm.model}) skipped (no API key) ==`);
      continue;
    }
    try {
      const start = Date.now();
      const answer = await doc.ask(question, { llm, topK: 5 });
      const elapsed = Date.now() - start;
      console.log(`\n== ${llm.provider} (${llm.model}) in ${elapsed}ms ==`);
      console.log(answer.text);
    } catch (err) {
      console.log(`\n== ${llm.provider} FAILED ==`);
      console.log(err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
