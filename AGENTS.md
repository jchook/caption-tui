# caption-tui

A fast TUI for captioning image datasets with tag autocomplete.

## Overview

CLI tool for managing image caption files (used for training image models). Given a folder of images, it provides a terminal UI to quickly add/edit comma-separated tags in corresponding `.txt` files.

## Tech Stack

- **Runtime**: Bun (use `bun` instead of `node`, `bun test` instead of jest, etc.)
- **TUI Framework**: Ink + React for terminal UI
- **Image Preview**: ink-picture (supports Kitty, iTerm2, Sixel, and fallback rendering)

## Key Files

- `index.ts` - CLI entry point
- `src/App.tsx` - Main app component with state management
- `src/components/ImageList.tsx` - Scrollable image list with color-coded tag counts
- `src/components/CaptionEditor.tsx` - Tag editor with autocomplete
- `src/utils/dataset.ts` - Dataset loading, tag parsing, autocomplete logic

## Install

Requires [Bun](https://bun.sh) >= 1.0.0

```bash
bun install -g caption-tui
```

## Usage

```bash
caption-tui /path/to/dataset
```

## Controls

**List mode**: ↑↓/jk to navigate, Enter to edit, q to quit

**Edit mode**: Enter/Tab to accept suggestion, comma to add tag, ↑↓ to navigate images, Esc to close

## Caption Format

Tags are stored in `{imagename}.txt` as comma-separated values with spaces:
```
person, portrait, outdoors, natural lighting
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
