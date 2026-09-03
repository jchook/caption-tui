# caption-tui

A fast TUI for captioning image datasets with tag autocomplete.

## Overview

CLI tool for managing image caption files (used for training image models). Given a folder of images, it provides a terminal UI to quickly add/edit captions in corresponding `.txt` files. Two caption modes:

- **Tag mode** (default): comma-separated keyword tags with tag autocomplete.
- **Natural mode** (`--natural`/`-n`): free-form prose captions with emacs/readline-style cursor editing (no autocomplete) and a Ctrl-G handoff to `$EDITOR`.

## Tech Stack

- **Runtime**: Node (>= 22), managed with **pnpm**. Run TS directly in dev with `tsx` (`pnpm start` → `tsx index.ts`); ship a compiled `dist/` build (`pnpm build` → `tsc -p tsconfig.build.json`). Tests use the built-in Node test runner (`pnpm test` → `node --import tsx --test`).
- **TUI Framework**: Ink + React for terminal UI
- **Image Preview**: two renderers, chosen by the startup probe in `src/utils/terminalProbe.ts` — our own kitty Unicode-placeholder component when kitty is reachable, otherwise ink-picture's text-based protocols (half-block/braille/ascii). See [Image Preview Architecture](#image-preview-architecture).

## Key Files

- `index.ts` - CLI entry point
- `src/App.tsx` - Main app component with state management
- `src/components/ImageList.tsx` - Scrollable image list with color-coded tag/word counts
- `src/components/CaptionEditor.tsx` - Tag editor with autocomplete
- `src/components/NaturalCaptionEditor.tsx` - Prose editor (emacs-style keys) + $EDITOR handoff
- `src/components/KittyPlaceholderImage.tsx` - Preview via kitty Unicode placeholders
- `src/hooks/useExternalEditor.ts` - Ctrl-G handoff to $EDITOR (tmux split or full-screen)
- `src/utils/dataset.ts` - Dataset loading, tag/prose parsing, tag autocomplete
- `src/utils/textNav.ts` - Word-wise cursor movement / deletion for the prose editor
- `src/utils/listViewport.ts` - List scroll window + per-character navigation steps
- `src/utils/kittyPlaceholder.ts` - Kitty graphics encoder (diacritics, transmit, tmux passthrough)
- `src/utils/terminalProbe.ts` - Startup probe for kitty/sixel support + cell pixel size
- `src/utils/inkControl.ts` - Bridge to the Ink instance's clear() for full repaints
- `scripts/kitty-smoke-test.ts` - Standalone check that kitty graphics reach the terminal

## Install

Requires Node >= 22. `pnpm` is the default, but `npm` works — swap `pnpm` → `npm`
(prefix scripts with `run`, e.g. `npm run dev`).

```bash
pnpm add -g caption-tui   # from the registry
```

## Development

```bash
pnpm install              # deps (prepare hook also builds dist/)
pnpm start <dataset>      # run from source via tsx, no build
pnpm test                 # node --test
pnpm build                # compile to dist/
```

Local global binary — `caption-tui` runs the compiled `dist/`, so link it and keep
a watch build running for live edits:

```bash
pnpm link --global        # once; symlinks caption-tui -> dist/index.js (npm: `npm link`)
pnpm dev                  # tsc --watch; recompiles dist/ on save
```

## Usage

```bash
caption-tui /path/to/dataset            # tag mode (default)
caption-tui --natural /path/to/dataset  # natural-language mode
```

## Controls

**List mode**: ↑↓/jk to navigate, PgDn/PgUp (or Ctrl-F/Ctrl-B) to page, Ctrl-D/Ctrl-U for half a page, g/G (or Home/End) for the ends of the list, Enter to edit, q to quit

**Tag edit mode**: Enter/Tab to accept suggestion, comma to add tag, ↑↓ to navigate images, Esc to close

**Natural edit mode**: Enter to save & go to next image, ↑↓ to navigate images, ←/→ to move the cursor (Ctrl-←/→, Alt-←/→, Alt-b/f for word jumps), Ctrl-A/Ctrl-E or Home/End for start/end of line, Ctrl-W to delete the previous word, Ctrl-G to edit in `$EDITOR`, Esc to close. The cursor is an inverse block over the current character. Cursor/word helpers live in `src/utils/textNav.ts`.

### Input arrives in bursts, not keypresses

Every input handler in this app has to cope with more than one keypress per
event, and this has bitten the codebase three times now (fast typing dropping
characters, list scrolling crawling over SSH). The mechanism:

- Ink's parser (`ink/build/input-parser.js`) splits a stdin chunk on escape
  sequences only. **A run of ordinary characters is emitted as ONE event** --
  the same path a paste takes. Holding `j` delivers `useInput("jjjjjjj", {})`,
  so `input === "j"` never matches and the whole burst is silently dropped.
  A run of raw control bytes behaves the same way, and arrives with no `ctrl`
  flag set (a *lone* Ctrl-D is instead reported as `{ctrl: true, input: "d"}`).
- Escape-sequence keys (arrows, Page keys) do get one event each, but Ink
  dispatches every event in a chunk synchronously inside a single
  `reconciler.batchedUpdates`. **No re-render happens between them**, so any
  handler deriving its next value from a prop or from `useState` state reads the
  value from before the burst began, and N presses collapse into one.

Over SSH this is self-amplifying: `process.stdout` writes to a TTY are
synchronous, so a frame write that blocks on the ssh channel stalls the event
loop, key repeats pile into one chunk, and the whole chunk then moves the
cursor a single row (or nowhere at all).

