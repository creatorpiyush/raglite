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
import { reciprocalRankFusion } from "../src/retrieval/fusion.js";
import { KeywordIndex } from "../src/retrieval/keyword-index.js";
import { tokenize } from "../src/text/tokenizer.js";
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
    name: "unspaced CJK splits by character",
    text: "返金は三十日以内に行われます。配送には二営業日かかります。",
    chunkSize: 5,
    overlap: 1,
  },
  { name: "Japanese mixed with spaced words", text: "これは test です API返金 ok", chunkSize: 4, overlap: 1 },
  { name: "Thai keeps combining marks", text: "สวัสดีครับ ยินดีต้อนรับ", chunkSize: 3, overlap: 0 },
  { name: "Korean stays word-based", text: "환불은 30일 이내에 처리됩니다", chunkSize: 2, overlap: 0 },
  { name: "overlap not smaller than chunk size", text: words(3), chunkSize: 2, overlap: 2 },
];

const chunker = chunkerInputs.map((input) => {
  try {
    return { ...input, chunks: new RecursiveChunker(input.chunkSize, input.overlap).split(input.text) };
  } catch {
    return { ...input, error: true };
  }
});

const tokenizerInputs: { name: string; text: string }[] = [
  { name: "english", text: "Refunds are issued within 30 days." },
  { name: "code identifiers", text: "Call get_user() on gpt-4.1; see ERR_4021 and v1.2.3." },
  { name: "trailing and doubled joiners", text: "end. e.g. a--b _x_ snake_case_" },
  { name: "german", text: "Die STRASSE ist groß. Übermäßig!" },
  { name: "french", text: "Ça coûte 20€ — très cher, n'est-ce pas ?" },
  { name: "russian", text: "Возврат средств в течение 30 дней" },
  { name: "greek final sigma", text: "ΟΔΟΣ Οδυσσέας" },
  { name: "turkish dotted I", text: "İstanbul IŞIK" },
  { name: "arabic", text: "يتم استرداد المبلغ خلال ٣٠ يومًا" },
  { name: "hindi", text: "रिफंड 30 दिनों के भीतर जारी किए जाते हैं" },
  { name: "persian zero width non-joiner", text: "می‌خواهم" },
  { name: "chinese", text: "退款将在三十天内处理。" },
  { name: "japanese", text: "返金は30日以内に行われます。カタカナ" },
  { name: "korean", text: "환불은 30일 이내에 처리됩니다" },
  { name: "thai", text: "การคืนเงินภายใน 30 วัน" },
  { name: "mixed script word", text: "API返金とSKU-42の在庫" },
  { name: "single CJK character", text: "金 a 金" },
  { name: "fullwidth and ligatures", text: "ＡＢＣ１２３ ﬁle ①" },
  { name: "emoji and symbols", text: "ship it 🚀🔥 #release @team $5 100%" },
  { name: "soft hyphen", text: "co\u00adoperate" },
  { name: "empty", text: "" },
];

const tokenizer = tokenizerInputs.map((input) => ({ ...input, tokens: tokenize(input.text) }));

const bm25Corpus = [
  "Refunds are issued within 30 days of purchase.",
  "Error ERR_4021 means the payment gateway timed out.",
  "To retry a failed payment, open the billing page.",
  "返金は三十日以内に行われます。",
  "The billing page lists every payment and refund.",
  "",
].map((text, i) => ({
  id: `doc_${String(i + 1).padStart(6, "0")}`,
  text,
  metadata: { source: "corpus.txt", chunk: i + 1, totalChunks: 6 },
}));
const bm25Index = KeywordIndex.build(bm25Corpus);
const bm25 = {
  chunks: bm25Corpus.map(({ id, text }) => ({ id, text })),
  queries: [
    "ERR_4021",
    "payment",
    "billing page refund",
    "refund refund",
    "返金",
    "nothing matches this",
    "",
  ].map((query) => ({
    query,
    topK: 3,
    hits: bm25Index.search(query, 3).map(({ id, score }) => ({ id, score })),
  })),
};

const hit = (id: string, score: number) => ({
  id,
  text: id,
  metadata: { source: "s", chunk: 1, totalChunks: 1 },
  score,
});
const rrfInputs = [
  {
    name: "agreement wins",
    rrfK: 60,
    topK: 4,
    vector: { weight: 1, hits: [hit("a", 0.9), hit("b", 0.8), hit("c", 0.7)] },
    keyword: { weight: 1, hits: [hit("b", 7.5), hit("d", 3.1)] },
  },
  {
    name: "ties break on id",
    rrfK: 60,
    topK: 4,
    vector: { weight: 1, hits: [hit("z", 0.9), hit("y", 0.5)] },
    keyword: { weight: 1, hits: [hit("y", 2), hit("z", 1)] },
  },
  {
    name: "weights and small k",
    rrfK: 1,
    topK: 3,
    vector: { weight: 0.5, hits: [hit("a", 0.9), hit("b", 0.8)] },
    keyword: { weight: 2, hits: [hit("c", 4), hit("a", 1)] },
  },
  {
    name: "empty keyword list",
    rrfK: 60,
    topK: 2,
    vector: { weight: 1, hits: [hit("a", 0.9), hit("b", 0.8), hit("c", 0.1)] },
    keyword: { weight: 1, hits: [] },
  },
];
const rrf = rrfInputs.map((input) => ({
  ...input,
  results: reciprocalRankFusion(
    [
      { name: "vector", ...input.vector },
      { name: "keyword", ...input.keyword },
    ],
    input.rrfK,
    input.topK,
  ).map(({ id, score, scores }) => ({ id, score, scores })),
}));

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
writeFileSync(join(outDir, "tokenizer.json"), `${JSON.stringify(tokenizer, null, 2)}\n`, "utf-8");
writeFileSync(join(outDir, "bm25.json"), `${JSON.stringify(bm25, null, 2)}\n`, "utf-8");
writeFileSync(join(outDir, "rrf.json"), `${JSON.stringify(rrf, null, 2)}\n`, "utf-8");
console.log(`Wrote shared fixtures to ${outDir}`);
