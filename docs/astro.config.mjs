import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://creatorpiyush.github.io",
  base: "/raglite",
  integrations: [
    starlight({
      title: "RAGLite",
      description:
        "Semantic search, cited answers, an MCP server and agent tools over your documents, in TypeScript and Python.",
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/creatorpiyush/raglite",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/creatorpiyush/raglite/edit/main/docs/",
      },
      lastUpdated: true,
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Getting started", slug: "getting-started" },
            { label: "Choosing providers", slug: "providers" },
            { label: "Troubleshooting", slug: "troubleshooting" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Collections", slug: "guides/collections" },
            { label: "Citations", slug: "guides/citations" },
            { label: "Hybrid search", slug: "guides/hybrid-search" },
            { label: "MCP server", slug: "guides/mcp" },
            { label: "Agent tools", slug: "guides/agent-tools" },
            { label: "Streaming, progress and cancellation", slug: "guides/streaming" },
            { label: "Vector stores", slug: "guides/vector-stores" },
            { label: "REST API", slug: "guides/rest-api" },
            { label: "CLI", slug: "guides/cli" },
            { label: "How caching works", slug: "guides/caching" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Options and types", slug: "reference/options" },
            { label: "Changelog", slug: "reference/changelog" },
          ],
        },
      ],
    }),
  ],
});
