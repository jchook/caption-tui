import { appendFileSync } from "node:fs";
import { Box, Text, useApp, useInput } from "ink";
import Image, { InkPictureProvider, type TerminalInfo } from "ink-picture";
import { useCallback, useEffect, useRef, useState } from "react";
import { CaptionEditor } from "./components/CaptionEditor.js";
import {
  DeleteConfirm,
  deleteConfirmRows,
} from "./components/DeleteConfirm.js";
import { ImageList } from "./components/ImageList.js";
import { KittyPlaceholderImage } from "./components/KittyPlaceholderImage.js";
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
import {
  describeError,
  filesToRemove,
  moveToTrash,
  permanentlyDelete,
  removeEntryAt,
} from "./utils/deleteEntry.js";
import type { TerminalProbeResult } from "./utils/terminalProbe.js";

// Rows reserved (outside the scrollable image list) for the list header and
// the "Showing X-Y of Z" footer when browsing.
const LIST_CHROME_ROWS = 4;
// Fixed rows for the compact list shown above the editor while captioning.
const COMPACT_LIST_ROWS = 3;
// Minimum rows kept for the caption editor so the preview height stays a pure
// function of the terminal size (and never shifts as you type).
const EDITOR_MIN_ROWS = 7;
// While $EDITOR has the caption there is no caption editor to make room for --
// just the one-line "editing in nvim" hint, and the preview takes the rest.
const EXTERNAL_EDIT_ROWS = 1;

interface AppProps {
  datasetPath: string;
  mode?: CaptionMode;
  // Graphics capabilities probed at startup (see src/utils/terminalProbe.ts).
  graphics?: TerminalProbeResult;
}

