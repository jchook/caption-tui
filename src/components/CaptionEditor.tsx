import { Box, Text, useInput } from "ink";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ImageEntry } from "../utils/dataset.js";
import { getTagSuggestions } from "../utils/dataset.js";

interface CaptionEditorProps {
  entry: ImageEntry;
  allTags: Set<string>;
  onSave: (tags: string[]) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

// The in-progress tag being typed, plus the cursor within it.
interface Draft {
  value: string;
  cursor: number;
}

const EMPTY_DRAFT: Draft = { value: "", cursor: 0 };

export function CaptionEditor({
  entry,
  allTags,
  onSave,
  onNext,
  onPrev,
  onClose,
}: CaptionEditorProps) {
  const [tags, setTags] = useState<string[]>(entry.tags);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  // Mirror the latest committed values so handlers that read them (save,
  // accept-tag) never use a stale closure mid-keystroke-batch. Ink can fire the
  // input handler several times before React commits a re-render.
  const tagsRef = useRef(tags);
  const draftRef = useRef(draft);
  tagsRef.current = tags;
  draftRef.current = draft;

  // Updates build on the ref, which advances synchronously, rather than on the
  // value captured when this render ran. A single input event can drive several
  // updates in a row (see the run handling below), and only the first of those
  // would see React's newest state.
  const updateDraft = useCallback((fn: (prev: Draft) => Draft) => {
    const next = fn(draftRef.current);
    draftRef.current = next;
    setDraft(next);
  }, []);
  const setTagsSynced = useCallback((next: string[]) => {
    tagsRef.current = next;
    setTags(next);
  }, []);

  // Reset state when entry changes
  useEffect(() => {
    tagsRef.current = entry.tags;
    draftRef.current = EMPTY_DRAFT;
    setTags(entry.tags);
    setDraft(EMPTY_DRAFT);
    setSelectedSuggestion(0);
  }, [entry]);

  const currentInput = draft.value;
  const suggestions = getTagSuggestions(allTags, currentInput, tags);
  const topSuggestion = suggestions[0] || "";
  const ghostText =
    topSuggestion && currentInput
      ? topSuggestion.slice(currentInput.length)
      : "";

  const getCurrentTags = useCallback(() => {
    const trimmed = draftRef.current.value.trim();
    return trimmed ? [...tagsRef.current, trimmed] : tagsRef.current;
  }, []);

  const saveAndNext = useCallback(() => {
    onSave(getCurrentTags());
    onNext();
  }, [getCurrentTags, onSave, onNext]);

  const saveAndPrev = useCallback(() => {
    onSave(getCurrentTags());
    onPrev();
  }, [getCurrentTags, onSave, onPrev]);

  const acceptSuggestion = useCallback(() => {
    if (suggestions.length > 0) {
      const suggestion =
        suggestions[selectedSuggestion] ?? suggestions[0] ?? "";
      setTagsSynced([...tagsRef.current, suggestion]);
      updateDraft(() => EMPTY_DRAFT);
      setSelectedSuggestion(0);
    }
  }, [suggestions, selectedSuggestion, setTagsSynced, updateDraft]);

  const addCurrentTag = useCallback(() => {
    const trimmed = draftRef.current.value.trim();
    if (
      trimmed &&
      !tagsRef.current
        .map((t) => t.toLowerCase())
        .includes(trimmed.toLowerCase())
    ) {
      setTagsSynced([...tagsRef.current, trimmed]);
      updateDraft(() => EMPTY_DRAFT);
      setSelectedSuggestion(0);
    }
  }, [setTagsSynced, updateDraft]);

  // Enter arriving inside a run of characters. It can't reuse acceptSuggestion:
  // that reads the suggestion list this render computed, which predates the
  // text typed earlier in the very same run. Recompute against the live draft.
  const commitDraftFromRun = useCallback(() => {
    const value = draftRef.current.value.trim();
    if (!value) return;
    const suggestion = getTagSuggestions(allTags, value, tagsRef.current)[0];
    if (suggestion) {
      setTagsSynced([...tagsRef.current, suggestion]);
      updateDraft(() => EMPTY_DRAFT);
      return;
    }
    addCurrentTag();
  }, [allTags, setTagsSynced, updateDraft, addCurrentTag]);

  const removeLastTag = useCallback(() => {
    if (draftRef.current.value === "" && tagsRef.current.length > 0) {
      setTagsSynced(tagsRef.current.slice(0, -1));
    }
  }, [setTagsSynced]);

  useInput((input, key) => {
    if (key.escape) {
      onSave(getCurrentTags());
      onClose();
      return;
    }

    if (key.return || key.tab) {
      if (draftRef.current.value.trim()) {
        // Accept suggestion if available, otherwise add current input as tag
        if (suggestions.length > 0) {
          acceptSuggestion();
        } else {
          addCurrentTag();
        }
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (draftRef.current.cursor > 0) {
        updateDraft((d) => ({
          value: d.value.slice(0, d.cursor - 1) + d.value.slice(d.cursor),
          cursor: d.cursor - 1,
        }));
      } else {
        removeLastTag();
      }
      setSelectedSuggestion(0);
      return;
    }

    if (key.upArrow) {
      if (suggestions.length > 0 && draftRef.current.value) {
        setSelectedSuggestion((s) => Math.max(0, s - 1));
      } else {
        saveAndPrev();
      }
      return;
    }

    if (key.downArrow) {
      if (suggestions.length > 0 && draftRef.current.value) {
        setSelectedSuggestion((s) => Math.min(suggestions.length - 1, s + 1));
      } else {
        saveAndNext();
      }
      return;
    }

    if (key.leftArrow) {
      updateDraft((d) => ({ ...d, cursor: Math.max(0, d.cursor - 1) }));
      return;
    }

    if (key.rightArrow) {
      // Right arrow can also accept ghost text
      const d = draftRef.current;
      if (d.cursor === d.value.length && ghostText) {
        acceptSuggestion();
      } else {
        updateDraft((prev) => ({
          ...prev,
          cursor: Math.min(prev.value.length, prev.cursor + 1),
        }));
      }
      return;
    }

    // Regular character input. Ink hands over a whole run of characters as ONE
    // event -- its paste path, which fast typing also lands on once a laggy
    // link stalls the event loop -- so the run carries its own separators:
    // "red,blue\r" used to become the single tag "red,blue". Walk the run and
    // give each separator the meaning it would have had on its own.
    if (input && !key.ctrl && !key.meta) {
      for (const part of input.split(/([,\r\n])/)) {
        if (part === ",") {
          addCurrentTag();
        } else if (part === "\r" || part === "\n") {
          commitDraftFromRun();
        } else if (part) {
          updateDraft((d) => ({
            value: d.value.slice(0, d.cursor) + part + d.value.slice(d.cursor),
            cursor: d.cursor + part.length,
          }));
        }
      }
      setSelectedSuggestion(0);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {entry.name}
        </Text>
        <Text dimColor> - Enter/Tab: add, ↑↓: nav, Esc: close</Text>
      </Box>

      <Box flexWrap="wrap">
        <Text dimColor>Tags: </Text>
        {tags.map((tag) => (
          <Fragment key={tag}>
            <Text color="green">{tag}</Text>
            <Text dimColor>, </Text>
          </Fragment>
        ))}
        <Text>{currentInput}</Text>
        <Text dimColor>{ghostText}</Text>
        <Text inverse> </Text>
      </Box>

      {suggestions.length > 0 && currentInput && (
        <Box marginTop={1}>
          <Text dimColor>Suggestions: </Text>
          {suggestions.slice(0, 8).map((suggestion, i) => (
            <Fragment key={suggestion}>
              <Text
                inverse={i === selectedSuggestion}
                color={i === selectedSuggestion ? "cyan" : undefined}
              >
                {suggestion}
              </Text>
              <Text dimColor> </Text>
            </Fragment>
          ))}
        </Box>
      )}
    </Box>
  );
}
