import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamText as honoStreamText } from "hono/streaming";
import { ZodError } from "zod";
import { PACKAGE_VERSION } from "../constants.js";
import type { Document } from "../core/document.js";
import { RagLiteError } from "../errors.js";
import type { LLMProviderConfig } from "../types.js";
import { AskRequestSchema, SearchRequestSchema } from "./schemas.js";

export interface ServeOptions {
  host?: string;
  port?: number;
  llm?: LLMProviderConfig;
  /**
   * Bearer token required in the `Authorization` header.
   * Strongly recommended when exposing the server beyond localhost.
   */
  bearerToken?: string;
  /**
   * If true, log every incoming request (default: false).
   */
  requestLogging?: boolean;
}

export interface ServerHandle {
  close: () => Promise<void>;
  url: string;
}

export async function createServer(
  document: Document,
  options: ServeOptions,
): Promise<ServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8085;
  const app = buildApp(document, options);

  return new Promise((resolvePromise, rejectPromise) => {
    try {
      const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
        const url = `http://${info.address}:${info.port}`;
        resolvePromise({
          url,
          close: () =>
            new Promise<void>((res, rej) => {
              server.close((err) => (err ? rej(err) : res()));
            }),
        });
      });
    } catch (err) {
      rejectPromise(err);
    }
  });
}

export function buildApp(document: Document, options: ServeOptions): Hono {
  const app = new Hono();

  if (options.requestLogging) {
    app.use("*", async (c, next) => {
      const start = Date.now();
      await next();
      // eslint-disable-next-line no-console
      console.log(
        `[raglite] ${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - start}ms)`,
      );
    });
  }

  if (options.bearerToken) {
    const expected = `Bearer ${options.bearerToken}`;
    app.use("*", async (c, next) => {
      if (c.req.path === "/health") return next();
      const header = c.req.header("authorization");
      if (header !== expected) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }
      await next();
    });
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof ZodError) {
      return c.json({ error: "ValidationError", details: err.flatten() }, 400);
    }
    if (err instanceof RagLiteError) {
      return c.json({ error: err.name, message: err.message }, 400);
    }
    // eslint-disable-next-line no-console
    console.error("[raglite] unhandled error", err);
    return c.json({ error: "InternalServerError" }, 500);
  });

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      version: PACKAGE_VERSION,
      chunks: document.chunkCount,
      namespace: document.storeNamespace,
    }),
  );

  app.get("/info", (c) => {
    const cfg = document.resolvedConfig;
    return c.json({
      version: PACKAGE_VERSION,
      chunkSize: cfg.chunkSize,
      overlap: cfg.overlap,
      topK: cfg.topK,
      embeddings: { provider: cfg.embeddings.provider, model: cfg.embeddings.model },
      llmProvider: (options.llm ?? cfg.llm)?.provider ?? null,
      chunks: document.chunkCount,
    });
  });

  app.post("/search", async (c) => {
    const body = SearchRequestSchema.parse(await c.req.json());
    const results = await document.search(body.query, {
      ...(body.topK !== undefined ? { topK: body.topK } : {}),
      ...(body.scoreThreshold !== undefined ? { scoreThreshold: body.scoreThreshold } : {}),
    });
    return c.json({ results });
  });

  const askProvider = options.llm;

  if (askProvider) {
    app.post("/ask", async (c) => {
      const body = AskRequestSchema.parse(await c.req.json());

      const askOptions: Parameters<Document["ask"]>[1] = { llm: askProvider };
      if (body.topK !== undefined) askOptions.topK = body.topK;
      if (body.scoreThreshold !== undefined) askOptions.scoreThreshold = body.scoreThreshold;
      if (body.includeCitations !== undefined) askOptions.includeCitations = body.includeCitations;

      if (body.stream) {
        return honoStreamText(c, async (stream) => {
          for await (const chunk of document.askStream(body.question, askOptions)) {
            await stream.write(chunk);
          }
        });
      }

      const answer = await document.ask(body.question, askOptions);
      return c.json(answer);
    });
  } else {
    app.post("/ask", (c) =>
      c.json({ error: "AskDisabled", message: "No LLM provider configured on the server." }, 503),
    );
  }

  return app;
}
