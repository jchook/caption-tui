import { Box, Text, useInput } from "ink";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import type { CaptionMode, ImageEntry } from "../utils/dataset.js";
import {
  clampIndex,
  type NavGeometry,
  navStep,
  nextScrollTop,
} from "../utils/listViewport.js";

interface ImageListProps {
  entries: ImageEntry[];
  selectedIndex: number;
  // Must accept an updater. Ink dispatches every key in a stdin chunk
  // synchronously inside one React batch, so handlers that computed the next
  // index from the `selectedIndex` prop collapsed a whole burst of key repeats
  // into a single row of movement -- the reason holding a key crawled over SSH,
  // where a blocking frame write buffers the repeats into one chunk.
  onSelect: Dispatch<SetStateAction<number>>;
  onEdit: (index: number) => void;
  /** Shift-D: ask to delete the image at this index. */
  onRequestDelete?: (index: number) => void;
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
  onRequestDelete,
  maxVisible = 15,
  disabled = false,
  compact = false,
  mode = "tags",
}: ImageListProps) {
  const isNatural = mode === "natural";
  const total = entries.length;

  // Mirrors the newest selection even mid-batch, so a chunk like "jjj\r" opens
  // the image the last `j` landed on rather than the one three moves back.
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;

  // Every movement funnels through here. Ink dispatches all the keys in a stdin
  // chunk synchronously inside a single React batch, so anything that derived
  // the next index from the `selectedIndex` prop would read the value from
  // before the burst started. Stepping off the ref -- and advancing it in the
  // same breath -- keeps each key in a burst building on the one before it.
  const applyMove = useCallback(
    (step: (prev: number) => number) => {
      const next = clampIndex(step(selectedRef.current), total);
      selectedRef.current = next;
      onSelect(next);
    },
    [onSelect, total],
  );

  useInput(
    (input, key) => {
      if (disabled) return;

      // Paging is measured against the window, so it always lands on something
      // you were already looking at.
      const geometry: NavGeometry = {
        total,
        page: Math.max(1, maxVisible - 1),
        halfPage: Math.max(1, Math.floor(maxVisible / 2)),
      };

      // Arrows, Page keys, Home/End and a lone Enter arrive as their own event
      // with the flag set, and never carry more than one press.
      if (key.upArrow) return applyMove((i) => clampIndex(i - 1, total));
      if (key.downArrow) return applyMove((i) => clampIndex(i + 1, total));
      if (key.pageUp)
        return applyMove((i) => clampIndex(i - geometry.page, total));
      if (key.pageDown)
        return applyMove((i) => clampIndex(i + geometry.page, total));
      if (key.home) return applyMove(() => 0);
      if (key.end) return applyMove(() => clampIndex(total - 1, total));
      if (key.return) return onEdit(selectedRef.current);

      // Everything else is a run of characters. A single keypress is a run of
      // one; a held key on a laggy SSH link -- where a blocking frame write
      // stalls the event loop long enough for the repeats to pile into one
      // stdin chunk -- is a run of many, delivered as ONE event with no key
      // flags set. Comparing `input` to a single character dropped those bursts
      // entirely, which is what made scrolling crawl. Walk the run instead.
      // One quirk to normalize first: a lone Ctrl-<letter> is reported as
      // `{ctrl: true, input: "d"}`, while a burst of the same chord arrives as
      // the raw control bytes with no flags at all. Fold the former into the
      // latter so both take the same path.
      const run =
        key.ctrl && /^[a-z]$/i.test(input)
          ? String.fromCharCode(input.toLowerCase().charCodeAt(0) - 96)
          : input;

      let openAfterMove = false;
      let deleteAfterMove = false;
      let moves = 0;
      for (const ch of run) {
        if (navStep(0, ch, geometry) !== null) moves++;
        else if (ch === "\r" || ch === "\n") openAfterMove = true;
        else if (ch === "D") deleteAfterMove = true;
      }

      if (moves > 0) {
        applyMove((start) => {
          let index = start;
          for (const ch of run) {
            const next = navStep(index, ch, geometry);
            if (next !== null) index = next;
          }
          return index;
        });
      }
      // Enter and Shift-D can ride along at the end of a burst ("jjj\r") and
      // must act on whatever the moves before them selected -- applyMove
      // already advanced the ref synchronously.
      if (openAfterMove) onEdit(selectedRef.current);
      else if (deleteAfterMove) onRequestDelete?.(selectedRef.current);
    },
    { isActive: !disabled },
  );

  // Sticky window: only scrolls when the cursor nears an edge, so a single move
  // usually redraws two rows instead of the whole list.
  const [scrollTop, setScrollTop] = useState(0);
  const startIndex = nextScrollTop(scrollTop, selectedIndex, total, maxVisible);
  if (startIndex !== scrollTop) setScrollTop(startIndex);

  const visibleEntries = entries.slice(startIndex, startIndex + maxVisible);

  return (
    <Box flexDirection="column">
      {!compact && (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Images ({total})
          </Text>
          <Text dimColor>
            {" "}
            - ↑↓/jk move, PgUp/PgDn or Ctrl-D/U page, g/G ends, Enter edit, D
            delete
          </Text>
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

      {!compact && total > maxVisible && (
        <Box marginTop={1}>
          <Text dimColor>
            Showing {startIndex + 1}-{Math.min(startIndex + maxVisible, total)}{" "}
            of {total}
          </Text>
        </Box>
      )}
    </Box>
  );
}