So: read the freshest value from a ref that is advanced synchronously (not from
props/state, and not from inside a `setState` updater -- React only evaluates
those eagerly when its queue is empty, which is false for the second update in a
batch), and treat `input` as a *string of keys* to walk, not a single key.
`navStep()` in `src/utils/listViewport.ts` is the per-character step for the
list; the editors split their run on `,` / `\r` / `\n`. Regression tests live in
`src/components/ImageList.test.tsx` and both editor test files -- they write a
whole burst as one `stdin.write()`.

### `$EDITOR` handoff (Ctrl-G)

In natural mode, Ctrl-G opens the caption in the user's `$VISUAL`/`$EDITOR` (real vim/nvim, their config). Implemented in `src/hooks/useExternalEditor.ts`:

- **Inside tmux** (`$TMUX` set): opens the editor in a `tmux split-window` below, so the image preview stays visible in the top pane. The main process stays on the event loop (async) and blocks on a `tmux wait-for` channel signaled when the editor pane closes.
- **Otherwise**: full-screen — drops raw mode, leaves the alt screen, runs the editor with inherited stdio, then re-enters the alt screen and calls `inkControl.clear()` (wired in `index.ts`) to force a full Ink repaint.

Editor content is normalized back to a single line (captions are single-line prose).

## Duplicate basenames share a caption file

`image1.jpg` and `image1.png` in one folder both resolve to a single
`image1.txt`, so they are two rows over one caption. `loadDataset` qualifies
those rows with their extension (`image1.jpg`, not `image1`) so the collision is
visible, and a save refreshes **every** entry pointing at the file it wrote.
Keying that update off one `captionPath` match instead lands it on the first of
the pair: the row being edited keeps its old text, the editor resets to that
stale text on the next render, and the following save reverts the file. Covered
by `src/App.test.tsx` and `src/utils/dataset.test.ts`.

## Caption Format

**Tag mode** — `{imagename}.txt` holds comma-separated values with spaces:
```
person, portrait, outdoors, natural lighting
```

**Natural mode** — `{imagename}.txt` holds free-form prose:
```
A person in a portrait pose outdoors under natural lighting.
```

## Image Preview Architecture

Two renderers, picked by `probeTerminal()` at startup:

1. **kitty Unicode placeholders** (`KittyPlaceholderImage`) whenever kitty is reachable.
2. **ink-picture** for everything else — half-block/braille/ascii.

### Why we don't use ink-picture's kitty renderer

ink-picture's `KittyImage` uses *direct placement*: it saves the cursor, walks it
to absolute screen coordinates, emits `a=p,C=1`, then restores. The image is
pinned to screen coordinates and invisible to Ink's layout, so it isn't clipped
by `overflow: hidden`, doesn't move when the frame is rewritten, and is wiped by
any full-screen erase. **It also cannot work inside tmux at all** — tmux does not
implement the kitty graphics protocol, and ink-picture does not wrap its escape
codes for passthrough.

This caused years of symptoms (flashing/vanishing previews, images painting over
the editor, blank panes in tmux) and a stack of workarounds — repaint timers,
`getVisibility` overrides, rendering the preview one row short. All of that is
now deleted.

### How Unicode placeholders work

This is kitty's documented mechanism for exactly this problem (kitty ≥ 0.28,
`graphics-protocol.rst` § "Unicode placeholders"): images displayed inside host
applications that know nothing about the graphics protocol, *including tmux*.

1. Transmit the PNG in quiet mode (`q=2`) and create a **virtual** placement
   (`a=T,U=1,i=<id>,c=<cols>,r=<rows>`). Virtual placements are invisible
   prototypes with no screen position.
2. Render ordinary text: a grid of `U+10EEEE` cells whose combining diacritics
   encode each cell's (row, column), with the image ID in the foreground color.

The preview is then **just text**, so Ink lays it out, clips it, and repaints it
like any other component. Nothing touches the cursor.

Two non-obvious constraints, both enforced by tests:

- **Image IDs are 8-bit, sent as `ESC[38;5;<id>m`** — not 24-bit truecolor.
  Under `TERM=screen-256color`, tmux downgrades truecolor to the nearest palette
  entry unless it advertises `RGB`/`Tc`, which would silently rewrite the image
  ID and leave placeholders pointing at nothing.
- **Every cell carries explicit row *and* column diacritics.** Kitty allows
  omitting them and inheriting from the cell to the left, but Ink repaints
  arbitrary line fragments, so a cell may be redrawn without its left neighbor.

### tmux requirement

Inside tmux, graphics escape codes are wrapped as `ESC Ptmux; … ESC \` with every
inner `ESC` doubled. tmux only forwards these when passthrough is enabled:

```bash
tmux set -g allow-passthrough on          # add to ~/.tmux.conf to persist
```

Without it the app falls back to text rendering and shows a one-line hint rather
than failing silently. Detection inside tmux does **not** use escape codes (the
query never round-trips); it asks tmux directly via `client_termname` and
`client_cell_width`/`client_cell_height`, which also stay correct across
detach/reattach to a different terminal.

### Debugging

```bash
pnpm tsx scripts/kitty-smoke-test.ts [image]   # bypasses Ink entirely
CAPTION_TUI_DEBUG=1 caption-tui <dataset>      # logs probe + chosen renderer
```

The smoke test prints the placeholder grid with plain `console.log`, so if it
works but the TUI doesn't, the bug is in the Ink layer, not the protocol.

## ink-picture Gotcha

Applies to the fallback path only. The Image component sizes itself to fit its
container, not via its own props:

```tsx
// ✅ Works
<Box height={40} width="100%">
  <Image src={path} />
</Box>

// ❌ Doesn't work
<Image src={path} height={40} width={80} />
```
