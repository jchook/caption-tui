import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import { useExternalEditor } from "../hooks/useExternalEditor.js";
import type { ImageEntry } from "../utils/dataset.js";
import {
  deleteWordBefore,
  wordLeftIndex,
  wordRightIndex,
} from "../utils/textNav.js";

interface NaturalCaptionEditorProps {
  entry: ImageEntry;
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

export function NaturalCaptionEditor({
  entry,
  onSave,
  onNext,
  onPrev,
  onClose,
  onActivity,
}: NaturalCaptionEditorProps) {
  const [text, setText] = useState(entry.caption);
  const [cursor, setCursor] = useState(entry.caption.length);
  const launchExternalEditor = useExternalEditor();

  // Reset state when the image changes.
  useEffect(() => {
    setText(entry.caption);
    setCursor(entry.caption.length);
  }, [entry]);

  const openInExternalEditor = useCallback(() => {
    launchExternalEditor(text).then((edited) => {
      if (edited === null) return;
      setText(edited);
      setCursor(edited.length);
      onSave(edited);
      // The screen was torn down/resized while $EDITOR ran; nudge the parent
      // to re-transmit the image preview.
      onActivity?.();
    });
  }, [launchExternalEditor, text, onSave, onActivity]);

  const insertText = useCallback(
    (value: string) => {
      setText(text.slice(0, cursor) + value + text.slice(cursor));
      setCursor(cursor + value.length);
    },
    [text, cursor],
  );

  useInput((input, key) => {
    // Let the parent repaint the (kitty/sixel) image preview, which Ink erases
    // on every frame.
    onActivity?.();

    if (key.escape) {
      onSave(text);
      onClose();
      return;
    }

    // Ctrl-G: hand off to $EDITOR (real vim/nvim, your config). In tmux this
    // opens in a split so the image stays visible up top.
    if (key.ctrl && input === "g") {
      openInExternalEditor();
      return;
    }

    // Ignore Tab (no autocomplete to accept) rather than inserting a tab char.
    if (key.tab) return;

    // Enter saves and advances. Captions are single-line prose.
    if (key.return) {
      onSave(text);
      onNext();
      return;
    }

    // --- Cursor motion -------------------------------------------------------

    // Word jumps: Ctrl/Alt + arrows, and emacs Alt-b / Alt-f.
    if ((key.ctrl || key.meta) && key.leftArrow) {
      setCursor(wordLeftIndex(text, cursor));
      return;
    }
    if ((key.ctrl || key.meta) && key.rightArrow) {
      setCursor(wordRightIndex(text, cursor));
      return;
    }
    if (key.meta && input === "b") {
      setCursor(wordLeftIndex(text, cursor));
      return;
    }
    if (key.meta && input === "f") {
      setCursor(wordRightIndex(text, cursor));
      return;
    }

    // Line ends: Ctrl-A / Ctrl-E (emacs) and Home / End.
    if (key.home || (key.ctrl && input === "a")) {
      setCursor(0);
      return;
    }
    if (key.end || (key.ctrl && input === "e")) {
      setCursor(text.length);
      return;
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(Math.min(text.length, cursor + 1));
      return;
    }

    // Up/down navigate images (save the current caption first).
    if (key.upArrow) {
      onSave(text);
      onPrev();
      return;
    }
    if (key.downArrow) {
      onSave(text);
      onNext();
      return;
    }

    // --- Editing -------------------------------------------------------------

    // Ctrl-W: delete the word before the cursor.
    if (key.ctrl && input === "w") {
      const next = deleteWordBefore(text, cursor);
      setText(next.text);
      setCursor(next.cursor);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setText(text.slice(0, cursor - 1) + text.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }

    // Regular character input (ignore other control/meta chords).
    if (input && !key.ctrl && !key.meta) {
      insertText(input);
    }
  });

  const before = text.slice(0, cursor);
  const underCursor = text.slice(cursor, cursor + 1) || " ";
  const after = text.slice(cursor + 1);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

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
          - Enter/↑↓: nav, ^A/^E: home/end, ^G: $EDITOR, Esc: close
        </Text>
      </Box>

      <Box flexWrap="wrap">
        <Text dimColor>Caption: </Text>
        <Text>{before}</Text>
        <Text inverse>{underCursor}</Text>
        <Text>{after}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{words} words</Text>
      </Box>
    </Box>
  );
}
