import { Document } from "../src/index.js";

async function main(): Promise<void> {
  const doc = new Document("./policy.pdf", {
    embeddings: {
      provider: "openai",
      apiKey: process.env["OPENAI_API_KEY"],
    },
    llm: {
      provider: "anthropic",
      apiKey: process.env["ANTHROPIC_API_KEY"],
    },
  });

  const build = await doc.build();
  console.log("Index built:", build);

  const hits = await doc.search("refund policy", { topK: 3 });
  console.log("Top search hits:");
  for (const hit of hits) {
    console.log(`  [${hit.metadata.chunk}] score=${hit.score.toFixed(3)}`);
    console.log(`    ${hit.text.slice(0, 120)}...`);
  }

  const answer = await doc.ask("What is the refund policy?");
  console.log("\nAnswer:", answer.text);
  console.log("Usage:", answer.usage);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
