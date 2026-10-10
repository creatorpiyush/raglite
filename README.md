# raglite-toolkit

Semantic search, cited answers, an MCP server and agent tools over your documents, in a few lines of TypeScript.

[![npm](https://img.shields.io/npm/v/raglite-toolkit)](https://www.npmjs.com/package/raglite-toolkit)
[![Docs](https://img.shields.io/badge/docs-creatorpiyush.github.io%2Fraglite-blue)](https://creatorpiyush.github.io/raglite/)
[![PR Verification](https://github.com/creatorpiyush/raglite/actions/workflows/pr-verify.yml/badge.svg)](https://github.com/creatorpiyush/raglite/actions/workflows/pr-verify.yml)
[![License: MIT](https://img.shields.io/npm/l/raglite-toolkit)](https://github.com/creatorpiyush/raglite/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/raglite-toolkit)](https://www.npmjs.com/package/raglite-toolkit)

**[Documentation](https://creatorpiyush.github.io/raglite/)** · [Getting started](https://creatorpiyush.github.io/raglite/getting-started/) · [Providers](https://creatorpiyush.github.io/raglite/providers/) · [MCP server](https://creatorpiyush.github.io/raglite/guides/mcp/) · [Troubleshooting](https://creatorpiyush.github.io/raglite/troubleshooting/) · [Changelog](https://github.com/creatorpiyush/raglite/blob/main/CHANGELOG.md)

RAGLite indexes PDFs, Word files, Markdown, text, JSON, folders and web pages, then searches them and answers questions with any LLM, citing the passages it used.

- **Answers with citations**, including the PDF page and Markdown section of each passage
- **Hybrid search**: vector search for meaning, BM25 for exact terms such as error codes, or both
- **MCP server** for Claude Code, Claude Desktop, Cursor and VS Code, and an **AI SDK tool** for your own agents
- **Any provider**: OpenAI, Anthropic, Google, Mistral, Cohere, Groq, xAI and Ollama; install only what you use
- **Fully local** option: local embeddings and Ollama, no API key
- Content-hash caching, Qdrant, Pinecone and LanceDB stores, streaming, a REST API and a CLI

## Install

Requires Node.js 20 or later.

```bash
npm install raglite-toolkit
npm install @huggingface/transformers   # local embeddings (the default), no API key
npm install @ai-sdk/anthropic           # Claude answers; see Providers for the others
```

## Quick start

```ts
import { Document } from "raglite-toolkit";

const doc = new Document("./policy.pdf", {
  llm: { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY },
});

await doc.build();

const hits = await doc.search("refund policy", { topK: 3 });

const answer = await doc.ask("What is the refund policy?");
console.log(answer.text); // "Refunds are issued within 30 days [1]."
console.log(answer.citations); // [{ n: 1, source: "policy.pdf", page: 12, text: "..." }]
```

## Learn more

- [Collections](https://creatorpiyush.github.io/raglite/guides/collections/): index folders, files and URLs together
- [Citations](https://creatorpiyush.github.io/raglite/guides/citations/): pages and sections for each cited passage
- [Hybrid search](https://creatorpiyush.github.io/raglite/guides/hybrid-search/): vector, keyword and hybrid retrieval
- [MCP server](https://creatorpiyush.github.io/raglite/guides/mcp/): give your documents to AI coding tools
- [Agent tools](https://creatorpiyush.github.io/raglite/guides/agent-tools/): `asTool()` for the Vercel AI SDK
- [Streaming, progress and cancellation](https://creatorpiyush.github.io/raglite/guides/streaming/)
- [Vector stores](https://creatorpiyush.github.io/raglite/guides/vector-stores/): Qdrant, Pinecone, LanceDB or your own
- [REST API](https://creatorpiyush.github.io/raglite/guides/rest-api/) and [CLI](https://creatorpiyush.github.io/raglite/guides/cli/)
- [How caching works](https://creatorpiyush.github.io/raglite/guides/caching/)
- [Options and types](https://creatorpiyush.github.io/raglite/reference/options/)

## Python

The same library for Python: [`raglite-toolkit` on PyPI](https://pypi.org/project/raglite-toolkit/) ([source](https://github.com/creatorpiyush/raglite-py)). Every page of the documentation has TypeScript and Python tabs.

## Contributing

See [CONTRIBUTING.md](https://github.com/creatorpiyush/raglite/blob/main/CONTRIBUTING.md). Security issues: [SECURITY.md](https://github.com/creatorpiyush/raglite/blob/main/SECURITY.md).

## License

MIT
