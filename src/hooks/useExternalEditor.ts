import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useStdin } from "ink";
import { useCallback } from "react";
import { inkControl } from "../utils/inkControl.js";

const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[H";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";

/** $VISUAL/$EDITOR, falling back to a sensible terminal editor. */
function resolveEditor(): string {
  return process.env.VISUAL || process.env.EDITOR || "nano";
}

/**
 * Captions are single-line prose, so fold whatever the editor saved (possibly
 * multi-line, with a trailing newline) back into one normalized line.
 */
function normalize(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Run the editor in a tmux split so the top pane (our TUI + image preview)
 * stays visible in the upper half. Returns false if tmux isn't usable so the
 * caller can fall back to a full-screen editor.
 */
async function editInTmuxSplit(editor: string, file: string): Promise<boolean> {
  const channel = `caption-tui-${randomUUID()}`;

  // Register the waiter (and its exit listeners) *before* creating the pane
  // that signals it, so a fast edit can't fire the signal before we listen.
  const waiter = spawn("tmux", ["wait-for", channel], { stdio: "ignore" });
  const finished = new Promise<void>((resolve) => {
    waiter.on("exit", () => resolve());
    waiter.on("error", () => resolve());
  });

  // The new pane opens below and takes focus, so keystrokes go to the editor
  // while our (now upper) pane keeps rendering the image.
  const paneCmd = `${editor} '${file}'; tmux wait-for -S ${channel}`;
  const split = spawnSync("tmux", ["split-window", "-v", paneCmd], {
    stdio: "ignore",
  });
  if (split.error || split.status !== 0) {
    waiter.kill();
    return false;
  }

  await finished;
  return true;
}

/**
 * Run the editor full-screen: hand it the whole terminal, then re-enter our
 * alt screen and force Ink to repaint from scratch.
 */
function editFullScreen(
  editor: string,
  file: string,
  setRawMode: (v: boolean) => void,
): void {
  setRawMode(false);
  process.stdin.pause();
  process.stdout.write(LEAVE_ALT_SCREEN);

  const [cmd, ...args] = editor.split(/\s+/);
  spawnSync(cmd ?? "nano", [...args, file], { stdio: "inherit" });

  process.stdout.write(ENTER_ALT_SCREEN);
  process.stdin.resume();
  setRawMode(true);
  // The screen we're diffing against is gone; make Ink redraw everything.
  inkControl.clear?.();
}

/**
 * Returns a function that opens the given text in the user's $EDITOR and
 * resolves with the edited text (or null if editing wasn't possible).
 */
export function useExternalEditor(): (
  initialText: string,
) => Promise<string | null> {
  const { setRawMode, isRawModeSupported } = useStdin();

  return useCallback(
    async (initialText: string): Promise<string | null> => {
      if (!isRawModeSupported) return null;

      const editor = resolveEditor();
      const file = join(tmpdir(), `caption-tui-${randomUUID()}.txt`);
      writeFileSync(file, initialText);

      try {
        const usedTmux = process.env.TMUX
          ? await editInTmuxSplit(editor, file)
          : false;
        if (!usedTmux) {
          editFullScreen(editor, file, setRawMode);
        }
        return normalize(readFileSync(file, "utf8"));
      } catch {
        return null;
      } finally {
        rmSync(file, { force: true });
      }
    },
    [setRawMode, isRawModeSupported],
  );
}
