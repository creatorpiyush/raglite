import type { Span } from "./recursive.js";
import { countUnits } from "./recursive.js";

/** Where a chunk came from, for citations. */
export interface ChunkLocation {
  /** First page of the chunk (1-based), for paged sources such as PDF. */
  page?: number;
  /** Last page, when the chunk crosses a page break. */
  pageEnd?: number;
  /** Markdown heading path, e.g. "Policies > Refunds". */
  section?: string;
}

export interface SourceLayout {
  /** Unit offset at which each page starts. */
  pageStarts?: number[];
  /** Unit offset and heading path of each markdown heading, in order. */
  headings?: { start: number; section: string }[];
}

/** Page start offsets for text that is the pages joined with whitespace. */
export function pageStarts(pages: string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const page of pages) {
    starts.push(offset);
    offset += countUnits(page);
  }
  return starts;
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;

/** ATX headings outside fenced code blocks, each with its full heading path. */
export function markdownHeadings(text: string): { start: number; section: string }[] {
  const headings: { start: number; section: string }[] = [];
  // Open headings, outermost first; a heading closes those at its level or deeper.
  const path: { level: number; title: string }[] = [];
  let offset = 0;
  let fence: string | null = null;
  for (const line of text.split(/\r\n|\n|\r/)) {
    const marker = FENCE.exec(line)?.[1];
    if (marker && (fence === null || fence === marker)) {
      fence = fence === null ? marker : null;
    } else if (fence === null) {
      const match = HEADING.exec(line);
      if (match) {
        const level = match[1]!.length;
        while (path.length > 0 && path[path.length - 1]!.level >= level) path.pop();
        path.push({ level, title: match[2]!.trim() });
        headings.push({ start: offset, section: path.map((h) => h.title).join(" > ") });
      }
    }
    offset += countUnits(line);
  }
  return headings;
}

/**
 * Page range and section of a chunk covering units [start, end). The section
 * is the heading in effect where the chunk starts, or else the first heading
 * inside the chunk.
 */
export function chunkLocation(layout: SourceLayout, span: Span): ChunkLocation {
  const location: ChunkLocation = {};
  const starts = layout.pageStarts;
  if (starts && starts.length > 0) {
    const page = lastAtOrBefore(starts, span.start) + 1;
    const pageEnd = lastAtOrBefore(starts, span.end - 1) + 1;
    location.page = page;
    if (pageEnd > page) location.pageEnd = pageEnd;
  }
  const headings = layout.headings;
  if (headings && headings.length > 0) {
    const i = lastAtOrBefore(
      headings.map((h) => h.start),
      span.start,
    );
    const heading = i >= 0 ? headings[i] : headings.find((h) => h.start < span.end);
    if (heading) location.section = heading.section;
  }
  return location;
}

/** Index of the last value <= target in an ascending array, or -1. */
function lastAtOrBefore(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]! <= target) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
