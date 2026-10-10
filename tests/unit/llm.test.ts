import { describe, expect, it, vi } from "vitest";

const generateText = vi.fn(async (_options: Record<string, unknown>) => ({
  text: "ok",
  usage: {},
  finishReason: "stop",
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));

const { createLLM } = await import("../../src/llm/factory.js");
const { generateAnswer } = await import("../../src/llm/answer.js");

describe("createLLM", () => {
  it("sends no temperature to Anthropic unless configured", async () => {
    // Claude 5 models reject non-default sampling values.
    expect((await createLLM({ provider: "anthropic", apiKey: "k" })).temperature).toBeUndefined();
    expect(
      (await createLLM({ provider: "anthropic", apiKey: "k", temperature: 0.3 })).temperature,
    ).toBe(0.3);
    expect((await createLLM({ provider: "openai", apiKey: "k" })).temperature).toBe(0);
  });
});

describe("generateAnswer", () => {
  it("passes maxTokens as the AI SDK's maxOutputTokens and omits an unset temperature", async () => {
    await generateAnswer({
      llm: { provider: "anthropic", apiKey: "k", maxTokens: 123 },
      question: "q",
      context: [],
    });
    const options = generateText.mock.calls[0]![0];
    expect(options["maxOutputTokens"]).toBe(123);
    expect(options).not.toHaveProperty("maxTokens");
    expect(options).not.toHaveProperty("temperature");
  });
});

describe("generateAnswer cancellation", () => {
  it("passes the signal to the AI SDK and throws AbortError when aborted", async () => {
    const controller = new AbortController();
    generateText.mockImplementationOnce(async (options: Record<string, unknown>) => {
      expect(options["abortSignal"]).toBe(controller.signal);
      controller.abort();
      throw new Error("request aborted");
    });
    await expect(
      generateAnswer({
        llm: { provider: "openai", apiKey: "k" },
        question: "q",
        context: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
