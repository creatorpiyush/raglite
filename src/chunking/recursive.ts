import { ChunkingError } from "../errors.js";
import { hasUnspacedText, isMark, isUnspacedChar } from "../text/scripts.js";
import { BaseChunker } from "./base.js";

/** A chunk and the units it covers, [start, end). */
export interface Span {
  text: string;
  start: number;
  end: number;
}

/** One chunking unit: a word, or a single character of an unspaced script. */
interface Unit {
  text: string;
  /** False when the unit continues the previous unit's word (no space between them). */
  spaced: boolean;
}

/**
 * Word-based recursive chunker with overlap.
 *
 * Words rather than characters produce chunks that align to natural
 * boundaries. Overlap keeps context across chunk edges.
 *
 * Scripts written without spaces (Chinese, Japanese, Thai, ...) have no word
 * boundaries to split on, so each of their characters counts as one unit.
 * Without this a whole unspaced document would be a single "word" and
 * therefore a single chunk of any length.
 */
export class RecursiveChunker extends BaseChunker {
  override split(text: string): string[] {
    return this.spans(text).map((span) => span.text);
  }

  /** Like split(), with each chunk's unit range, for locating it in the source. */
  spans(text: string): Span[] {
    if (!text.trim()) return [];
    if (this.overlap >= this.chunkSize) {
      throw new ChunkingError(
        `overlap (${this.overlap}) must be smaller than chunkSize (${this.chunkSize})`,
      );
    }

    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const units: Unit[] = hasUnspacedText(text)
      ? words.flatMap(wordUnits)
      : words.map((w) => ({ text: w, spaced: true }));
    if (units.length <= this.chunkSize) {
      return [{ text: render(units), start: 0, end: units.length }];
    }

    const step = this.chunkSize - this.overlap;
    const chunks: Span[] = [];

    for (let start = 0; start < units.length; start += step) {
      const end = start + this.chunkSize;
      const slice = units.slice(start, end);
      if (slice.length === 0) continue;
      chunks.push({ text: render(slice), start, end: start + slice.length });
      if (end >= units.length) break;
    }

    return chunks;
  }
}

/**
 * Units in text as the chunker counts them. Counts add up across text joined
 * with whitespace, so offsets of pages or lines can be summed.
 */
export function countUnits(text: string): number {
  let count = 0;
  for (const word of text.split(/\s+/)) {
    if (word) count += wordUnits(word).length;
  }
  return count;
}

/**
 * Splits a word into units: each unspaced-script character (with its
 * combining marks) is a unit, and every run of other characters is a unit.
 */
function wordUnits(word: string): Unit[] {
  const units: Unit[] = [];
  let run = "";
  const push = (text: string) => units.push({ text, spaced: units.length === 0 });

  for (const ch of word) {
    if (isMark(ch) && run === "" && units.length > 0) {
      units[units.length - 1]!.text += ch;
    } else if (isMark(ch)) {
      run += ch;
    } else if (isUnspacedChar(ch.codePointAt(0)!)) {
      if (run) push(run);
      run = "";
      push(ch);
    } else {
      run += ch;
    }
  }
  if (run) push(run);
  return units;
}

function render(units: Unit[]): string {
  let out = "";
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    if (i > 0 && unit.spaced) out += " ";
    out += unit.text;
  }
  return out;
}
