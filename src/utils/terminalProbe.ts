/**
 * Terminal graphics capability probe.
 *
 * Detects kitty/sixel support and the terminal's pixel cell size ourselves, once
 * at startup, before Ink takes over stdin. The result decides which preview
 * renderer the app uses: our own kitty Unicode-placeholder component
 * (`src/components/KittyPlaceholderImage.tsx`) when kitty is available, or
 * ink-picture's text-based protocols otherwise -- in which case it is also fed
 * to `InkPictureProvider` as a `terminalInfo` override, which always wins over
 * the library's own detection.
 *
 * Why not rely on ink-picture's built-in detection? It probes lazily from inside
 * the React render, competing with Ink for stdin, and in practice misses the
 * responses -- leaving graphics disabled and the cell size stuck at the 6x12
 * default, which makes kitty terminals fall back to the pixelated half-block
 * renderer. Probing up front, while we still fully own stdin, is reliable and also
 * gives us the true cell size (needed to size the image to the preview box).
 *
 * There are two entirely separate detection paths, because inside tmux the
 * escape-code probe measures tmux rather than the terminal the user is looking
 * at. See `probeViaTmux()`.
 *
 * Reads responses via a plain `stdin` "data" listener -- the same mechanism Ink's
 * keyboard input relies on. Queries, in one batch:
 *   - CSI 16 t          -> cell size in pixels (`CSI 6 ; height ; width t`)
 *   - kitty graphics    -> `\x1b_Gi=<id>;OK\x1b\\` when supported
 *   - CSI c (primary DA) -> device attributes; contains `4` when sixel-capable,
 *                           and doubles as the end-of-response sentinel.
 */

import { execFileSync } from "node:child_process";

export interface TerminalProbeResult {
  cellWidth?: number;
  cellHeight?: number;
  supportsKittyGraphics: boolean;
  supportsSixelGraphics: boolean;
  /** Running under a tmux client, so graphics need passthrough wrapping. */
  insideTmux: boolean;
  /**
   * kitty is the outer terminal but tmux's `allow-passthrough` is off, so
   * graphics escape codes would be swallowed. The app falls back to a
   * text-based protocol and surfaces this as a hint, because it is a one-line
   * fix the user can apply and would otherwise be invisible.
   */
  kittyNeedsTmuxPassthrough: boolean;
}

/**
 * Ask tmux about the *client* rather than probing the tty.
 *
 * Inside tmux the kitty query (an APC escape code) never reaches the outer
 * terminal unless passthrough is on, and its reply is not reliably routed back
 * to the pane -- so escape-code probing cannot answer "is the outer terminal
 * kitty?" here. tmux already knows, and exposes it: `client_termname` is the
 * TERM of the attached client, and `client_cell_width`/`client_cell_height`
 * are its real pixel cell dimensions. Reading them is a few milliseconds and,
 * unlike an env var, stays correct when a session is detached and reattached
 * from a different terminal.
 */
