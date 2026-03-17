import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Image, { TerminalInfoProvider } from "ink-picture";
import { ImageList } from "./components/ImageList.js";
import { CaptionEditor } from "./components/CaptionEditor.js";
import {
  loadDataset,
  saveTags,
  collectAllTags,
  type ImageEntry,
} from "./utils/dataset.js";

interface AppProps {
  datasetPath: string;
}

export function App({ datasetPath }: AppProps) {
  const { exit } = useApp();
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<Set<string>>(new Set());

  // Load dataset on mount
  useEffect(() => {
    loadDataset(datasetPath)
      .then((loaded) => {
        setEntries(loaded);
        setAllTags(collectAllTags(loaded));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [datasetPath]);

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

  return (
    <TerminalInfoProvider>
      <Box flexDirection="column" height="100%">
        {/* Image list */}
        <Box flexGrow={isEditing ? 0 : 1} flexDirection="column">
          <ImageList
            entries={entries}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onEdit={handleEdit}
            maxVisible={isEditing ? 3 : 20}
            disabled={isEditing}
            compact={isEditing}
          />
        </Box>

        {/* Image preview - rendered at top level */}
        {isEditing && entries[editingIndex] && (
          <Box height={40} width="100%">
            <Image src={entries[editingIndex]!.imagePath} />
          </Box>
        )}

        {/* Caption editor (shown when editing) */}
        {isEditing && entries[editingIndex] && (
          <CaptionEditor
            entry={entries[editingIndex]!}
            allTags={allTags}
            onSave={handleSave}
            onNext={handleNext}
            onPrev={handlePrev}
            onClose={handleClose}
          />
        )}
      </Box>
    </TerminalInfoProvider>
  );
}
