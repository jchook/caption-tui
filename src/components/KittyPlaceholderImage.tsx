import { Box, Text, useStdout } from "ink";
import { Jimp } from "jimp";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildDelete,
  buildPlaceholderRows,
  buildTransmitVirtual,
  fitGrid,
  MAX_IMAGE_ID,
  wrapForTmux,
} from "../utils/kittyPlaceholder.js";

/**
 * An image rendered with kitty's Unicode-placeholder graphics.
 *
 * Unlike ink-picture's `KittyImage`, nothing here touches the cursor. The
 * graphics escape codes only *transmit* the image and register an invisible
 * virtual placement; the visible part is ordinary `<Text>` that Ink lays out,
 * clips and repaints like any other text. That is what makes the preview
 * survive Ink's frame rewrites and work inside tmux.
 *
 * See `src/utils/kittyPlaceholder.ts` for the protocol details.
 */

/**
 * How long the preview has to sit still before we decode and transmit it.
 *
 * Holding the down arrow walks through images faster than a PNG can be decoded
 * and pushed to the terminal, and every one of those transmits is wasted work
 * on an image already scrolled past -- a Jimp decode blocking the event loop,
 * kilobytes down the wire, and a placeholder grid rewritten mid-scroll. Waiting
 * for the selection to settle keeps the image you *were* looking at on screen
 * until there is a new one ready to replace it.
 */
export const TRANSMIT_DEBOUNCE_MS = 90;

/**
 * How long a replaced image is left alive in the terminal.
 *
 * Deleting it the instant its successor is transmitted was wrong: the
 * placeholder cells on screen still refer to the old image until Ink paints the
 * new ones, so the pane blinked through empty every single time -- and inside
 * tmux, where passthrough escape codes reach the terminal ahead of the pane's
 * queued redraw, that gap is wide enough to see. The old image costs a little
 * terminal memory for half a second; that is a much better trade.
 */
export const RETIRE_GRACE_MS = 500;

let nextImageId = 0;

/**
 * Image IDs live in a global namespace shared with every other program talking
 * to the terminal, so we cycle through the 1..255 range rather than reusing a
 * fixed ID -- reusing one would make a stale placeholder from a previous frame
 * suddenly resolve to the newly transmitted image.
 */
function allocateImageId(): number {
  nextImageId = (nextImageId % MAX_IMAGE_ID) + 1;
  return nextImageId;
}

interface Placement {
  id: number;
  columns: number;
  rows: number;
}

interface KittyPlaceholderImageProps {
  src: string;
  /** Cell budget for the preview; the image is fitted inside it. */
  maxColumns: number;
  maxRows: number;
  /** Real terminal cell size in pixels, when known. */
  cellWidth?: number;
  cellHeight?: number;
  /** Wrap graphics escape codes for tmux passthrough. */
  insideTmux?: boolean;
  /** Settle time before decoding. Overridable so tests can widen the window. */
  debounceMs?: number;
}

export function KittyPlaceholderImage({
  src,
  maxColumns,
  maxRows,
  cellWidth,
  cellHeight,
  insideTmux = false,
  debounceMs = TRANSMIT_DEBOUNCE_MS,
}: KittyPlaceholderImageProps) {
  const { stdout } = useStdout();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [failed, setFailed] = useState(false);

  const write = useCallback(
    (sequence: string) => {
      stdout.write(insideTmux ? wrapForTmux(sequence) : sequence);
    },
    [stdout, insideTmux],
  );

  // The image currently registered with the terminal. Tracked in a ref so the
  // unmount cleanup can delete it without re-running on every transmit.
  const activeIdRef = useRef<number | undefined>(undefined);
  // Images that have been replaced but not yet freed. See RETIRE_GRACE_MS.
  const retiredIdsRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;

    const transmit = async () => {
      try {
        const image = await Jimp.read(src);
        if (cancelled) return;

        const grid = fitGrid({
          imageWidth: image.width,
          imageHeight: image.height,
          maxColumns,
          maxRows,
          cellWidth,
          cellHeight,
        });
        if (grid.columns === 0 || grid.rows === 0) return;

        // Downscale to the pixel size the grid will actually occupy so we
        // transmit as few bytes as possible. Never upscale -- kitty will do
        // that on display for free, and sending magnified pixels just makes
        // the payload bigger.
        const targetWidth = grid.columns * (cellWidth ?? 8);
        const targetHeight = grid.rows * (cellHeight ?? 16);
        const scale = Math.min(
          targetWidth / image.width,
          targetHeight / image.height,
          1,
        );
        if (scale < 1) {
          image.resize({
            w: Math.max(1, Math.round(image.width * scale)),
            h: Math.max(1, Math.round(image.height * scale)),
          });
        }

        const png = await image.getBuffer("image/png");
        if (cancelled) return;

        const id = allocateImageId();
        for (const chunk of buildTransmitVirtual({
          id,
          pngBase64: png.toString("base64"),
          columns: grid.columns,
          rows: grid.rows,
        })) {
          write(chunk);
        }

        // The previous image is queued for deletion rather than deleted here:
        // its placeholder cells are what is on screen until Ink paints the new
        // ones, and freeing it first is what made the preview blink out.
        const previous = activeIdRef.current;
        activeIdRef.current = id;
        if (previous !== undefined) retiredIdsRef.current.push(previous);

        setFailed(false);
        setPlacement({ id, columns: grid.columns, rows: grid.rows });
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    const timer = setTimeout(() => {
      void transmit();
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [src, maxColumns, maxRows, cellWidth, cellHeight, write, debounceMs]);

  // Free the images the new placement replaced, once it has had time to reach
  // the screen. Each new placement restarts the clock, so a fast scroll frees
  // everything in one go after it stops rather than mid-flight.
  useEffect(() => {
    if (placement === null || retiredIdsRef.current.length === 0) return;

    const timer = setTimeout(() => {
      for (const id of retiredIdsRef.current) write(buildDelete(id));
      retiredIdsRef.current = [];
    }, RETIRE_GRACE_MS);

    return () => clearTimeout(timer);
  }, [placement, write]);

  // Free the terminal's copy of the image when the preview goes away. Kitty
  // holds transmitted images until told otherwise, so skipping this would leak
  // one image per preview for the lifetime of the terminal.
  useEffect(
    () => () => {
      for (const id of retiredIdsRef.current) write(buildDelete(id));
      retiredIdsRef.current = [];
      if (activeIdRef.current !== undefined) {
        write(buildDelete(activeIdRef.current));
        activeIdRef.current = undefined;
      }
    },
    [write],
  );

  if (failed) {
    return (
      <Box width={maxColumns} height={maxRows} justifyContent="center">
        <Text dimColor>Unable to load image</Text>
      </Box>
    );
  }

  if (!placement) {
    return (
      <Box width={maxColumns} height={maxRows} justifyContent="center">
        <Text dimColor>Loading image...</Text>
      </Box>
    );
  }

  return (
    <Box
      width={maxColumns}
      height={maxRows}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      {buildPlaceholderRows(placement).map((line, index) => (
        // Ink emits the string verbatim, so the embedded SGR carrying the
        // image ID reaches the terminal intact; each placeholder cell measures
        // as exactly one column, so the grid lays out like ordinary text.
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
        <Text key={index}>{line}</Text>
      ))}
    </Box>
  );
}
