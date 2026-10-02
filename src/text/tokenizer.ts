import { isBigramChar, isMark } from "./scripts.js";

/**
 * Name of the keyword tokenizer, recorded with every keyword index. Change it
 * whenever `tokenize` output changes, so existing keyword indexes are rebuilt.
 */
export const TOKENIZER_NAME = "raglite-v1";

/** Invisible characters removed before tokenizing: soft hyphen, ZWNJ, ZWJ, word joiner. */
// biome-ignore lint/complexity/useRegexLiterals: tooling rewrote the literal's escapes as invisible characters
const IGNORED = new RegExp("[\\u00ad\\u200c\\u200d\\u2060]", "g");
const WORD_CHAR = /^[\p{L}\p{N}\p{M}]$/u;
const JOINERS = new Set(["_", "-", "."]);

type Kind = "bigram" | "word" | "joiner" | "other";

/**
 * Splits text into keyword search terms. Must produce exactly the same terms
 * as the Python SDK; the shared fixtures in tests/fixtures/shared check this.
 *
 * 1. NFKC normalisation, then lowercase.
 * 2. Runs of letters, digits and combining marks are words. `_`, `-` and `.`
 *    between word characters join them into one term (`gpt-4.1`, `err_42`),
 *    and the joined parts are emitted as terms too.
 * 3. Han, kana, Hangul, Thai, Lao, Khmer and Myanmar runs are emitted as
 *    overlapping character bigrams, or a unigram for a single character.
 *    This needs no dictionary and behaves the same in both SDKs.
 */
export function tokenize(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase().replace(IGNORED, "");
  const tokens: string[] = [];

  let compound = "";
  let part = "";
  let parts: string[] = [];
  let joiner = "";
  let bigramRun: string[] = [];

  const endWord = () => {
    if (compound) {
      parts.push(part);
      tokens.push(compound);
      if (parts.length > 1) tokens.push(...parts);
    }
    compound = "";
    part = "";
    parts = [];
    joiner = "";
  };
  const endBigramRun = () => {
    if (bigramRun.length === 1) {
      tokens.push(bigramRun[0]!);
    } else {
      for (let i = 0; i + 1 < bigramRun.length; i++) {
        tokens.push(bigramRun[i]! + bigramRun[i + 1]!);
      }
    }
    bigramRun = [];
  };

  for (const [cluster, kind] of clusters(normalized)) {
    switch (kind) {
      case "bigram":
        endWord();
        bigramRun.push(cluster);
        break;
      case "word":
        endBigramRun();
        if (joiner) {
          parts.push(part);
          part = "";
          compound += joiner;
          joiner = "";
        }
        part += cluster;
        compound += cluster;
        break;
      case "joiner":
        endBigramRun();
        if (compound && !joiner) {
          joiner = cluster;
        } else {
          endWord();
        }
        break;
      default:
        endWord();
        endBigramRun();
    }
  }
  endWord();
  endBigramRun();
  return tokens;
}

/** Groups each character with the combining marks after it and classifies the group. */
function* clusters(text: string): Generator<[string, Kind]> {
  let current = "";
  let kind: Kind = "other";
  for (const ch of text) {
    if (current && isMark(ch)) {
      current += ch;
      continue;
    }
    if (current) yield [current, kind];
    current = ch;
    kind = classify(ch);
  }
  if (current) yield [current, kind];
}

function classify(ch: string): Kind {
  if (WORD_CHAR.test(ch)) {
    return isBigramChar(ch.codePointAt(0)!) ? "bigram" : "word";
  }
  return JOINERS.has(ch) ? "joiner" : "other";
}
