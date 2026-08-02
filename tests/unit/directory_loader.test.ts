import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DirectoryLoader } from "../../src/loaders/directory.js";

const TEST_DIR = resolve(process.cwd(), "tests/fixtures/temp_dir_test");

describe("DirectoryLoader", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "nested"), { recursive: true });

    writeFileSync(join(TEST_DIR, "doc1.md"), "# Title 1\nContent of document 1.");
    writeFileSync(join(TEST_DIR, "doc2.txt"), "Content of document 2.");
    writeFileSync(join(TEST_DIR, "nested/doc3.json"), JSON.stringify({ key: "value 3" }));
    writeFileSync(join(TEST_DIR, "unsupported.unknown"), "some raw content");
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("recursively scans directory and loads supported files", async () => {
    const loader = new DirectoryLoader(TEST_DIR);
    const result = await loader.loadFiles();

    expect(result.loaded.length).toBe(3);
    const loadedPaths = result.loaded.map((item) => item.filePath);
    expect(loadedPaths.some((p) => p.endsWith("doc1.md"))).toBe(true);
    expect(loadedPaths.some((p) => p.endsWith("doc2.txt"))).toBe(true);
    expect(loadedPaths.some((p) => p.endsWith("doc3.json"))).toBe(true);

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.filePath.endsWith("unsupported.unknown"))).toBe(true);
  });

  it("filters files by glob pattern", async () => {
    const loader = new DirectoryLoader(TEST_DIR, { glob: "*.md" });
    const result = await loader.loadFiles();

    expect(result.loaded.length).toBe(1);
    expect(result.loaded[0]?.filePath.endsWith("doc1.md")).toBe(true);
  });

  it("concatenates loaded files in load() method", async () => {
    const loader = new DirectoryLoader(TEST_DIR, { glob: "*.txt" });
    const text = await loader.load();

    expect(text).toContain("SOURCE:");
    expect(text).toContain("Content of document 2.");
  });
});
