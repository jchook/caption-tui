# Making the demo

Two artefacts, made two different ways, because no single tool can produce both.

| File | Shows | Made by |
|---|---|---|
| `docs/demo.gif` | navigating, autocomplete, tag colours | VHS, from `docs/demo.tape` |
| `docs/preview-kitty.png` | the real kitty-protocol preview | a photograph of an actual kitty window |

```bash
just demo             # dataset (if missing) + build + record + optimise
just demo-screenshot  # the kitty still; needs X11
```

## Why the GIF cannot show the image preview properly

VHS renders through headless `ttyd` + xterm.js. xterm.js implements neither the
kitty graphics protocol nor sixel, so the preview in the GIF is always
ink-picture's half-block fallback. That looks fine — xterm.js is truecolor — but
it is not what a kitty user sees, which is why there is a separate still.

asciinema has the same limitation: `agg` will not render the APC image payloads
either, so piping a cast through it lands in the same place.

Worse, xterm.js *claims* sixel support: its primary device attributes come back
as `ESC[?62;4;9;22c`, and parameter `4` means sixel. The probe believes it, quite
correctly, and ink-picture then picks a renderer whose output xterm.js discards —
the pane sits on "Loading..." forever. The tape works around it by naming the
renderer outright:

```tape
Env CAPTION_TUI_PROTOCOL halfBlock
```

`CAPTION_TUI_PROTOCOL` takes any of ink-picture's protocol names
(`halfBlock`, `braille`, `ascii`, `sixel`, `iterm2`, `kitty`) and skips detection
entirely. It is worth knowing about outside the demo too: xterm.js is also what
VS Code's integrated terminal and Hyper are built on.

## Things that will waste an afternoon

**`Env` must come after every `Set`.** VHS reads settings only until the first
non-setting command. An `Env` line above the `Set` block makes VHS silently
ignore all of them — you get the default 1200x600, the default theme and a 22px
font, with no warning.

**The recording mutates the dataset.** caption-tui saves as you type, so the
tape's Tab-completions are written into the `.txt` files. On a second run those
tags are already on the caption, `getTagSuggestions` filters out tags a caption
already has, `por` completes to nothing, and the literal string `por` gets saved
instead. `just record` therefore copies `.demo/source` to `.demo/simpsons` first
and records against the copy. Never point the tape at `.demo/source`.

**`KITTY_WINDOW_ID` leaks into ttyd.** It survives into the child shell, and
caption-tui reads it as proof of a kitty terminal — a reasonable fallback for
when the escape-code probe is missed. The preview then renders as kitty Unicode
placeholders into xterm.js, which cannot resolve them, and you get a block of red
replacement glyphs. `just record` clears it along with `TMUX`, `STY` and
`TERM_PROGRAM`.

**VHS needs a real Chrome, not a launcher.** It drives headless Chrome through
go-rod, which takes the first `chrome` on `PATH`. A Flatpak or snap wrapper by
that name hands the URL to an already-running browser and exits, so rod never
gets a debug URL: `could not launch browser: Failed to get the debug url`. The
justfile puts a real binary first on `PATH` — rod's own cached Chromium under
`~/.cache/rod/browser` if there is one, otherwise it lets rod download one.
`VHS_BROWSER=/path/to/chrome just demo` overrides it.

**`Output` does not like some absolute paths.** VHS's parser rejects a leading
`/tmp/...`; keep output paths repo-relative.

## The dataset

`scripts/fetch-demo-dataset.ts` pulls 120 images from
[macadeliccc/simpsons-images](https://huggingface.co/datasets/macadeliccc/simpsons-images)
(Apache-2.0) through the Hugging Face datasets-server `rows` endpoint, which
returns plain JPEG URLs — no parquet reader, no Python, no `datasets` install.

Flat, saturated animation cels are the best case for terminal rendering, which is
the whole reason for the choice: galaxy photos come out as a grey smudge at
preview size and nature photography as beige-on-brown. Big shapes and hard edges
survive half-blocks.

The upstream captions are prose ("Close-up of Marge Simpson smiling happily,
with her left hand raised"), and tag mode wants comma-separated tags, so the
script reduces them through a keyword table. Nothing is invented — a tag is
written only when the real caption says so. Roughly a fifth of the images are
then left untagged and another quarter trimmed to one to three tags, because a
folder mid-captioning is what the tool is for, and it is what gives the list's
red/yellow/green counts something to say.

Everything is deterministic: fixed dataset, fixed shuffle seed. The tape presses
a fixed number of arrow keys and expects a particular image under the cursor, so
changing `DEMO_SEED` or `DEMO_COUNT` will desync it. Environment overrides:
`DEMO_DATASET`, `DEMO_COUNT`, `DEMO_SEED`, `DEMO_OUT`, `DEMO_PREFIX`.

## The kitty still

`just demo-screenshot` opens a fullscreen kitty running caption-tui, drives it
with `xdotool`, and captures the screen with `scrot`. Fullscreen rather than a
sized window because window managers are free to ignore size hints — a tiling WM
hands out whatever half of the screen is going, and `xdotool windowsize` gets
overruled a frame later — so a sized capture comes out a different shape on every
machine. `screenshot_font_size` in the justfile keeps the column count near the
GIF's; raise it on a display bigger than 1080p.

**Known bug, not yet fixed:** the preview does not always appear the first time
the editor opens. Navigating one image away and back brings it up. It is
reproducible with the harness above and is not an encoding problem — see
`docs/preview-bug.md`.

## Regenerating

The GIF is committed, and re-recording produces a byte-different file every time
even when nothing changed (frame timing jitter), so regenerate it deliberately
rather than on every push. `.github/workflows/demo.yml` only runs when the tape
or the dataset script changes.
