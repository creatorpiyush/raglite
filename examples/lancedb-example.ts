import { Document } from "../src/index.js";

async function main() {
  console.log("=== LanceDB Local Vector Store Example ===");

  // Initialize document with local embeddings and a LanceDB vector store
  const doc = new Document("./examples/sample.txt", {
    embeddings: {
      provider: "local",
      model: "Xenova/all-MiniLM-L6-v2",
    },
    vectorStore: {
      provider: "lancedb",
      storeDir: "./.raglite_lancedb_demo",
    },
    chunkSize: 50,
    overlap: 10,
    logLevel: "info",
  });

  console.log("Building index...");
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
