import { Document } from "../src/index.js";

async function main() {
  console.log("=== Qdrant Vector Store Example ===");

  // By default, targets a local Qdrant container at http://localhost:6333
  // Run with: docker run -p 6333:6333 qdrant/qdrant
  const QDRANT_URL = process.env["QDRANT_URL"] ?? "http://localhost:6333";
  const QDRANT_KEY = process.env["QDRANT_API_KEY"]; // optional API key for Qdrant Cloud

  console.log(`Targeting Qdrant URL: ${QDRANT_URL}`);

  const doc = new Document("./examples/sample.txt", {
    embeddings: {
      provider: "local",
      model: "Xenova/all-MiniLM-L6-v2",
    },
    vectorStore: {
      provider: "qdrant",
      url: QDRANT_URL,
      apiKey: QDRANT_KEY,
      indexName: "qdrant_raglite_demo",
    },
    chunkSize: 50,
    overlap: 10,
    logLevel: "info",
  });

  console.log("Building index in Qdrant...");
  const buildResult = await doc.build({ rebuild: true });
  console.log("Index built successfully:", buildResult);

  const query = "shipping policy";
  console.log(`\nRunning semantic search for query: "${query}"...`);
  const hits = await doc.search(query, { topK: 3 });

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    console.log(`\nHit #${i + 1} (Score: ${hit.score.toFixed(4)}):`);
    console.log(`Text: "${hit.text}"`);
    console.log(`Source: ${hit.metadata.source} (Chunk #${hit.metadata.chunk})`);
  }

  console.log("\nDemo complete.");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