function probeViaTmux(): {
  outerTerm?: string;
  cellWidth?: number;
  cellHeight?: number;
  passthroughEnabled: boolean;
} {
  const query = (args: string[]): string | undefined => {
    try {
      return execFileSync("tmux", args, {
        encoding: "utf8",
        timeout: 1000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return undefined;
    }
  };

  const info = query([
    "display-message",
    "-p",
    "#{client_termname}\t#{client_cell_width}\t#{client_cell_height}",
  ]);
  const [outerTerm, rawWidth, rawHeight] = (info ?? "").split("\t");

  const toSize = (raw: string | undefined): number | undefined => {
    const value = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };

  const passthrough = query(["show", "-gv", "allow-passthrough"]);

  return {
    outerTerm: outerTerm || undefined,
    cellWidth: toSize(rawWidth),
    cellHeight: toSize(rawHeight),
    passthroughEnabled: passthrough === "on" || passthrough === "all",
  };
}

const CELL_SIZE_QUERY = "\x1b[16t";
const KITTY_QUERY = "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\";
const DEVICE_ATTRIBUTES_QUERY = "\x1b[c";

// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing escape-sequence responses
const CELL_SIZE_REGEX = /\x1b\[6;(\d+);(\d+);?t/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing escape-sequence responses
const KITTY_RESPONSE_REGEX = /\x1b_Gi=31;(.+?)\x1b\\/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing escape-sequence responses
const DEVICE_ATTRIBUTES_REGEX = /\x1b\[\?([0-9;]+)c/;

/**
 * Detect the running terminal's graphics support. Resolves after the terminal's
 * primary-DA response arrives (the sentinel) or after `timeoutMs`, whichever
 * comes first. Never rejects; on any failure it resolves with graphics off so
 * the caller falls back to whatever the terminal-capable protocol is.
 */
export function probeTerminal(timeoutMs = 300): Promise<TerminalProbeResult> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  const insideTmux = process.env.TMUX !== undefined && process.env.TMUX !== "";

  const result: TerminalProbeResult = {
    supportsKittyGraphics: false,
    supportsSixelGraphics: false,
    insideTmux,
    kittyNeedsTmuxPassthrough: false,
  };

  // Inside tmux, ask tmux instead of the tty -- see probeViaTmux(). This is
  // authoritative, so we return without running the escape-code probe at all
  // (which would only measure tmux's own emulation, not the real terminal).
  if (insideTmux) {
    const tmuxInfo = probeViaTmux();
    const outerIsKitty = tmuxInfo.outerTerm?.includes("kitty") === true;
    result.cellWidth = tmuxInfo.cellWidth;
    result.cellHeight = tmuxInfo.cellHeight;
    result.supportsKittyGraphics = outerIsKitty && tmuxInfo.passthroughEnabled;
    result.kittyNeedsTmuxPassthrough =
      outerIsKitty && !tmuxInfo.passthroughEnabled;
    return Promise.resolve(result);
  }

  // Env-based fallback: if we are unmistakably in kitty but the query response
  // is missed for any reason, still enable the protocol. Cell size below is what
  // really needs the query; the boolean we can infer.
  const looksLikeKitty =
    process.env.TERM?.includes("kitty") === true ||
    process.env.KITTY_WINDOW_ID !== undefined;

  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    result.supportsKittyGraphics = looksLikeKitty;
    return Promise.resolve(result);
  }

  return new Promise((resolve) => {
    let buffer = "";
    let done = false;
    const wasRaw = stdin.isRaw;
    const wasPaused = stdin.isPaused();

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdin.removeListener("data", onData);

      const cell = buffer.match(CELL_SIZE_REGEX);
      if (cell?.[1] && cell[2]) {
        const height = Number.parseInt(cell[1], 10);
        const width = Number.parseInt(cell[2], 10);
        if (
          Number.isFinite(width) &&
          Number.isFinite(height) &&
          width > 0 &&
          height > 0
        ) {
          result.cellWidth = width;
          result.cellHeight = height;
        }
      }

      const kitty = buffer.match(KITTY_RESPONSE_REGEX);
      result.supportsKittyGraphics =
        (kitty?.[1]?.includes("OK") ?? false) || looksLikeKitty;

      const da = buffer.match(DEVICE_ATTRIBUTES_REGEX);
      result.supportsSixelGraphics = da?.[1]?.split(";").includes("4") ?? false;

      // Restore stdin to how Ink will expect to find it.
      try {
        stdin.setRawMode?.(wasRaw);
      } catch {
        // ignore
      }
      if (wasPaused) stdin.pause();

      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      // Primary-DA response arrives last -> use it as the completion sentinel.
      if (DEVICE_ATTRIBUTES_REGEX.test(buffer)) finish();
    };

    try {
      stdin.setRawMode(true);
    } catch {
      resolve(result);
      return;
    }
    stdin.on("data", onData);
    stdin.resume();

    const timer = setTimeout(finish, timeoutMs);

    // `\x1b[8m` (conceal) keeps any stray unmatched bytes invisible; reset after.
    stdout.write(
      `\x1b[8m${CELL_SIZE_QUERY}${KITTY_QUERY}${DEVICE_ATTRIBUTES_QUERY}\x1b[0m`,
    );
  });
}
