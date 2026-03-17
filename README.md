# caption-tui

A blazingly fast TUI for hand-captioning image datasets. Because your LoRA won't train itself.

![Ink](https://img.shields.io/badge/built%20with-Ink-blue)
![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1)
![License](https://img.shields.io/badge/license-MIT-green)

## Why?

You've got 500 images. Each needs tags. You *could* open each `.txt` file in vim like a caveman, or you could:

- See inline image previews (Kitty, iTerm2, Sixel, or fallback)
- Autocomplete from your existing tags
- Fly through images with keyboard shortcuts
- Never touch your mouse

## Install

Requires [Bun](https://bun.sh) >= 1.0.0

```bash
bun install -g caption-tui
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

---

*Now go caption those images. Your model is waiting.*
