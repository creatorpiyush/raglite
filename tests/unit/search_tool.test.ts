import { describe, expect, it, vi } from "vitest";
import { searchTool } from "../../src/tools/search-tool.js";
import type { SearchResult } from "../../src/types.js";

const hit: SearchResult = {
  id: "a_000001",
  text: "Refunds take thirty days.",
  metadata: { source: "policy.pdf", chunk: 3, totalChunks: 9, page: 12, section: "Refunds" },
  score: 0.87654,
  distance: 0.12346,
};

describe("searchTool", () => {
  it("searches with the configured options and returns passages", async () => {
    const search = vi.fn(async () => [hit]);
    const t = searchTool({ search }, { topK: 2, mode: "hybrid" });

    const out = await t.execute(
      { query: "refund" },
      { toolCallId: "1", messages: [], context: {} },
    );

    expect(search).toHaveBeenCalledWith("refund", { topK: 2, mode: "hybrid" });
    expect(out).toEqual([
      {
        source: "policy.pdf",
        chunk: 3,
        page: 12,
        section: "Refunds",
        score: 0.8765,
        text: hit.text,
      },
    ]);
  });

  it("rejects an empty query", async () => {
    const t = searchTool({ search: async () => [] });
    const parsed = await (
      t.inputSchema as { safeParseAsync?: (v: unknown) => Promise<{ success: boolean }> }
    ).safeParseAsync?.({ query: "" });
    expect(parsed?.success).toBe(false);
  });
});

describe("searchTool in a generateText tool loop", () => {
  it("runs when the model calls it and feeds the passages back", async () => {
    const { generateText, stepCountIs } = await import("ai");
    const { MockLanguageModelV4 } = await import("ai/test");
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "searchDocs",
              input: '{"query":"refund"}',
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [{ type: "text", text: "Thirty days." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
      ],
    });
    const search = vi.fn(async () => [hit]);

    const result = await generateText({
      model,
      tools: { searchDocs: searchTool({ search }) },
      stopWhen: stepCountIs(2),
      prompt: "How long is the refund window?",
    });

    expect(search).toHaveBeenCalledWith("refund", {});
    expect(result.text).toBe("Thirty days.");
    // The second model call received the tool result.
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain("Refunds take thirty days.");
  });
});
