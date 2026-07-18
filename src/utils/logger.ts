export type LogLevel = "silent" | "info" | "debug";

export interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export function createLogger(level: LogLevel = "info"): Logger {
  const shouldLog = (target: LogLevel): boolean => {
    if (level === "silent") return false;
    if (level === "info") return target !== "debug";
    return true;
  };

  return {
    info: (message, ...args) => {
      if (shouldLog("info")) console.log(`[raglite] ${message}`, ...args);
    },
    debug: (message, ...args) => {
      if (shouldLog("debug")) console.log(`[raglite:debug] ${message}`, ...args);
    },
    warn: (message, ...args) => {
      if (level !== "silent") console.warn(`[raglite] ${message}`, ...args);
    },
    error: (message, ...args) => {
      if (level !== "silent") console.error(`[raglite] ${message}`, ...args);
    },
  };
}
