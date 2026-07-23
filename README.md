# caption-tui

A keyboard-driven TUI for captioning image datasets — tag a whole folder from the terminal, without opening files one at a time.

![Ink](https://img.shields.io/badge/built%20with-Ink-blue)
![Node](https://img.shields.io/badge/runtime-Node-339933)
![License](https://img.shields.io/badge/license-MIT-green)

## Why?

You've got 500 images, each needing a `.txt` of tags. Instead of opening every file by hand, do the whole folder from one view:

- Inline image previews (Kitty, iTerm2, Sixel, or fallback)
- Autocomplete from your existing tags
- Move between images with keyboard shortcuts
- Stays in the terminal — no mouse, no context switch

## Install

Requires [Node](https://nodejs.org) >= 22

```bash
pnpm add -g caption-tui
```

## Usage

Point it at a folder of images:

```bash
caption-tui ./my-dataset
```

Your folder should look like:
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
| `Enter` | Edit caption |
| `q` | Quit |

### Edit Mode
| Key | Action |
|-----|--------|
| `Enter` / `Tab` | Accept suggestion or add tag |
| `,` | Finish tag, start new one |
| `→` | Accept inline suggestion |
| `↑` `↓` | Previous/next image |
| `Esc` | Close editor (auto-saves) |

## Features

**Color-coded tag counts** — Red (0 tags), Yellow (1-3), Green (4+). Spot the stragglers instantly.

**Smart autocomplete** — Learns from your existing tags. Type `por` and hit Tab to complete `portrait`.

**Inline image preview** — See what you're tagging without leaving the terminal. Works best in Kitty.

**Auto-save** — Changes save immediately. No "did I save that?" anxiety.

## Caption Format

Tags are comma-separated with spaces, the standard format for training:

```
person, portrait, outdoors, natural lighting, looking at viewer
```

## Tips

- Start with broad tags, get specific as you go
- Use consistent terminology across your dataset
- The autocomplete gets better as you add more tags

## License

MIT
