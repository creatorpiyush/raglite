import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../../src/llm/prompt.js";
import type { SearchResult } from "../../src/types.js";

const fixtureContext: SearchResult[] = [
  {
    id: "doc_1",
    text: "The refund period is 30 days.",
    metadata: { source: "policy.txt", chunk: 1, totalChunks: 2 },
    score: 0.9,
    distance: 0.1,
  },
  {
    id: "doc_2",
    text: "Shipping is 3-5 business days.",
    metadata: { source: "policy.txt", chunk: 2, totalChunks: 2 },
    score: 0.7,
    distance: 0.3,
  },
];

describe("buildSystemPrompt", () => {
  it("includes the strict-context instruction and 'not found' fallback", () => {
    const sys = buildSystemPrompt();
    expect(sys).toMatch(/strictly from the provided context/);
    expect(sys).toMatch(/I could not find the answer/);
  });

  it("appends system hint when provided", () => {
    const sys = buildSystemPrompt({ systemHint: "Respond in French." });
    expect(sys).toMatch(/Respond in French\./);
  });
});

describe("buildUserPrompt", () => {
  it("includes numbered context passages and the question", () => {
    const prompt = buildUserPrompt("How long for refund?", fixtureContext);
    expect(prompt).toMatch(/\[1\]/);
    expect(prompt).toMatch(/\[2\]/);
    expect(prompt).toContain("The refund period is 30 days.");
    expect(prompt).toContain("Shipping is 3-5 business days.");
    expect(prompt).toContain("How long for refund?");
  });

  it("adds citation instruction by default", () => {
    const prompt = buildUserPrompt("Q", fixtureContext);
    expect(prompt).toMatch(/Cite the passages/);
  });

  it("omits citation instruction when includeCitations=false", () => {
    const prompt = buildUserPrompt("Q", fixtureContext, { includeCitations: false });
    expect(prompt).not.toMatch(/Cite the passages/);
  });

  it("includes source/chunk in citation tags by default", () => {
    const prompt = buildUserPrompt("Q", fixtureContext);
    expect(prompt).toMatch(/policy\.txt/);
    expect(prompt).toMatch(/#1/);
    expect(prompt).toMatch(/#2/);
  });
});
