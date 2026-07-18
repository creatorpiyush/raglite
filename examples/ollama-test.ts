import { performance } from "node:perf_hooks";
import { Document } from "../src/index.js";

const OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://localhost:11434/api";
const EMBED_MODEL = process.env["OLLAMA_EMBED_MODEL"] ?? "embeddinggemma:latest";
const CHAT_MODEL = process.env["OLLAMA_CHAT_MODEL"] ?? "gemma3:latest";

function separator(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

async function main(): Promise<void> {
  separator("raglite + Ollama end-to-end test");
  console.log(`Ollama base URL:  ${OLLAMA_URL}`);
  console.log(`Embedding model:  ${EMBED_MODEL}`);
  console.log(`Chat model:       ${CHAT_MODEL}`);

  const doc = new Document("./examples/sample.txt", {
    embeddings: {
      provider: "ollama",
      model: EMBED_MODEL,
      baseURL: OLLAMA_URL,
    },
    llm: {
      provider: "ollama",
      model: CHAT_MODEL,
      baseURL: OLLAMA_URL,
    },
    chunkSize: 60,
    overlap: 10,
    logLevel: "info",
  });

  separator("Step 1: build() — chunk + embed via Ollama");
  const t0 = performance.now();
  const build = await doc.build({ rebuild: true });
  console.log(`Built in ${(performance.now() - t0).toFixed(0)}ms:`, build);

  separator("Step 2: semantic search — 4 queries, top 2 each");
  const queries = [
    "How long do I have to ask for a refund?",
    "Do you ship to P.O. boxes?",
    "What is not covered by the warranty?",
    "Do you sell my personal data?",
  ];

  for (const q of queries) {
    const t = performance.now();
    const hits = await doc.search(q, { topK: 2 });
    const dt = (performance.now() - t).toFixed(0);
    console.log(`\nQ: ${q}   (${dt}ms)`);
    for (const h of hits) {
      const preview = h.text.replace(/\s+/g, " ").slice(0, 90);
      console.log(`   #${h.metadata.chunk}  score=${h.score.toFixed(3)}  ${preview}...`);
    }
  }

  separator("Step 3: ask() — full RAG answer via Gemma");
  const q = "In one sentence, what does Acme's warranty NOT cover?";
  console.log(`Question: ${q}\n`);
  const t2 = performance.now();
  const answer = await doc.ask(q, { topK: 3 });
  const dt2 = (performance.now() - t2).toFixed(0);
  console.log(`Answered in ${dt2}ms via ${answer.provider}/${answer.model}\n`);
  console.log(answer.text);
  if (answer.usage) console.log("\nUsage:", answer.usage);

  separator("Step 4: askStream() — token-by-token streaming");
  const q3 = "Summarize the shipping policy in 2 short bullet points.";
  console.log(`Question: ${q3}\n`);
  process.stdout.write("Answer: ");
  const tStream = performance.now();
  let firstTokenAt: number | null = null;
  let tokens = 0;
  for await (const delta of doc.askStream(q3, { topK: 2 })) {
    if (firstTokenAt === null) firstTokenAt = performance.now();
    tokens += 1;
    process.stdout.write(delta);
  }
  const tEnd = performance.now();
  console.log(`\n\nTime to first token: ${((firstTokenAt ?? tEnd) - tStream).toFixed(0)}ms`);
  console.log(`Total stream time:   ${(tEnd - tStream).toFixed(0)}ms  (${tokens} chunks)`);

  separator("Step 5: cache hit — rerun build()");
  const cached = await doc.build();
  console.log(cached);

  separator("Done.");
}

main().catch((err) => {
  console.error("\nTEST FAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.cause) console.error("Cause:", err.cause);
  process.exit(1);
});
