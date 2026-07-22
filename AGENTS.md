# caption-tui

A fast TUI for captioning image datasets with tag autocomplete.

## Overview

CLI tool for managing image caption files (used for training image models). Given a folder of images, it provides a terminal UI to quickly add/edit captions in corresponding `.txt` files. Two caption modes:

- **Tag mode** (default): comma-separated keyword tags with tag autocomplete.
- **Natural mode** (`--natural`/`-n`): free-form prose captions with per-word autocomplete drawn from the dataset's own vocabulary (common stopwords like "of"/"the" are never suggested).

## Tech Stack

- **Runtime**: Bun (use `bun` instead of `node`, `bun test` instead of jest, etc.)
- **TUI Framework**: Ink + React for terminal UI
- **Image Preview**: ink-picture (supports Kitty, iTerm2, Sixel, and fallback rendering)

## Key Files

- `index.ts` - CLI entry point
- `src/App.tsx` - Main app component with state management
- `src/components/ImageList.tsx` - Scrollable image list with color-coded tag/word counts
- `src/components/CaptionEditor.tsx` - Tag editor with autocomplete
- `src/components/NaturalCaptionEditor.tsx` - Prose editor with per-word autocomplete + $EDITOR handoff
- `src/hooks/useExternalEditor.ts` - Ctrl-G handoff to $EDITOR (tmux split or full-screen)
- `src/utils/dataset.ts` - Dataset loading, tag/prose parsing, autocomplete + stopwords
- `src/utils/inkControl.ts` - Bridge to the Ink instance's clear() for full repaints

## Install

Requires [Bun](https://bun.sh) >= 1.0.0

```bash
bun install -g caption-tui
```

## Usage

```bash
caption-tui /path/to/dataset            # tag mode (default)
caption-tui --natural /path/to/dataset  # natural-language mode
```

## Controls

**List mode**: ↑↓/jk to navigate, Enter to edit, q to quit

**Tag edit mode**: Enter/Tab to accept suggestion, comma to add tag, ↑↓ to navigate images, Esc to close

**Natural edit mode**: Tab/→ to complete the current word, Enter to save & go to next image, ↑↓ to navigate images (or suggestions while typing), ←/→ to move the cursor, Ctrl-G to edit in `$EDITOR`, Esc to close

### `$EDITOR` handoff (Ctrl-G)

In natural mode, Ctrl-G opens the caption in the user's `$VISUAL`/`$EDITOR` (real vim/nvim, their config). Implemented in `src/hooks/useExternalEditor.ts`:

- **Inside tmux** (`$TMUX` set): opens the editor in a `tmux split-window` below, so the image preview stays visible in the top pane. The main process stays on the event loop (async) and blocks on a `tmux wait-for` channel signaled when the editor pane closes.
- **Otherwise**: full-screen — drops raw mode, leaves the alt screen, runs the editor with inherited stdio, then re-enters the alt screen and calls `inkControl.clear()` (wired in `index.ts`) to force a full Ink repaint.

Editor content is normalized back to a single line (captions are single-line prose).

## Caption Format

**Tag mode** — `{imagename}.txt` holds comma-separated values with spaces:
```
person, portrait, outdoors, natural lighting
```

**Natural mode** — `{imagename}.txt` holds free-form prose:
```
A person in a portrait pose outdoors under natural lighting.
```

## ink-picture Gotcha

The Image component sizes itself to fit its container, not via its own props:

```tsx
// ✅ Works
<Box height={40} width="100%">
  <Image src={path} />
</Box>

// ❌ Doesn't work
<Image src={path} height={40} width={80} />
```