export function App({ datasetPath, mode = "tags", graphics }: AppProps) {
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

  // Ink fires the input handler once per key in a stdin chunk, all inside one
  // React batch, so `editingIndex` is stale for every key after the first.
  // Holding up/down in the editor therefore advanced a single image per chunk
  // (and saved to the wrong file). Route every read through a ref that the
  // setter updates immediately.
  // Shift-D on the list opens a confirmation instead of deleting outright.
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Guards against a burst of confirm keys firing the same delete twice.
  const deletingRef = useRef(false);

  // True while the caption is open in $EDITOR (Ctrl-G, natural mode). Our own
  // editor stands down and the preview takes its rows -- in a tmux split this
  // pane is still on screen next to the real editor.
  const [externalEditing, setExternalEditing] = useState(false);

  const editingIndexRef = useRef<number | null>(null);
  const setEditing = useCallback((index: number | null) => {
    editingIndexRef.current = index;
    setEditingIndex(index);
  }, []);

  // With kitty available we render the preview ourselves via Unicode
  // placeholders, which are plain text and therefore need none of the repaint
  // nudging, visibility overriding or layout padding that direct-placement
  // graphics did. Everything else falls through to ink-picture's text-based
  // protocols (half-block/braille/ascii), which have always worked fine.
  const useKittyPlaceholders = graphics?.supportsKittyGraphics === true;

  // ink-picture only sees the fallback path, so hand it just what it needs.
  // The measured cell size is spread in only when we actually have it:
  // InkPictureProvider merges overrides with `{...defaults, ...overrides}`, so
  // an explicit `undefined` would wipe out its own default rather than defer
  // to it.
  const terminalInfo: Partial<TerminalInfo> | undefined = graphics
    ? {
        ...(graphics.cellWidth !== undefined && {
          cellWidth: graphics.cellWidth,
        }),
        ...(graphics.cellHeight !== undefined && {
          cellHeight: graphics.cellHeight,
        }),
        supportsKittyGraphics: graphics.supportsKittyGraphics,
        supportsSixelGraphics: graphics.supportsSixelGraphics,
      }
    : undefined;

  // Diagnostic hook: set CAPTION_TUI_DEBUG=1 (or to a file path) to log what
  // was detected and which renderer that picked. stdout is owned by the TUI, so
  // we append to a file. Reveals whether supportsKittyGraphics came back false
  // (detection) vs. some other reason the native protocol isn't being used. The
  // env vars matter because tmux/screen and TERM_PROGRAM change how graphics
  // protocols resolve.
  const logDebug = useCallback((payload: Record<string, unknown>) => {
    const dbg = process.env.CAPTION_TUI_DEBUG;
    if (!dbg) return;
    const logPath =
      dbg === "1" || dbg === "true" ? "caption-tui-debug.log" : dbg;
    try {
      appendFileSync(logPath, `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      // Best-effort diagnostics only.
    }
  }, []);

  // Logged on mount rather than from ink-picture's detection callback: that
  // callback only fires on the fallback path, so wiring the log to it meant the
  // kitty path -- the one people actually debug -- logged nothing at all.
  useEffect(() => {
    logDebug({
      probed: graphics,
      renderer: useKittyPlaceholders
        ? "kitty-unicode-placeholders"
        : "ink-picture",
      env: {
        TERM: process.env.TERM,
        TERM_PROGRAM: process.env.TERM_PROGRAM,
        TERM_PROGRAM_VERSION: process.env.TERM_PROGRAM_VERSION,
        KITTY_WINDOW_ID: process.env.KITTY_WINDOW_ID,
        TMUX: process.env.TMUX,
        STY: process.env.STY,
        COLORTERM: process.env.COLORTERM,
      },
    });
  }, [logDebug, graphics, useKittyPlaceholders]);

  // ink-picture's own in-render detection, for comparison with `probed` above.
  const logDetection = useCallback(
    (info: TerminalInfo) => logDebug({ libDetected: info }),
    [logDebug],
  );

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

  // Handle quit. `input` can be a whole run of characters (Ink's paste path,
  // which held or fast-typed keys also take once a laggy link stalls the event
  // loop), so a burst ending in `q` still means quit -- and the ref, not the
  // `editingIndex` this render captured, decides whether the editor has since
  // opened inside the same batch.
  useInput((input) => {
    // `q` is the confirmation bar's own cancel while it is open.
    if (pendingDelete !== null) return;
    if (editingIndexRef.current === null && input.includes("q")) {
      exit();
    }
  });

  const handleEdit = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return;
      setEditing(index);
    },
    [entries, setEditing],
  );

  // Saves take their target entry explicitly, bound at the same render that
  // handed that entry to the editor. A burst of up/down keys advances
  // `editingIndex` several times before React re-renders, so a save keyed off
  // the *current* index would write the text still sitting in the editor into
  // the file of an image it has already moved past.
  //
  // Every row pointing at the file we just wrote is refreshed, not just the one
  // being edited: `image1.jpg` and `image1.png` in the same folder share a
  // single `image1.txt`, so both rows show its contents and both must follow it.
  // (Keying the update off a single captionPath match instead would land on the
  // first of the two, leaving the row you actually edited stale -- and the
  // editor would then reset to that stale text and revert the file on its next
  // save.)
  const handleSave = useCallback(async (target: ImageEntry, tags: string[]) => {
    await saveTags(target.captionPath, tags);

    setEntries((prev) =>
      prev.map((e) =>
        e.captionPath === target.captionPath ? { ...e, tags } : e,
      ),
    );

    // Update allTags
    setAllTags((prev) => {
      const newSet = new Set(prev);
      for (const tag of tags) {
        newSet.add(tag.toLowerCase());
      }
      return newSet;
    });
  }, []);

  const handleSaveCaption = useCallback(
    async (target: ImageEntry, caption: string) => {
      const trimmed = caption.trim();
      await saveCaption(target.captionPath, trimmed);

      setEntries((prev) =>
        prev.map((e) =>
          e.captionPath === target.captionPath ? { ...e, caption: trimmed } : e,
        ),
      );
    },
    [],
  );

  const handleNext = useCallback(() => {
    const current = editingIndexRef.current;
    if (current === null) return;

    const nextIndex = current + 1;
    if (entries[nextIndex]) {
      setSelectedIndex(nextIndex);
      setEditing(nextIndex);
    } else {
      setEditing(null);
    }
  }, [entries, setEditing]);

  const handlePrev = useCallback(() => {
    const current = editingIndexRef.current;
    if (current === null) return;

    const prevIndex = current - 1;
    if (entries[prevIndex]) {
      setSelectedIndex(prevIndex);
      setEditing(prevIndex);
    }
  }, [entries, setEditing]);

  const handleClose = useCallback(() => {
    setEditing(null);
  }, [setEditing]);

  const handleRequestDelete = useCallback((index: number) => {
    setPendingDelete(index);
    setTrashError(null);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null);
    setTrashError(null);
  }, []);

  const handleConfirmDelete = useCallback(
    async (mode: "trash" | "permanent") => {
      if (deletingRef.current || pendingDelete === null) return;
      const target = entries[pendingDelete];
      if (!target) return;

      deletingRef.current = true;
      setDeleting(true);
      const files = filesToRemove(entries, target);
      try {
        if (mode === "trash") {
          await moveToTrash(files);
        } else {
          await permanentlyDelete(files);
        }
      } catch (error) {
        // Offer the permanent delete rather than doing it: the user agreed to
        // trash this file, which is a different promise.
        setTrashError(describeError(error));
        return;
      } finally {
        deletingRef.current = false;
        setDeleting(false);
      }

      const next = removeEntryAt(entries, pendingDelete);
      setEntries(next.entries);
      setSelectedIndex(next.selectedIndex);
      setPendingDelete(null);
      setTrashError(null);
    },
    [entries, pendingDelete],
  );

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
  // Captured once per render so the preview and the editor -- and the save
  // callback bound below -- all refer to the same image.
  const editingEntry =
    editingIndex === null ? undefined : entries[editingIndex];

  // Render one line short of the terminal height, which keeps Ink on its
  // standard render path instead of the fullscreen one that repaints via
  // ansiEscapes.clearTerminal on every frame. This is now purely about avoiding
  // that per-frame whole-screen clear (and the flicker it causes) -- the preview
  // itself no longer depends on it, because Unicode placeholders are just text
  // and are redrawn correctly by any repaint.
  const appRows = Math.max(1, rows - 1);
  // Keep the whole app within the terminal so Ink's frame math stays aligned
  // (an overflowing frame is what garbles the list while scrolling).
  // The delete bar sits below the list, and the list otherwise grows to fill
  // the whole app box -- which pushes the bar past `overflow: hidden` and makes
  // it invisible even though it is mounted and taking input. Give up its rows.
  const deleteTarget =
    pendingDelete === null ? undefined : entries[pendingDelete];
  const deleteFiles = deleteTarget
    ? filesToRemove(entries, deleteTarget)
    : undefined;
  const confirmRows =
    deleteTarget && deleteFiles
      ? deleteConfirmRows({
          trashError: trashError !== null,
          keepsCaption: !deleteFiles.includes(deleteTarget.captionPath),
        })
      : 0;
  const listMaxVisible = Math.max(1, appRows - LIST_CHROME_ROWS - confirmRows);
  // Preview height depends only on the terminal size, so the image never
  // resizes (and never has to be re-transmitted) while you type.
  const previewHeight = Math.max(
    5,
    appRows -
      COMPACT_LIST_ROWS -
      (externalEditing ? EXTERNAL_EDIT_ROWS : EDITOR_MIN_ROWS),
  );

  const content = (
    <Box
      flexDirection="column"
      width={columns}
      height={appRows}
      overflow="hidden"
    >
      {/* Image list */}
      <Box flexShrink={0} flexDirection="column">
        <ImageList
          entries={entries}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onEdit={handleEdit}
          onRequestDelete={handleRequestDelete}
          maxVisible={isEditing ? COMPACT_LIST_ROWS : listMaxVisible}
          disabled={isEditing || pendingDelete !== null}
          compact={isEditing}
          mode={mode}
        />
      </Box>

      {/* Delete confirmation (list mode only; owns input while open) */}
      {deleteTarget && deleteFiles && (
        <Box flexShrink={0}>
          <DeleteConfirm
            entry={deleteTarget}
            files={deleteFiles}
            trashError={trashError}
            busy={deleting}
            onConfirm={handleConfirmDelete}
            onCancel={handleCancelDelete}
          />
        </Box>
      )}

      {/* Image preview - rendered at top level */}
      {editingEntry && (
        <Box height={previewHeight} flexShrink={0} width={columns}>
          {useKittyPlaceholders ? (
            <KittyPlaceholderImage
              src={editingEntry.imagePath}
              maxColumns={columns}
              maxRows={previewHeight}
              cellWidth={graphics?.cellWidth}
              cellHeight={graphics?.cellHeight}
              insideTmux={graphics?.insideTmux}
            />
          ) : (
            /* Explicit cell dimensions (not width="100%") so ink-picture never
               depends on measureElement, which races on mount and can resolve to
               0 -> the decode is skipped and the pane hangs on "Loading...". */
            <Image
              src={editingEntry.imagePath}
              width={columns}
              height={previewHeight}
              objectFit="contain"
            />
          )}
        </Box>
      )}

      {/* kitty is right there, but tmux would eat the graphics escape codes.
          Surface the one-line fix rather than silently dropping to blocks. */}
      {isEditing && graphics?.kittyNeedsTmuxPassthrough && (
        <Box flexShrink={0}>
          <Text dimColor>
            kitty images need: tmux set -g allow-passthrough on
          </Text>
        </Box>
      )}

      {/* Caption editor (shown when editing) */}
      {editingEntry && (
        <Box flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
          {isNatural ? (
            <NaturalCaptionEditor
              entry={editingEntry}
              onSave={(caption) => handleSaveCaption(editingEntry, caption)}
              onNext={handleNext}
              onPrev={handlePrev}
              onClose={handleClose}
              onExternalEdit={setExternalEditing}
            />
          ) : (
            <CaptionEditor
              entry={editingEntry}
              allTags={allTags}
              onSave={(tags) => handleSave(editingEntry, tags)}
              onNext={handleNext}
              onPrev={handlePrev}
              onClose={handleClose}
            />
          )}
        </Box>
      )}
    </Box>
  );

  // ink-picture is only on screen when the preview falls back to its text
  // protocols. Mounting its provider regardless costs a second capability
  // probe -- more query escape codes written to the terminal, whose replies
  // land in Ink's stdin -- for a component this path never renders.
  if (useKittyPlaceholders) return content;

  return (
    <InkPictureProvider
      terminalInfo={terminalInfo}
      onTerminalInfoDetection={logDetection}
    >
      {content}
    </InkPictureProvider>
  );
}
