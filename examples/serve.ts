import { Document } from "../src/index.js";

async function main(): Promise<void> {
  const doc = new Document("./policy.pdf", {
    embeddings: { provider: "local" },
  });

  await doc.build();

  const handle = await doc.serve({
    port: 8085,
    llm: {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: process.env["OPENAI_API_KEY"],
    },
    bearerToken: process.env["RAGFORGE_TOKEN"] ?? "change-me",
    requestLogging: true,
  });

  console.log(`Serving on ${handle.url}`);
  console.log("Try:");
  console.log(`  curl ${handle.url}/health`);
  console.log(
    `  curl -X POST ${handle.url}/search -H 'authorization: Bearer change-me' -H 'content-type: application/json' -d '{"query":"refunds"}'`,
  );

  const shutdown = async () => {
    console.log("Shutting down...");
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
