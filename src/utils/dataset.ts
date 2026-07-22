import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];

/**
 * Two ways to caption a dataset:
 * - "tags":    comma-separated keywords (the classic booru-style format)
 * - "natural": free-form prose describing the image
 */
export type CaptionMode = "tags" | "natural";

export interface ImageEntry {
  name: string;
  imagePath: string;
  captionPath: string;
  /** Parsed comma-separated tags (used in tag mode). */
  tags: string[];
  /** Raw caption text (used in natural-language mode). */
  caption: string;
}

export async function loadDataset(dirPath: string): Promise<ImageEntry[]> {
  const files = await readdir(dirPath);
  const imageFiles = files.filter((f) =>
    IMAGE_EXTENSIONS.includes(extname(f).toLowerCase()),
  );

  const entries: ImageEntry[] = [];

  for (const imageFile of imageFiles) {
    const name = basename(imageFile, extname(imageFile));
    const imagePath = join(dirPath, imageFile);
    const captionPath = join(dirPath, `${name}.txt`);

    // Read the file once and derive both views so the same dataset can be
    // opened in either mode without a reload.
    const content = await loadCaptionText(captionPath);
    entries.push({
      name,
      imagePath,
      captionPath,
      tags: parseTags(content),
      caption: content.trim(),
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadCaptionText(captionPath: string): Promise<string> {
  try {
    const file = Bun.file(captionPath);
    return await file.text();
  } catch {
    return "";
  }
}

export function parseTags(content: string): string[] {
  if (!content.trim()) return [];
  return content
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function formatTags(tags: string[]): string {
  return tags.join(", ");
}

export async function saveTags(
  captionPath: string,
  tags: string[],
): Promise<void> {
  await Bun.write(captionPath, formatTags(tags));
}

export async function saveCaption(
  captionPath: string,
  caption: string,
): Promise<void> {
  await Bun.write(captionPath, caption.trim());
}

export function collectAllTags(entries: ImageEntry[]): Set<string> {
  const allTags = new Set<string>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      allTags.add(tag.toLowerCase());
    }
  }
  return allTags;
}

export function getTagSuggestions(
  allTags: Set<string>,
  currentInput: string,
  existingTags: string[],
): string[] {
  const input = currentInput.toLowerCase().trim();
  if (!input) return [];

  const existingLower = new Set(existingTags.map((t) => t.toLowerCase()));

  return Array.from(allTags)
    .filter((tag) => tag.startsWith(input) && !existingLower.has(tag))
    .sort((a, b) => a.length - b.length)
    .slice(0, 10);
}

// --- Natural-language mode ---------------------------------------------------

/**
 * Common English function words that add no value as autocomplete targets.
 * We still let the user type them freely; we just never *suggest* them and
 * never learn them into the vocabulary.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "one",
  "onto",
  "or",
  "our",
  "ours",
  "out",
  "over",
  "own",
  "she",
  "so",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "up",
  "upon",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
]);

/** Matches a word: letters plus internal apostrophes/hyphens. */
const WORD_RE = /[a-zA-Z][a-zA-Z'-]*/g;

/** Shortest prefix worth offering a completion for. */
const MIN_SUGGESTABLE_LEN = 3;

/**
 * Build the autocomplete vocabulary from every caption in the dataset.
 * Words are lowercased; stopwords and very short words are excluded.
 */
export function collectVocabulary(entries: ImageEntry[]): Set<string> {
  const vocab = new Set<string>();
  for (const entry of entries) {
    addWordsToVocabulary(vocab, entry.caption);
  }
  return vocab;
}

/** Merge the words of a single caption into an existing vocabulary set. */
export function addWordsToVocabulary(
  vocab: Set<string>,
  caption: string,
): void {
  for (const match of caption.toLowerCase().matchAll(WORD_RE)) {
    const word = match[0];
    if (word.length >= MIN_SUGGESTABLE_LEN && !STOPWORDS.has(word)) {
      vocab.add(word);
    }
  }
}

/**
 * The word currently being typed: the run of word characters immediately
 * before the cursor. Returns "" when the cursor is not inside a word.
 */
export function currentWordAt(text: string, cursor: number): string {
  const before = text.slice(0, cursor);
  const match = before.match(/[a-zA-Z'-]*$/);
  return match ? match[0] : "";
}

/**
 * Prefix-match the in-progress word against the vocabulary. Returns [] for
 * empty/too-short prefixes so we don't flood suggestions on every keystroke.
 */
export function getWordSuggestions(
  vocab: Set<string>,
  currentWord: string,
  limit = 10,
): string[] {
  const input = currentWord.toLowerCase();
  if (input.length < MIN_SUGGESTABLE_LEN) return [];

  return Array.from(vocab)
    .filter((word) => word.startsWith(input) && word !== input)
    .sort((a, b) => a.length - b.length)
    .slice(0, limit);
}
