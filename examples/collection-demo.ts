import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DocumentCollection } from "../src/index.js";

async function main() {
  console.log("=================================================");
  console.log("  RAGLite Multi-Document & Directory Ingestion   ");
  console.log("=================================================");

  const sampleDir = join(process.cwd(), "temp_sample_docs");

  try {
    // 1. Create a sample directory with mixed document types (.md, .txt, .json)
    rmSync(sampleDir, { recursive: true, force: true });
    mkdirSync(sampleDir, { recursive: true });

    writeFileSync(
      join(sampleDir, "policy.md"),
      "# Refund Policy\nCustomers are eligible for a full refund within 30 days of purchase.",
    );

    writeFileSync(
      join(sampleDir, "shipping.txt"),
      "Standard domestic shipping takes 3-5 business days. Express shipping takes 1-2 days.",
    );

    writeFileSync(
      join(sampleDir, "product.json"),
      JSON.stringify({
        product: "Acme RAG Engine",
        version: "1.1.0",
        features: ["Local offline embeddings", "Multi-document collection search", "Hono REST API"],
      }),
    );

    console.log(`\n📁 Created sample document directory at:\n   ${sampleDir}`);
    console.log("   - policy.md\n   - shipping.txt\n   - product.json");

    // 2. Initialize DocumentCollection
    const collection = new DocumentCollection(sampleDir, {
      logLevel: "info",
    });

    // 3. Build index across all directory files
    console.log("\n⚡ Building semantic index across collection...");
    const buildResult = await collection.build();

    console.log("\n📊 Index Summary:");
    console.log(`   - Documents Indexed : ${buildResult.totalDocuments}`);
    console.log(`   - Chunks Generated  : ${buildResult.totalChunks}`);
    console.log(`   - Errors / Warnings : ${buildResult.errors.length}`);

    // 4. Perform multi-document semantic search
    console.log("\n🔍 Searching for 'refund policy' across collection...");
    const searchHits = await collection.search("refund policy", { topK: 3 });

    console.log(`\nFound ${searchHits.length} hit(s):`);
    for (const [index, hit] of searchHits.entries()) {
      console.log(
        `\n  [Hit ${index + 1}] Score: ${hit.score.toFixed(4)} | Source: ${hit.metadata.source}`,
      );
      console.log(`  Content: "${hit.text}"`);
    }

    console.log("\n=================================================");
    console.log("  Multi-Document Ingestion Demo Completed!      ");
    console.log("=================================================");
  } finally {
    rmSync(sampleDir, { recursive: true, force: true });
  }
}

main().catch(console.error);
