import React from "react";
import { Box, Text, useInput } from "ink";
import type { ImageEntry } from "../utils/dataset.js";

interface ImageListProps {
  entries: ImageEntry[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onEdit: (index: number) => void;
  maxVisible?: number;
  disabled?: boolean;
  compact?: boolean;
}

function getTagColor(count: number): string {
  if (count === 0) return "red";
  if (count <= 3) return "yellow";
  return "green";
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

export function ImageList({
  entries,
  selectedIndex,
  onSelect,
  onEdit,
  maxVisible = 15,
  disabled = false,
  compact = false,
}: ImageListProps) {
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
        const tagCount = entry.tags.length;
        const tagColor = getTagColor(tagCount);
        const tagPreview =
          entry.tags.length > 0 ? entry.tags.join(", ") : "(no tags)";

        return (
          <Box key={entry.name}>
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
              color={tagColor}
              inverse={isSelected}
              dimColor={!isSelected && compact}
            >
              [{tagCount.toString().padStart(2)}]
            </Text>
            <Text dimColor={!isSelected} inverse={isSelected}>
              {" "}
              {truncate(tagPreview, 60)}
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
