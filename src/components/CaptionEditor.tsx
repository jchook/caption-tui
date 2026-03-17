import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
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

export function CaptionEditor({
  entry,
  allTags,
  onSave,
  onNext,
  onPrev,
  onClose,
}: CaptionEditorProps) {
  const [tags, setTags] = useState<string[]>(entry.tags);
  const [currentInput, setCurrentInput] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Reset state when entry changes
  useEffect(() => {
    setTags(entry.tags);
    setCurrentInput("");
    setCursorPosition(0);
    setSelectedSuggestion(0);
  }, [entry.name]);

  const suggestions = getTagSuggestions(allTags, currentInput, tags);
  const topSuggestion = suggestions[0] || "";
  const ghostText =
    topSuggestion && currentInput
      ? topSuggestion.slice(currentInput.length)
      : "";

  const getCurrentTags = useCallback(() => {
    return currentInput.trim() ? [...tags, currentInput.trim()] : tags;
  }, [tags, currentInput]);

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
      const suggestion = suggestions[selectedSuggestion] ?? suggestions[0]!;
      setTags([...tags, suggestion]);
      setCurrentInput("");
      setCursorPosition(0);
      setSelectedSuggestion(0);
    }
  }, [suggestions, selectedSuggestion, tags]);

  const addCurrentTag = useCallback(() => {
    const trimmed = currentInput.trim();
    if (
      trimmed &&
      !tags.map((t) => t.toLowerCase()).includes(trimmed.toLowerCase())
    ) {
      setTags([...tags, trimmed]);
      setCurrentInput("");
      setCursorPosition(0);
      setSelectedSuggestion(0);
    }
  }, [currentInput, tags]);

  const removeLastTag = useCallback(() => {
    if (currentInput === "" && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  }, [currentInput, tags]);

  useInput((input, key) => {
    if (key.escape) {
      // Save current state and close
      const finalTags = currentInput.trim()
        ? [...tags, currentInput.trim()]
        : tags;
      onSave(finalTags);
      onClose();
      return;
    }

    if (key.return || key.tab) {
      if (currentInput.trim()) {
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
      if (cursorPosition > 0) {
        setCurrentInput(
          currentInput.slice(0, cursorPosition - 1) +
            currentInput.slice(cursorPosition),
        );
        setCursorPosition(cursorPosition - 1);
      } else {
        removeLastTag();
      }
      setSelectedSuggestion(0);
      return;
    }

    if (key.upArrow) {
      if (suggestions.length > 0 && currentInput) {
        setSelectedSuggestion(Math.max(0, selectedSuggestion - 1));
      } else {
        saveAndPrev();
      }
      return;
    }

    if (key.downArrow) {
      if (suggestions.length > 0 && currentInput) {
        setSelectedSuggestion(
          Math.min(suggestions.length - 1, selectedSuggestion + 1),
        );
      } else {
        saveAndNext();
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
      return;
    }

    if (key.rightArrow) {
      // Right arrow can also accept ghost text
      if (cursorPosition === currentInput.length && ghostText) {
        acceptSuggestion();
      } else {
        setCursorPosition(Math.min(currentInput.length, cursorPosition + 1));
      }
      return;
    }

    // Handle comma as tag separator
    if (input === ",") {
      addCurrentTag();
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setCurrentInput(
        currentInput.slice(0, cursorPosition) +
          input +
          currentInput.slice(cursorPosition),
      );
      setCursorPosition(cursorPosition + input.length);
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
        {tags.map((tag, i) => (
          <React.Fragment key={`tag-${i}-${tag}`}>
            <Text color="green">{tag}</Text>
            <Text dimColor>, </Text>
          </React.Fragment>
        ))}
        <Text>{currentInput}</Text>
        <Text dimColor>{ghostText}</Text>
        <Text inverse> </Text>
      </Box>

      {suggestions.length > 0 && currentInput && (
        <Box marginTop={1}>
          <Text dimColor>Suggestions: </Text>
          {suggestions.slice(0, 8).map((suggestion, i) => (
            <React.Fragment key={`suggestion-${i}-${suggestion}`}>
              <Text
                inverse={i === selectedSuggestion}
                color={i === selectedSuggestion ? "cyan" : undefined}
              >
                {suggestion}
              </Text>
              <Text dimColor> </Text>
            </React.Fragment>
          ))}
        </Box>
      )}
    </Box>
  );
}
