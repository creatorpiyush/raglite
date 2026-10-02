/**
 * Writes tests/fixtures/shared/*.json: inputs plus the outputs the TypeScript
 * SDK produces for them. The Python SDK keeps an identical copy of these files
 * and must produce the same outputs, which keeps the two SDKs' indexes and
 * cache keys interchangeable.
 *
 * Run after an intentional behaviour change, then copy the files to
 * raglite-py (see raglite-py/scripts/sync_shared_fixtures.py):
 *
 *   npx tsx scripts/generate-shared-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RecursiveChunker } from "../src/chunking/index.js";
import { hashString, namespaceFromPath } from "../src/utils/hash.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "shared");

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ");

const chunkerInputs: { name: string; text: string; chunkSize: number; overlap: number }[] = [
  { name: "empty", text: "", chunkSize: 500, overlap: 50 },
  { name: "whitespace only", text: " \n\t ", chunkSize: 500, overlap: 50 },
  { name: "short text", text: "Refunds are issued within 30 days.", chunkSize: 500, overlap: 50 },
  { name: "sliding window", text: words(12), chunkSize: 5, overlap: 2 },
  { name: "last window ends exactly", text: words(8), chunkSize: 5, overlap: 2 },
  { name: "no overlap", text: words(10), chunkSize: 4, overlap: 0 },
  { name: "mixed whitespace collapses", text: "a\n\nb\t c   d\r\ne", chunkSize: 500, overlap: 50 },
  { name: "no-break and ideographic spaces", text: "a\u00a0b\u3000c\u2009d", chunkSize: 2, overlap: 0 },
  { name: "byte order mark", text: "\ufeffalpha beta\ufeffgamma", chunkSize: 500, overlap: 50 },
  { name: "next line control", text: "alpha\u0085beta", chunkSize: 500, overlap: 50 },
  { name: "file separator control", text: "alpha\u001cbeta", chunkSize: 500, overlap: 50 },
  { name: "accents and emoji", text: "café naïve 返金 🚀 ok", chunkSize: 2, overlap: 1 },
  {
    name: "unspaced CJK stays one word",
    text: "返金は三十日以内に行われます。配送には二営業日かかります。",
    chunkSize: 5,
    overlap: 1,
  },
  { name: "overlap not smaller than chunk size", text: words(3), chunkSize: 2, overlap: 2 },
];

const chunker = chunkerInputs.map((input) => {
  try {
    return { ...input, chunks: new RecursiveChunker(input.chunkSize, input.overlap).split(input.text) };
  } catch {
    return { ...input, error: true };
  }
});

const hashInputs = ["", "hello", "Refunds 30 días — 返金 🚀", "line1\r\nline2"];
const hash = {
  hashString: hashInputs.map((input) => ({ input, sha256: hashString(input) })),
  namespaceFromPath: ["/tmp/docs/policy.pdf", "C:\\docs\\policy.pdf", "https://example.com/policy"].map(
    (input) => ({ input, namespace: namespaceFromPath(input) }),
  ),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "chunker.json"), `${JSON.stringify(chunker, null, 2)}\n`, "utf-8");
writeFileSync(join(outDir, "hash.json"), `${JSON.stringify(hash, null, 2)}\n`, "utf-8");
console.log(`Wrote shared fixtures to ${outDir}`);
