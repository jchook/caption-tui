import { useStdout } from "ink";
import { useEffect, useState } from "react";

export interface TerminalSize {
  rows: number;
  columns: number;
}

/**
 * Track the terminal's size and re-render on resize.
 *
 * Ink already repaints on SIGWINCH, but reading a live snapshot into state
 * keeps our layout math (visible-row counts, preview height) in sync with the
 * current viewport instead of a stale value captured on first render.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();

  const [size, setSize] = useState<TerminalSize>(() => ({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  }));

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setSize({ rows: stdout.rows ?? 24, columns: stdout.columns ?? 80 });
    };
    stdout.on("resize", onResize);
    // Read once on mount in case the size changed before the listener attached.
    onResize();
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}
