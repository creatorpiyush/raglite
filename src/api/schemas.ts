import { z } from "zod";

const RetrievalModeSchema = z.enum(["vector", "keyword", "hybrid"]);

export const SearchRequestSchema = z.object({
  query: z.string().min(1, "query is required"),
  topK: z.number().int().positive().max(50).optional(),
  scoreThreshold: z.number().min(-1).max(1).optional(),
  mode: RetrievalModeSchema.optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const AskRequestSchema = z.object({
  question: z.string().min(1, "question is required"),
  topK: z.number().int().positive().max(50).optional(),
  scoreThreshold: z.number().min(-1).max(1).optional(),
  mode: RetrievalModeSchema.optional(),
  includeCitations: z.boolean().optional(),
  stream: z.boolean().optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;
