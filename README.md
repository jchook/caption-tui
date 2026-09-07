# caption-tui

A keyboard-driven TUI for captioning image datasets.

![Ink](https://img.shields.io/badge/built%20with-Ink-blue)
![Node](https://img.shields.io/badge/runtime-Node-339933)
![License](https://img.shields.io/badge/license-MIT-green)

![caption-tui demo](docs/demo.gif)

## Why?

Speed up the workflow for manually captioning image datasets.

- Inline image previews (Kitty, iTerm2, Sixel, or fallback)
- Autocomplete from your existing tags
- Move between images with keyboard shortcuts
- Stays in the terminal — no mouse, no context switch

## Install

Requires [Node](https://nodejs.org) >= 22.

```bash
npm i -g caption-tui     # or: bun add -g caption-tui
```

## Usage

Open a folder of images:

```bash
caption-tui ./my-dataset
```

Your folder will look like:
```
my-dataset/
├── image001.png
├── image001.txt    # "person, portrait, looking at viewer"
├── image002.jpg
├── image002.txt    # "landscape, sunset, orange sky"
└── ...
```

## Controls

### List Mode

| Key | Action |
|-----|--------|
| `↑` `↓` or `j` `k` | Navigate |
| `PgDn` `PgUp` or `Ctrl-F` `Ctrl-B` | Page down/up |
| `Ctrl-D` `Ctrl-U` | Half page down/up |
| `g` `G` or `Home` `End` | Jump to first/last image |
| `Enter` | Edit caption |
| `Shift-D` | Delete image (asks first; moves to trash) |
| `q` | Quit |

### Edit Mode

| Key | Action |
|-----|--------|
| `Enter` / `Tab` | Accept suggestion or add tag |
| `,` | Finish tag, start new one |
| `→` | Accept inline suggestion |
| `↑` `↓` | Previous/next image |
| `Esc` | Close editor (auto-saves) |
| `Ctrl-g` | Open the caption in `$EDITOR` |

## Features

**Color-coded tag counts** — Red (0 tags), Yellow (1-3), Green (4+). Spot the stragglers instantly.

**Smart autocomplete** — Learns from your existing tags. Type `por` and hit Tab to complete `portrait`.

**Inline image preview** — See what you're tagging without leaving the terminal. Supports sixel.

**Auto-save** — Changes save immediately. No "did I save that?" anxiety.

## Caption Format

By default, tags are comma-separated with spaces, the standard format for training:

```
person, portrait, outdoors, natural lighting, looking at viewer
```

The tool also supports natural language captioning via `-n`.

## Tips

- Start with broad tags, get specific as you go
- Use consistent terminology across your dataset
- The autocomplete gets better as you add more tags


## License

MIT
