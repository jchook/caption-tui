# caption-tui

A fast TUI for captioning image datasets with tag autocomplete.

## Overview

CLI tool for managing image caption files (used for training image models). Given a folder of images, it provides a terminal UI to quickly add/edit captions in corresponding `.txt` files. Two caption modes:

- **Tag mode** (default): comma-separated keyword tags with tag autocomplete.
- **Natural mode** (`--natural`/`-n`): free-form prose captions with emacs/readline-style cursor editing (no autocomplete) and a Ctrl-G handoff to `$EDITOR`.

## Tech Stack

- **Toolchain**: **Bun** for everything in development — installs (`bun.lock`), running from source, and the test runner. **Node (>= 22)** is what ships: `bun run build` compiles `dist/` with a `node` shebang, so installing from the registry needs no Bun. `bun run test:node` runs the same suite under `node --test`, which is worth doing before a release; the tests are plain `node:test`/`node:assert` and run unmodified under both. Publishing goes through npm (`bun publish` does no provenance or trusted publishing). See [docs/bun.md](docs/bun.md) for why this moved off Bun once and back.
- **TUI Framework**: Ink (>= 7) + React for terminal UI. The version floor is not cosmetic — see [Frames are expensive](#frames-are-expensive-dont-repaint-what-didnt-change).
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
- `src/utils/deleteEntry.ts` - Which files a delete removes, trash vs. unlink
- `src/components/DeleteConfirm.tsx` - Shift-D confirmation bar
- `src/utils/kittyPlaceholder.ts` - Kitty graphics encoder (diacritics, transmit, tmux passthrough)
- `src/utils/terminalProbe.ts` - Startup probe for kitty/sixel support + cell pixel size
- `src/utils/inkControl.ts` - Bridge to the Ink instance's clear() for full repaints
- `src/utils/editorCommand.ts` - How $EDITOR is invoked (vim gets `set wrap`) + shell quoting
- `scripts/kitty-smoke-test.ts` - Standalone check that kitty graphics reach the terminal

## Install

Requires Node >= 22.

```bash
npm i -g caption-tui      # from the registry; ships as plain JS, no Bun needed
```

## Development

```bash
bun install               # deps (the prepare hook also builds dist/)
bun start <dataset>       # run from source, no build step
bun test                  # the suite, under Bun
bun run test:node         # the same suite under node --test
bun run build             # compile to dist/ (node-targeted, what ships)
bun run check             # biome format + lint, writing fixes
just demo                 # re-record docs/demo.gif (see docs/demo.md)
```

Local global binary — `caption-tui` runs the compiled `dist/`, so link it and keep
a watch build running for live edits:

```bash
bun link                  # once; symlinks caption-tui -> dist/index.js
bun run dev               # tsc --watch; recompiles dist/ on save
```

## Releasing

Published to npm as [`caption-tui`](https://www.npmjs.com/package/caption-tui).
The whole ritual is a version bump and a tag:

```bash
npm version patch        # or minor/major: commits, and tags it v1.0.1
git push --follow-tags
```

`.github/workflows/release.yml` fires on any `v*` tag: it checks the tag against
`package.json` (a mismatch aborts rather than publishing the wrong version under
a right-looking tag), runs lint + both test runners + the build, then
`npm publish --provenance`.

Auth is [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) --
GitHub mints an OIDC token that npm trades for short-lived publish rights, so
there is no `NPM_TOKEN` secret to leak or rotate. It needs `id-token: write` in
the workflow and a trusted publisher configured once under the package's
Settings on npmjs.com. That page only exists once the package does, so **the
very first publish has to be a manual `npm publish` from a logged-in machine**;
every release after that is tag-driven.

What ships is `dist/` only (`files` in package.json), built by the `prepare`
script, which both `bun install` and npm's pack/publish run. Three things to
keep true:

- **No `peerDependencies`.** npm auto-installs them, so listing `typescript`
  there put 3.6MB of compiler in every user's install for a CLI that ships
  compiled JS. `npm i -g caption-tui` went from 103MB to 72MB when it went.
- **Nothing in a publish lifecycle script may write to the working tree.**
  `prepack` used to run `biome check --write .`, which edits source files in the
  middle of a publish. Linting belongs in CI.
- **No `packageManager` field.** That is a Corepack field, and Corepack has no
  Bun support, so a `bun@x` value there is decorative at best and can make a
  Corepack-enabled npm refuse to run. The toolchain is documented here and
  pinned in the workflows instead.

CI packs the tarball, installs it into an empty project and runs the binary,
which is the only check that catches a file missing from `files`, a broken
shebang, or a dependency that only ever resolved because it was a
devDependency.

## Usage

```bash
caption-tui /path/to/dataset            # tag mode (default)
caption-tui --natural /path/to/dataset  # natural-language mode
```

## Controls

**List mode**: ↑↓/jk to navigate, PgDn/PgUp (or Ctrl-F/Ctrl-B) to page, Ctrl-D/Ctrl-U for half a page, g/G (or Home/End) for the ends of the list, Enter to edit, Shift-D to delete, q to quit

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

Two details worth keeping:

- **The caption editor stands down while $EDITOR has it.** In a tmux split our
  pane is still on screen right above the real editor, and drawing our own
  caption box next to it is just noise. `NaturalCaptionEditor` stays *mounted*
  (the handoff promise resolves into it -- unmounting would drop the save) but
  renders a one-line hint and ignores input, and App gives its rows to the image
  preview. `useExternalEditor(onOpenChange)` brackets the whole handoff.
- **vim-family editors are launched with `-c "set wrap"`** (see
  `src/utils/editorCommand.ts`). Vim wraps by default, but plenty of configs
  turn it off globally for code, and a caption is one long line of prose. `-c`
  runs after the file loads, so it beats the user's vimrc. Only vim/nvim/vi/etc.
  get it -- `-c` means something else entirely to nano and nothing to helix.
  `$EDITOR` is a command *line*, not a program name (`nvim -u NONE` is legal),
  so it is split on whitespace and every word is shell-quoted for the tmux pane.

## Frames are expensive; don't repaint what didn't change

Ink's standard renderer rewrites the *entire* frame every time anything changes:
`eraseLines(n)` then the whole screen again. Writes to a TTY are synchronous, so
on a link with any latency a frame that big stalls the event loop, which is what
turns held keys into one coalesced burst (above). Two things follow from that:

- **`incrementalRendering: true`** (set in `index.ts`). Only changed lines are
  written. Measured on a 120x40 terminal: **2362 -> 256 bytes** per row moved in
  the list, and **61674 -> 20863** per image change with the preview open. Just
  as important as the byte count: a frame that doesn't touch the preview now
  leaves the image's rows alone entirely instead of erasing and redrawing them,
  which is what made the preview flicker. It used to be off because per-line
  diffing desynced from the old kitty renderer's absolute-cursor drawing; that
  renderer is gone and the preview is ordinary text now.
  `CAPTION_TUI_FULL_REPAINT=1` goes back to whole-frame repaints.

  **This needs Ink >= 7.** Incremental rendering rewrites changed lines by
  walking the cursor from the bottom of the previous frame back up to the top,
  and our frames end with a newline -- App renders one row short of the terminal
  to stay off the fullscreen path, and Ink appends `"\n"` to anything that isn't
  fullscreen, which leaves the cursor one row *below* the block. Ink 6.8.0
  didn't account for that and moved up one row too few, so every line landed one
  row low: the highlighted first row of the list stuck at the top under a
  duplicate of itself, on every keypress. Ink 7 measures the walk from the raw
  line count and gets it right. `src/utils/inkIncrementalRenderer.test.ts`
  asserts the behaviour (not the version) against Ink's own log-update, so a
  future bump can't quietly reintroduce it.

  Both renderers were checked frame by frame, in the list and with the preview
  open, by replaying their output through a terminal emulator: on Ink 6, 34 of
  34 keypresses rendered differently; on Ink 7, 0 of 34.
- **`InkPictureProvider` is only mounted on the fallback path.** Mounting it
  regardless ran a second capability probe -- query escape codes written to the
  terminal, replies landing in Ink's stdin -- for a component the kitty path
  never renders. It also monkey-patches `stdin.push`, which under Bun left stdin
  unusable and hung the app on quit.

The preview has its own two rules, both in `KittyPlaceholderImage.tsx`:

- **Decoding is debounced (`TRANSMIT_DEBOUNCE_MS`).** Holding the down arrow
  changes `src` far faster than a PNG can be decoded, and each decode blocks the
  event loop for an image already scrolled past. Wait for the selection to
  settle; the previous image stays on screen meanwhile.
- **A replaced image is freed on a delay (`RETIRE_GRACE_MS`), never immediately.**
  The placeholder cells on screen still point at the old image until Ink paints
  the new ones. Deleting it the instant its successor was transmitted blanked
  the pane on every single move -- and inside tmux, where a passthrough escape
  code reaches the terminal ahead of the pane's queued redraw, that gap is wide
  enough to watch. Retired ids are flushed after the grace period and on unmount.

## Deleting images (Shift-D)

Shift-D on the list opens a confirmation bar (`src/components/DeleteConfirm.tsx`)
rather than deleting anything; the list's input is disabled while it is open.

**Anything rendered below the list has to be paid for out of the list's rows.**
The image list grows to fill the app box, so a sibling underneath it lands past
the app's `overflow: hidden`: invisible, but still mounted and taking input --
the delete worked with no dialog on screen. `deleteConfirmRows()` is exported
from the bar and called by both sides, so what App subtracts from `maxVisible`
cannot drift from what the bar draws. A dataset small enough to leave slack
hides this entirely, so the regression tests fill the terminal.

- Trashing goes through the [`trash`](https://github.com/sindresorhus/trash)
  package: a bundled binary on macOS/Windows (Finder trash / Recycle Bin) and
  the XDG spec on Linux. **It must be called with `{glob: false}`** -- globbing
  is its default, and a dataset file named `img[1].png` would otherwise be read
  as a pattern instead of a path. Files on another mount land in that mount's
  `.Trash-$UID`, not `~/.local/share/Trash`; that is the spec, not a bug.
- **Trashing never silently falls back to `unlink`.** If `trash()` throws, the
  bar shows the error and asks a second time for a deliberate `D` -- the user
  agreed to trash the file, which is a different promise from deleting it.
- The caption is only removed when nothing else points at it, so deleting one of
  `image1.jpg` / `image1.png` leaves the shared `image1.txt` for the survivor.

**Ink holds a lone Esc for 20ms** before emitting it, to tell it apart from the
start of an escape sequence (`pendingInputFlushDelayMilliseconds` in
`ink/build/components/App.js`). A test that writes Esc and waits less than that
sees no key at all, which reads as "the handler is broken" rather than "the test
is too fast" -- the `flush()` helpers are all above it for that reason.

Tests deliberately never confirm a trash: that would put files in the
developer's real trash. `DeleteConfirm.test.tsx` covers the keys against the
component, `deleteEntry.test.ts` covers file selection and the unlink path, and
`App.test.tsx` only opens and cancels the prompt.

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
bun scripts/kitty-smoke-test.ts [image]        # bypasses Ink entirely
CAPTION_TUI_DEBUG=1 caption-tui <dataset>      # logs probe + chosen renderer
CAPTION_TUI_FULL_REPAINT=1 caption-tui <ds>    # whole-frame repaints, not incremental
CAPTION_TUI_PROTOCOL=halfBlock caption-tui <ds> # skip detection, name the renderer
```

`CAPTION_TUI_PROTOCOL` takes any of ink-picture's protocol names -- `halfBlock`,
`braille`, `ascii`, `sixel`, `iterm2`, `kitty` -- and forces the ink-picture path
with that renderer, bypassing the probe (an unrecognised value is ignored). It
exists because a terminal can advertise a protocol it does not draw: xterm.js --
what VS Code's integrated terminal, Hyper and ttyd are built on -- always reports
`4` (sixel) in its primary device attributes. The probe believes it, quite
correctly, ink-picture picks sixel, and the pane sits on "Loading..." for ever.
`docs/demo.tape` sets it for exactly this reason.

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
