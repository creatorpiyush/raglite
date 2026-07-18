import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashFile, hashString, namespaceFromPath } from "../../src/utils/hash.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("hello")).toBe(hashString("hello"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashString("hello")).not.toBe(hashString("Hello"));
  });

  it("returns 64 hex chars (sha256)", () => {
    const h = hashString("x");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("namespaceFromPath", () => {
  it("returns a short, filesystem-safe id", () => {
    const ns = namespaceFromPath("/a/b/c.pdf");
    expect(ns).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs for different absolute paths", () => {
    expect(namespaceFromPath("/a/x")).not.toBe(namespaceFromPath("/a/y"));
  });
});

describe("hashFile", () => {
  let ws: TempWorkspace;
  beforeEach(() => {
    ws = makeTempWorkspace();
  });
  afterEach(() => ws.cleanup());

  it("hashes file contents (not the path)", async () => {
    const a = ws.file("a.txt", "hello world");
    const b = ws.file("b.txt", "hello world");
    expect(await hashFile(a)).toBe(await hashFile(b));
  });

  it("changes when content changes", async () => {
    const p = ws.file("f.txt", "one");
    const first = await hashFile(p);
    writeFileSync(p, "two", "utf-8");
    const second = await hashFile(p);
    expect(first).not.toBe(second);
  });
});
