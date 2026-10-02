/**
 * Script tables shared by the chunker and the keyword tokenizer.
 *
 * These are explicit code point ranges rather than `\p{Script=...}` so the
 * Python SDK can use the exact same table (Python's `re` and `unicodedata`
 * have no script property) and both SDKs split text identically.
 */

/** Scripts written without spaces between words: Thai, Lao, Myanmar, Khmer, Han, kana. */
const UNSPACED_RANGES: readonly (readonly [number, number])[] = [
  [0x0e00, 0x0eff], // Thai, Lao
  [0x1000, 0x109f], // Myanmar
  [0x1780, 0x17ff], // Khmer
  [0x2e80, 0x2fdf], // CJK radicals, Kangxi radicals
  [0x3005, 0x3007], // 々 〆 〇
  [0x3021, 0x3029], // Hangzhou numerals
  [0x3038, 0x303b],
  [0x3040, 0x30ff], // Hiragana, Katakana
  [0x31f0, 0x31ff], // Katakana phonetic extensions
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xff66, 0xff9f], // Halfwidth katakana
  [0x20000, 0x323af], // CJK extensions B-H, compatibility supplement
];

/** Hangul separates words with spaces, but its syllables still need bigrams for keyword search. */
const HANGUL_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x11ff],
  [0x3130, 0x318f],
  [0xa960, 0xa97f],
  [0xac00, 0xd7ff],
];

function inRanges(cp: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const [lo, hi] of ranges) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

/** True for a character of a script written without spaces between words. */
export function isUnspacedChar(cp: number): boolean {
  return inRanges(cp, UNSPACED_RANGES);
}

/** True for a character the keyword tokenizer indexes as character bigrams. */
export function isBigramChar(cp: number): boolean {
  return inRanges(cp, UNSPACED_RANGES) || inRanges(cp, HANGUL_RANGES);
}

const MARK = /^\p{M}$/u;

/** True for a combining mark (Unicode category M), which belongs to the character before it. */
export function isMark(ch: string): boolean {
  return MARK.test(ch);
}

/** True if `text` contains any character of a script written without spaces. */
export function hasUnspacedText(text: string): boolean {
  for (const ch of text) {
    if (isUnspacedChar(ch.codePointAt(0)!)) return true;
  }
  return false;
}
