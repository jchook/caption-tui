import { Box, Text, useInput } from "ink";
import type { CaptionMode, ImageEntry } from "../utils/dataset.js";

interface ImageListProps {
  entries: ImageEntry[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onEdit: (index: number) => void;
  maxVisible?: number;
  disabled?: boolean;
  compact?: boolean;
  mode?: CaptionMode;
}

function getCountColor(count: number): string {
  if (count === 0) return "red";
  if (count <= 3) return "yellow";
  return "green";
}

function wordCount(caption: string): number {
  const trimmed = caption.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}

export function ImageList({
  entries,
  selectedIndex,
  onSelect,
  onEdit,
  maxVisible = 15,
  disabled = false,
  compact = false,
  mode = "tags",
}: ImageListProps) {
  const isNatural = mode === "natural";
  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.upArrow || input === "k") {
        onSelect(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow || input === "j") {
        onSelect(Math.min(entries.length - 1, selectedIndex + 1));
      } else if (key.return) {
        onEdit(selectedIndex);
      }
    },
    { isActive: !disabled },
  );

  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(maxVisible / 2),
      entries.length - maxVisible,
    ),
  );
  const visibleEntries = entries.slice(startIndex, startIndex + maxVisible);

  return (
    <Box flexDirection="column">
      {!compact && (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Images ({entries.length})
          </Text>
          <Text dimColor> - Use ↑↓/jk to navigate, Enter to edit</Text>
        </Box>
      )}

      {visibleEntries.map((entry, i) => {
        const actualIndex = startIndex + i;
        const isSelected = actualIndex === selectedIndex;
        const count = isNatural ? wordCount(entry.caption) : entry.tags.length;
        const countColor = getCountColor(count);
        const emptyLabel = isNatural ? "(no caption)" : "(no tags)";
        const preview = isNatural
          ? entry.caption || emptyLabel
          : entry.tags.length > 0
            ? entry.tags.join(", ")
            : emptyLabel;

        return (
          <Box key={entry.imagePath}>
            <Text inverse={isSelected} dimColor={!isSelected && compact}>
              {isSelected ? "▸ " : "  "}
            </Text>
            <Text
              inverse={isSelected}
              bold={isSelected}
              dimColor={!isSelected && compact}
            >
              {entry.name.padEnd(30)}
            </Text>
            <Text
              color={countColor}
              inverse={isSelected}
              dimColor={!isSelected && compact}
            >
              [{count.toString().padStart(2)}]
            </Text>
            <Text dimColor={!isSelected} inverse={isSelected}>
              {" "}
              {truncate(preview, 60)}
            </Text>
          </Box>
        );
      })}

      {!compact && entries.length > maxVisible && (
        <Box marginTop={1}>
          <Text dimColor>
            Showing {startIndex + 1}-
            {Math.min(startIndex + maxVisible, entries.length)} of{" "}
            {entries.length}
          </Text>
        </Box>
      )}
    </Box>
  );
}
