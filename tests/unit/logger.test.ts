import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/utils/logger.js";

describe("createLogger", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterEach(() => {
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  it("silent mode suppresses everything", () => {
    const logger = createLogger("silent");
    logger.info("info");
    logger.debug("debug");
    logger.warn("warn");
    logger.error("error");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("info mode emits info/warn/error but not debug", () => {
    const logger = createLogger("info");
    logger.info("i");
    logger.debug("d");
    logger.warn("w");
    logger.error("e");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toMatch(/\[raglite\] i/);
  });

  it("debug mode emits everything", () => {
    const logger = createLogger("debug");
    logger.debug("d");
    logger.info("i");
    expect(logSpy).toHaveBeenCalledTimes(2);
  });
});
