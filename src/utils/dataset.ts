import { readdir, readFile, writeFile } from "node:fs/promises";
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
    return await readFile(captionPath, "utf8");
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
  await writeFile(captionPath, formatTags(tags));
}

export async function saveCaption(
  captionPath: string,
  caption: string,
): Promise<void> {
  await writeFile(captionPath, caption.trim());
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
