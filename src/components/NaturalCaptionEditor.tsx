import { Box, Text, useInput } from "ink";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useExternalEditor } from "../hooks/useExternalEditor.js";
import type { ImageEntry } from "../utils/dataset.js";
import { currentWordAt, getWordSuggestions } from "../utils/dataset.js";

interface NaturalCaptionEditorProps {
  entry: ImageEntry;
  vocabulary: Set<string>;
  onSave: (caption: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /**
   * Called on every keypress so the parent can re-render the image preview.
   * ink-picture only re-draws its graphic when its component re-renders, and
   * Ink repaints (and thus erases the graphic) on every keystroke.
   */
  onActivity?: () => void;
}

/** True when the character at `cursor` is not part of a word (or is EOL). */
function atWordBoundary(text: string, cursor: number): boolean {
  const char = text[cursor];
  return char === undefined || !/[a-zA-Z'-]/.test(char);
}

export function NaturalCaptionEditor({
  entry,
  vocabulary,
  onSave,
  onNext,
  onPrev,
  onClose,
  onActivity,
}: NaturalCaptionEditorProps) {
  const [text, setText] = useState(entry.caption);
  const [cursor, setCursor] = useState(entry.caption.length);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const launchExternalEditor = useExternalEditor();

  // Reset state when the image changes.
  useEffect(() => {
    setText(entry.caption);
    setCursor(entry.caption.length);
    setSelectedSuggestion(0);
  }, [entry]);

  // Only complete a word when the cursor sits at its trailing edge, otherwise
  // typing in the middle of a word would show a bogus ghost.
  const currentWord = useMemo(
    () => (atWordBoundary(text, cursor) ? currentWordAt(text, cursor) : ""),
    [text, cursor],
  );
  const suggestions = useMemo(
    () => getWordSuggestions(vocabulary, currentWord),
    [vocabulary, currentWord],
  );
  const hasSuggestions = suggestions.length > 0 && currentWord.length > 0;
  const activeSuggestion = hasSuggestions
    ? (suggestions[selectedSuggestion] ?? suggestions[0] ?? "")
    : "";
  const ghostText = activeSuggestion
    ? activeSuggestion.slice(currentWord.length)
    : "";

  const saveNow = useCallback(() => onSave(text), [onSave, text]);

  const openInExternalEditor = useCallback(() => {
    launchExternalEditor(text).then((edited) => {
      if (edited === null) return;
      setText(edited);
      setCursor(edited.length);
      setSelectedSuggestion(0);
      onSave(edited);
      // The screen was torn down/resized while $EDITOR ran; nudge the parent
      // to re-transmit the image preview.
      onActivity?.();
    });
  }, [launchExternalEditor, text, onSave, onActivity]);

  const acceptSuggestion = useCallback(() => {
    if (!ghostText) return false;
    // The completion for the word ending at the cursor slots in right there;
    // add a trailing space so prose keeps flowing into the next word.
    const insert = `${ghostText} `;
    setText(text.slice(0, cursor) + insert + text.slice(cursor));
    setCursor(cursor + insert.length);
    setSelectedSuggestion(0);
    return true;
  }, [ghostText, text, cursor]);

  const insertText = useCallback(
    (value: string) => {
      setText(text.slice(0, cursor) + value + text.slice(cursor));
      setCursor(cursor + value.length);
      setSelectedSuggestion(0);
    },
    [text, cursor],
  );

  useInput((input, key) => {
    // Let the parent repaint the (kitty/sixel) image preview, which Ink erases
    // on every frame.
    onActivity?.();

    if (key.escape) {
      saveNow();
      onClose();
      return;
    }

    // Ctrl-G: hand off to $EDITOR (real vim/nvim, your config). In tmux this
    // opens in a split so the image stays visible up top.
    if (key.ctrl && input === "g") {
      openInExternalEditor();
      return;
    }

    // Tab always accepts the current completion (no-op if there's no ghost).
    if (key.tab) {
      acceptSuggestion();
      return;
    }

    // Enter saves and advances, matching tag mode's muscle memory. Captions are
    // single-line prose, so there's no newline to insert.
    if (key.return) {
      onSave(text);
      onNext();
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setText(text.slice(0, cursor - 1) + text.slice(cursor));
        setCursor(cursor - 1);
        setSelectedSuggestion(0);
      }
      return;
    }

    if (key.upArrow) {
      if (hasSuggestions) {
        setSelectedSuggestion(Math.max(0, selectedSuggestion - 1));
      } else {
        onSave(text);
        onPrev();
      }
      return;
    }

    if (key.downArrow) {
      if (hasSuggestions) {
        setSelectedSuggestion(
          Math.min(suggestions.length - 1, selectedSuggestion + 1),
        );
      } else {
        onSave(text);
        onNext();
      }
      return;
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      setSelectedSuggestion(0);
      return;
    }

    if (key.rightArrow) {
      // At a word's end, the right arrow accepts the inline ghost completion.
      if (ghostText && cursor === text.length) {
        acceptSuggestion();
      } else {
        setCursor(Math.min(text.length, cursor + 1));
        setSelectedSuggestion(0);
      }
      return;
    }

    // Regular character input.
    if (input && !key.ctrl && !key.meta) {
      insertText(input);
    }
  });

  const before = text.slice(0, cursor);
  const underCursor = text.slice(cursor, cursor + 1) || " ";
  const after = text.slice(cursor + 1);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

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
        <Text dimColor>
          {" "}
          - Tab: complete, Enter/↑↓: nav, ^G: $EDITOR, Esc: close
        </Text>
      </Box>

      <Box flexWrap="wrap">
        <Text dimColor>Caption: </Text>
        <Text>{before}</Text>
        <Text dimColor>{ghostText}</Text>
        <Text inverse>{underCursor}</Text>
        <Text>{after}</Text>
      </Box>

      {hasSuggestions ? (
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
      ) : (
        <Box marginTop={1}>
          <Text dimColor>{wordCount} words</Text>
        </Box>
      )}
    </Box>
  );
}
