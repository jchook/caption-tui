import { readdir } from "node:fs/promises";
import { join, basename, extname } from "node:path";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];

export interface ImageEntry {
  name: string;
  imagePath: string;
  captionPath: string;
  tags: string[];
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

    const tags = await loadTags(captionPath);
    entries.push({ name, imagePath, captionPath, tags });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadTags(captionPath: string): Promise<string[]> {
  try {
    const file = Bun.file(captionPath);
    const content = await file.text();
    return parseTags(content);
  } catch {
    return [];
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
