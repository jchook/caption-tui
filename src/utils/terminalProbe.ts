/**
 * Terminal graphics capability probe.
 *
 * Detects kitty/sixel support and the terminal's pixel cell size ourselves, once
 * at startup, before Ink takes over stdin -- then feeds the result into
 * `InkPictureProvider` as a `terminalInfo` override (overrides always win over the
 * library's own detection).
 *
 * Why not rely on ink-picture's built-in detection? It probes lazily from inside
 * the React render, competing with Ink for stdin, and in practice misses the
 * responses -- leaving graphics disabled and the cell size stuck at the 6x12
 * default, which makes kitty terminals fall back to the pixelated half-block
 * renderer. Probing up front, while we still fully own stdin, is reliable and also
 * gives us the true cell size (needed to size the image to the preview box).
 *
 * Reads responses via a plain `stdin` "data" listener -- the same mechanism Ink's
 * keyboard input relies on. Queries, in one batch:
 *   - CSI 16 t          -> cell size in pixels (`CSI 6 ; height ; width t`)
 *   - kitty graphics    -> `\x1b_Gi=<id>;OK\x1b\\` when supported
 *   - CSI c (primary DA) -> device attributes; contains `4` when sixel-capable,
 *                           and doubles as the end-of-response sentinel.
 */

export interface TerminalProbeResult {
  cellWidth?: number;
  cellHeight?: number;
  supportsKittyGraphics: boolean;
  supportsSixelGraphics: boolean;
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

  const result: TerminalProbeResult = {
    supportsKittyGraphics: false,
    supportsSixelGraphics: false,
  };

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
