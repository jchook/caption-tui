import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
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

interface EditorState {
  text: string;
  cursor: number;
}

export function NaturalCaptionEditor({
  entry,
  onSave,
  onNext,
  onPrev,
  onClose,
  onActivity,
}: NaturalCaptionEditorProps) {
  const [state, setState] = useState<EditorState>(() => ({
    text: entry.caption,
    cursor: entry.caption.length,
  }));
  const { text, cursor } = state;
  const launchExternalEditor = useExternalEditor();

  // Mirror the latest committed state so handlers that read the caption
  // (save/nav/$EDITOR) never use a stale closure value mid-keystroke-batch.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Functional updates are essential: Ink can fire the input handler several
  // times before React commits a re-render, so each keystroke must build on the
  // freshest text, not the `text` captured when this render's handler was made.
  // (Updating stateRef here too keeps read-only handlers correct within a batch.)
  const update = useCallback((fn: (prev: EditorState) => EditorState) => {
    setState((prev) => {
      const next = fn(prev);
      stateRef.current = next;
      return next;
    });
  }, []);

  // Reset when the image changes.
  useEffect(() => {
    const next = { text: entry.caption, cursor: entry.caption.length };
    stateRef.current = next;
    setState(next);
  }, [entry]);

  const openInExternalEditor = useCallback(() => {
    launchExternalEditor(stateRef.current.text).then((edited) => {
      if (edited === null) return;
      update(() => ({ text: edited, cursor: edited.length }));
      onSave(edited);
      // The screen was torn down/resized while $EDITOR ran; nudge the parent
      // to re-transmit the image preview.
      onActivity?.();
    });
  }, [launchExternalEditor, update, onSave, onActivity]);

  useInput((input, key) => {
    // Let the parent repaint the (kitty/sixel) image preview, which Ink erases
    // on every frame.
    onActivity?.();

    if (key.escape) {
      onSave(stateRef.current.text);
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
      onSave(stateRef.current.text);
      onNext();
      return;
    }

    // --- Cursor motion -------------------------------------------------------

    // Word jumps: Ctrl/Alt + arrows, and emacs Alt-b / Alt-f.
    if ((key.ctrl || key.meta) && key.leftArrow) {
      update((s) => ({ ...s, cursor: wordLeftIndex(s.text, s.cursor) }));
      return;
    }
    if ((key.ctrl || key.meta) && key.rightArrow) {
      update((s) => ({ ...s, cursor: wordRightIndex(s.text, s.cursor) }));
      return;
    }
    if (key.meta && input === "b") {
      update((s) => ({ ...s, cursor: wordLeftIndex(s.text, s.cursor) }));
      return;
    }
    if (key.meta && input === "f") {
      update((s) => ({ ...s, cursor: wordRightIndex(s.text, s.cursor) }));
      return;
    }

    // Line ends: Ctrl-A / Ctrl-E (emacs) and Home / End.
    if (key.home || (key.ctrl && input === "a")) {
      update((s) => ({ ...s, cursor: 0 }));
      return;
    }
    if (key.end || (key.ctrl && input === "e")) {
      update((s) => ({ ...s, cursor: s.text.length }));
      return;
    }

    if (key.leftArrow) {
      update((s) => ({ ...s, cursor: Math.max(0, s.cursor - 1) }));
      return;
    }
    if (key.rightArrow) {
      update((s) => ({ ...s, cursor: Math.min(s.text.length, s.cursor + 1) }));
      return;
    }

    // Up/down navigate images (save the current caption first).
    if (key.upArrow) {
      onSave(stateRef.current.text);
      onPrev();
      return;
    }
    if (key.downArrow) {
      onSave(stateRef.current.text);
      onNext();
      return;
    }

    // --- Editing -------------------------------------------------------------

    // Ctrl-W: delete the word before the cursor.
    if (key.ctrl && input === "w") {
      update((s) => deleteWordBefore(s.text, s.cursor));
      return;
    }

    if (key.backspace || key.delete) {
      update((s) =>
        s.cursor > 0
          ? {
              text: s.text.slice(0, s.cursor - 1) + s.text.slice(s.cursor),
              cursor: s.cursor - 1,
            }
          : s,
      );
      return;
    }

    // Regular character input (ignore other control/meta chords).
    if (input && !key.ctrl && !key.meta) {
      update((s) => ({
        text: s.text.slice(0, s.cursor) + input + s.text.slice(s.cursor),
        cursor: s.cursor + input.length,
      }));
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
