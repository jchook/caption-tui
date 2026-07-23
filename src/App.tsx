import { appendFileSync } from "node:fs";
import { Box, Text, useApp, useInput } from "ink";
import Image, {
  type GetVisibility,
  InkPictureProvider,
  type TerminalInfo,
} from "ink-picture";
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
  // Graphics capabilities probed at startup (see src/utils/terminalProbe.ts).
  // Passed through to InkPictureProvider as an authoritative override because
  // ink-picture's own in-render detection is unreliable (it races Ink for stdin).
  terminalInfo?: Partial<TerminalInfo>;
}

export function App({ datasetPath, mode = "tags", terminalInfo }: AppProps) {
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
  // Bumped on every editor keystroke to force a re-render. As of ink-picture v2
  // this is mostly redundant: InkPictureProvider repaints the graphic after every
  // React commit (via a Profiler), so the kitty/sixel image survives Ink's frame
  // rewrites without our help. Kept as a cheap belt-and-suspenders nudge.
  const [, setRepaintTick] = useState(0);
  const requestRepaint = useCallback(() => {
    setRepaintTick((t) => (t + 1) % 1_000_000);
  }, []);

  // ink-picture draws the kitty graphic in a post-render effect that only paints
  // once the preview box's measured position has settled. On the first Enter, the
  // browse->edit layout transition can leave that final position without a trailing
  // render, so the graphic is never placed and you're left staring at the bare
  // "Loading..." placeholder until you navigate (which forces a re-render). Nudging
  // a few repaints after the edited image changes makes the placement re-run once
  // the layout settles -- no manual scroll needed. (Navigating fires this too; it's
  // harmless there since the image is already placed.)
  useEffect(() => {
    if (editingIndex === null) return;
    const timers = [50, 150, 400].map((ms) => setTimeout(requestRepaint, ms));
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [editingIndex, requestRepaint]);

  // ink-picture v2 downgrades to a pixelated half-block/braille fallback whenever
  // it computes the image box as anything less than fully on-screen ("partial").
  // Our fullscreen layout always keeps the whole preview within the app bounds, so
  // a "partial" reading here is a spurious edge-of-screen artifact. Treat anything
  // visible as "full" so the native graphics protocol (kitty/sixel/iTerm2) is used;
  // terminals without graphics support still fall back correctly, since the base
  // protocol they resolve to is already half-block/braille/ascii.
  const keepGraphics = useCallback<GetVisibility>(
    ({ defaultVisibility }) =>
      defaultVisibility === "hidden" ? "hidden" : "full",
    [],
  );

  // Diagnostic hook: set CAPTION_TUI_DEBUG=1 (or to a file path) to log what
  // ink-picture actually detected. stdout is owned by the TUI, so we append to a
  // file. Reveals whether supportsKittyGraphics came back false (detection) vs.
  // some other reason the native protocol isn't being used. The env vars matter
  // because tmux/screen and TERM_PROGRAM change how graphics protocols resolve.
  const logDetection = useCallback(
    (info: TerminalInfo) => {
      const dbg = process.env.CAPTION_TUI_DEBUG;
      if (!dbg) return;
      const logPath =
        dbg === "1" || dbg === "true" ? "caption-tui-debug.log" : dbg;
      const env = {
        TERM: process.env.TERM,
        TERM_PROGRAM: process.env.TERM_PROGRAM,
        TERM_PROGRAM_VERSION: process.env.TERM_PROGRAM_VERSION,
        KITTY_WINDOW_ID: process.env.KITTY_WINDOW_ID,
        TMUX: process.env.TMUX,
        STY: process.env.STY,
        COLORTERM: process.env.COLORTERM,
      };
      try {
        appendFileSync(
          logPath,
          // `probed` is our own startup probe (the source of truth we feed in);
          // `libDetected` is ink-picture's own in-render detection, for comparison.
          `${JSON.stringify({ probed: terminalInfo, libDetected: info, env }, null, 2)}\n`,
        );
      } catch {
        // Best-effort diagnostics only.
      }
    },
    [terminalInfo],
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

  // Render one line short of the terminal height. When the app fills the whole
  // screen, Ink treats every frame as "fullscreen" and repaints it with
  // ansiEscapes.clearTerminal (ink.js) -- an unconditional screen clear that wipes
  // the kitty/sixel graphic on every render, causing the image to flash and vanish.
  // Staying one row under keeps Ink on its standard render path, which skips writes
  // entirely when the frame is unchanged (so the graphic survives at rest). See the
  // render() comment in index.ts for why we don't use incrementalRendering.
  const appRows = Math.max(1, rows - 1);
  // Keep the whole app within the terminal so Ink's frame math stays aligned
  // (an overflowing frame is what garbles the list while scrolling).
  const listMaxVisible = Math.max(1, appRows - LIST_CHROME_ROWS);
  // Preview height depends only on the terminal size, so the image's position
  // never shifts while typing -> ink-picture doesn't re-transmit it (no flash).
  const previewHeight = Math.max(
    5,
    appRows - COMPACT_LIST_ROWS - EDITOR_MIN_ROWS,
  );
  // Kitty positions its graphic with absolute cursor math and ignores Ink's
  // overflow:hidden, so an image sized to *exactly* the preview box paints over
  // the editor row right beneath it. Draw one row short of the reserved box so the
  // graphic always lands inside its own pane, leaving a clean gap above the editor.
  const previewImageHeight = Math.max(1, previewHeight - 1);

  return (
    <InkPictureProvider
      terminalInfo={terminalInfo}
      onTerminalInfoDetection={logDetection}
    >
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
            maxVisible={isEditing ? COMPACT_LIST_ROWS : listMaxVisible}
            disabled={isEditing}
            compact={isEditing}
            mode={mode}
          />
        </Box>

        {/* Image preview - rendered at top level */}
        {isEditing && entries[editingIndex] && (
          <Box height={previewHeight} flexShrink={0} width={columns}>
            {/* Explicit cell dimensions (not width="100%") so ink-picture never
                depends on measureElement, which races on mount and can resolve to
                0 -> the decode is skipped and the pane hangs on "Loading...". This
                also pins the image scale to exactly the preview box. */}
            <Image
              src={entries[editingIndex]?.imagePath ?? ""}
              width={columns}
              height={previewImageHeight}
              objectFit="contain"
              getVisibility={keepGraphics}
            />
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
    </InkPictureProvider>
  );
}
