# Bun

This project started on **Bun**, moved to **Node** over a terminal-graphics
blocker, and has moved back to Bun for development now that the blocker is gone.
This doc records both halves so neither decision gets re-litigated from memory.

## Where it stands

- `pnpm start` and `pnpm test` run under **Bun** (`bun index.ts`, `bun test`).
  Bun runs the TypeScript directly, so there is no `tsx` in the loop.
- `pnpm test:node` still runs the same suite under `node --test`. The tests are
  plain `node:test` + `node:assert`, which Bun's runner executes as-is, so both
  paths exercise identical code.
- The **shipped** binary is still Node: `pnpm build` compiles to `dist/` with a
  `#!/usr/bin/env node` shebang, and `bin` points there. Anyone installing
  `caption-tui` from the registry gets a plain Node CLI and needs no Bun.
- Dependencies are still installed with **pnpm** (`pnpm-lock.yaml`). Bun is the
  runtime here, not the package manager; there is no reason to carry two
  lockfiles.

## Why it moved to Node in the first place

`ink-picture` detects terminal graphics support (kitty/sixel, pixel cell size) by
writing query escape sequences to the terminal and reading the replies back by
**monkey-patching `stdin.push`**. That interception is a Node readable-stream
implementation detail, and it never fired under Bun -- Bun delivers TTY input
through a different path.

The result under Bun: every capability query silently returned nothing, so the app
concluded "no kitty support, default 6x12 cell size" and rendered images as the
**pixelated half-block fallback** instead of native kitty graphics.

## Why that no longer applies

The app stopped depending on that detection, for reasons that had nothing to do
with Bun:

- `src/utils/terminalProbe.ts` does the detection itself, before Ink takes over
  stdin, using a plain `stdin` `"data"` listener. It was born as a Bun
  workaround and survived on merit -- it is simply more reliable than probing
  from inside a React render.
- When kitty is available the preview is `KittyPlaceholderImage`, which is our
  own code. `ink-picture` is only mounted on the fallback path now, so on a
  kitty terminal its detection never runs at all.

Verified before switching back, on Bun 1.4.0:

| Check | Result |
| --- | --- |
| Full suite under `bun test` | 96 pass, 0 fail -- same as `node --test` |
| Startup probe reading real terminal replies (fed a canned kitty/DA/cell-size response over a pty) | `supportsKittyGraphics: true`, cell size read from the reply, kitty renderer selected -- identical to Node |
| App in a pty: render, scroll, open the editor, quit | Byte-for-byte comparable output to Node, clean exit |

The one Bun-only failure found along the way was the app hanging on quit after
opening the preview -- and it was `InkPictureProvider`'s detection, patching
`stdin.push` and leaving stdin unusable. Not mounting the provider when we
aren't rendering its component fixes it, and is right on Node too: it was
writing capability queries to the terminal for a component that path never
renders.

## What was *not* Bun's fault

Several of the nastier bugs chased during the Bun era were **not** caused by
Bun. They are Ink and ink-picture behaviors that reproduce on Node too -- Bun
just made them harder to diagnose:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Image flashes on, then vanishes | Ink treats a full-height app as "fullscreen" and repaints each frame with `ansiEscapes.clearTerminal`, which wipes the graphic | Render one row short of the terminal (`appRows = rows - 1`) so Ink stays on its standard render path |
| Text below the image corrupts (stacked borders, overlapping rows) | Ink's `incrementalRendering` per-line diffing desyncing from kitty's absolute-cursor, unclipped drawing | Was: turn incremental rendering off. Now: the preview is placeholder *text*, nothing draws at absolute coordinates, and incremental rendering is back on |
| First-open pane stuck on "Loading..." | ink-picture's `"100%"` sizing depends on `measureElement`, which races to `0` on mount -> decode skipped | Give `<Image>` explicit numeric `width`/`height` |
| Image overflows into the caption editor | kitty positions its graphic by absolute cursor math and ignores Ink's `overflow: hidden` | Replaced entirely by Unicode placeholders, which Ink clips like any other text |

None of these were graphics-protocol or Bun issues; they were the seams where
Ink's text renderer met a terminal drawing bitmaps outside Ink's model.
