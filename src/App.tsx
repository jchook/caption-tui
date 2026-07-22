import { Box, Text, useApp, useInput } from "ink";
import Image, { TerminalInfoProvider } from "ink-picture";
import { useCallback, useEffect, useState } from "react";
import { CaptionEditor } from "./components/CaptionEditor.js";
import { ImageList } from "./components/ImageList.js";
import { NaturalCaptionEditor } from "./components/NaturalCaptionEditor.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import {
  type CaptionMode,
  collectAllTags,
  type ImageEntry,
  loadDataset,
  saveCaption,
  saveTags,
} from "./utils/dataset.js";

// Rows reserved (outside the scrollable image list) for the list header and
// the "Showing X-Y of Z" footer when browsing.
const LIST_CHROME_ROWS = 4;
// Fixed rows for the compact list shown above the editor while captioning.
const COMPACT_LIST_ROWS = 3;
// Minimum rows kept for the caption editor so the preview height stays a pure
// function of the terminal size (and never shifts as you type).
const EDITOR_MIN_ROWS = 7;

interface AppProps {
  datasetPath: string;
  mode?: CaptionMode;
}

export function App({ datasetPath, mode = "tags" }: AppProps) {
  const isNatural = mode === "natural";
  const { exit } = useApp();
  const { rows, columns } = useTerminalSize();
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tag mode autocompletes against known tags. Natural mode has no autocomplete.
  const [allTags, setAllTags] = useState<Set<string>>(new Set());
  // Bumped on every editor keystroke. This forces <Image> (which lives here in
  // App, not in CaptionEditor) to re-render each time Ink repaints the frame,
  // so ink-picture's placement effect re-draws the kitty/sixel graphic after
  // Ink overwrites those cells. Without it the image vanishes as you type.
  const [, setRepaintTick] = useState(0);
  const requestRepaint = useCallback(() => {
    setRepaintTick((t) => (t + 1) % 1_000_000);
  }, []);

  // Load dataset on mount
  useEffect(() => {
    loadDataset(datasetPath)
      .then((loaded) => {
        setEntries(loaded);
        if (!isNatural) {
          setAllTags(collectAllTags(loaded));
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [datasetPath, isNatural]);

  // Handle quit
  useInput((input) => {
    if (input === "q" && editingIndex === null) {
      exit();
    }
  });

  const handleEdit = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return;
      setEditingIndex(index);
    },
    [entries],
  );

  const handleSave = useCallback(
    async (tags: string[]) => {
      if (editingIndex === null) return;

      const entry = entries[editingIndex];
      if (!entry) return;
      await saveTags(entry.captionPath, tags);

      // Update local state
      const idx = editingIndex;
      setEntries((prev) => {
        const updated = [...prev];
        updated[idx] = { ...entry, tags };
        return updated;
      });

      // Update allTags
      setAllTags((prev) => {
        const newSet = new Set(prev);
        for (const tag of tags) {
          newSet.add(tag.toLowerCase());
        }
        return newSet;
      });
    },
    [editingIndex, entries],
  );

  const handleSaveCaption = useCallback(
    async (caption: string) => {
      if (editingIndex === null) return;

      const entry = entries[editingIndex];
      if (!entry) return;
      const trimmed = caption.trim();
      await saveCaption(entry.captionPath, trimmed);

      const idx = editingIndex;
      setEntries((prev) => {
        const updated = [...prev];
        updated[idx] = { ...entry, caption: trimmed };
        return updated;
      });
    },
    [editingIndex, entries],
  );

  const handleNext = useCallback(() => {
    if (editingIndex === null) return;

    const nextIndex = editingIndex + 1;
    const nextEntry = entries[nextIndex];
    if (nextEntry) {
      setSelectedIndex(nextIndex);
      setEditingIndex(nextIndex);
    } else {
      setEditingIndex(null);
    }
  }, [editingIndex, entries]);

  const handlePrev = useCallback(() => {
    if (editingIndex === null) return;

    const prevIndex = editingIndex - 1;
    const prevEntry = entries[prevIndex];
    if (prevEntry) {
      setSelectedIndex(prevIndex);
      setEditingIndex(prevIndex);
    }
  }, [editingIndex, entries]);

  const handleClose = useCallback(() => {
    setEditingIndex(null);
  }, []);

  if (loading) {
    return (
      <Box>
        <Text>Loading dataset from {datasetPath}...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  if (entries.length === 0) {
    return (
      <Box>
        <Text color="yellow">No images found in {datasetPath}</Text>
      </Box>
    );
  }

  const isEditing = editingIndex !== null;

  // Keep the whole app within the terminal so Ink's frame math stays aligned
  // (an overflowing frame is what garbles the list while scrolling).
  const listMaxVisible = Math.max(1, rows - LIST_CHROME_ROWS);
  // Preview height depends only on the terminal size, so the image's position
  // never shifts while typing -> ink-picture doesn't re-transmit it (no flash).
  const previewHeight = Math.max(5, rows - COMPACT_LIST_ROWS - EDITOR_MIN_ROWS);

  return (
    <TerminalInfoProvider>
      <Box
        flexDirection="column"
        width={columns}
        height={rows}
        overflow="hidden"
      >
        {/* Image list */}
        <Box flexShrink={0} flexDirection="column">
          <ImageList
            entries={entries}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onEdit={handleEdit}
            maxVisible={isEditing ? COMPACT_LIST_ROWS : listMaxVisible}
            disabled={isEditing}
            compact={isEditing}
            mode={mode}
          />
        </Box>

        {/* Image preview - rendered at top level */}
        {isEditing && entries[editingIndex] && (
          <Box height={previewHeight} flexShrink={0} width="100%">
            <Image src={entries[editingIndex]?.imagePath ?? ""} />
          </Box>
        )}

        {/* Caption editor (shown when editing) */}
        {isEditing && entries[editingIndex] && (
          <Box flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
            {isNatural ? (
              <NaturalCaptionEditor
                entry={entries[editingIndex]}
                onSave={handleSaveCaption}
                onNext={handleNext}
                onPrev={handlePrev}
                onClose={handleClose}
                onActivity={requestRepaint}
              />
            ) : (
              <CaptionEditor
                entry={entries[editingIndex]}
                allTags={allTags}
                onSave={handleSave}
                onNext={handleNext}
                onPrev={handlePrev}
                onClose={handleClose}
                onActivity={requestRepaint}
              />
            )}
          </Box>
        )}
      </Box>
    </TerminalInfoProvider>
  );
}
