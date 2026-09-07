# Demo recording for caption-tui.
#
#   just demo            end to end: dataset, build, record, optimise
#   just demo-dataset    (re)download the sample dataset
#   just demo-record     record only, reusing the dataset already on disk
#   just demo-optimise   shrink docs/demo.gif in place
#   just demo-clean      throw away .demo/
#
# Needs vhs, ttyd and gifsicle on PATH, plus a real Chrome/Chromium for VHS's
# headless renderer. See docs/demo.md.

set shell := ["bash", "-euo", "pipefail", "-c"]

alias demo-record := record
alias demo-optimise := optimise

demo_dir  := justfile_directory() / ".demo"
source    := demo_dir / "source"
stage     := demo_dir / "simpsons"
shim_dir  := demo_dir / "bin"
tape      := "docs/demo.tape"
gif       := "docs/demo.gif"
shot      := "docs/preview-kitty.png"

# Chosen so a fullscreen capture lands near the GIF's ~120 columns on a 1080p
# screen. Raise it on a larger display, or the text comes out unreadably small.
screenshot_font_size := "24"

_default:
    @just --list --unsorted

# Everything, in order.
demo: build _dataset-if-missing _shims record optimise
    @echo
    @echo "{{gif}}  $(du -h '{{gif}}' | cut -f1)"

# Compile dist/, which is what the recorded binary runs.
build:
    bun run build

# (Re)download the sample dataset from Hugging Face.
demo-dataset:
    # Deterministic: same images, same captions, same order every time, which is
    # what lets the tape count keypresses and land on a known row.
    bun scripts/fetch-demo-dataset.ts

_dataset-if-missing:
    @if [ ! -d '{{source}}' ] || [ -z "$(ls -A '{{source}}' 2>/dev/null)" ]; then \
        just demo-dataset; \
    else \
        echo "dataset present: $(ls '{{source}}'/*.jpg | wc -l) images (just demo-dataset to refresh)"; \
    fi

_shims:
    #!/usr/bin/env bash
    set -euo pipefail
    # Two shims, both only for the recording:
    #
    #   caption-tui  so the tape can `Require caption-tui` and type a bare
    #                command, with no global `bun link` and no polluted PATH.
    #
    #   chrome       VHS renders through headless Chrome driven by go-rod, and
    #                rod takes the first `chrome` on PATH. A Flatpak/snap
    #                launcher named `chrome` is a wrapper that hands the URL to
    #                an already-running browser and exits, so rod never gets a
    #                debug URL and recording fails with "Opening in existing
    #                browser session". A real binary first in PATH settles it.
    #                Override with VHS_BROWSER=/path/to/chrome.
    mkdir -p '{{shim_dir}}'

    node_bin="$(command -v node)"
    printf '#!/bin/sh\nexec %q %q "$@"\n' \
        "$node_bin" '{{justfile_directory()}}/dist/index.js' > '{{shim_dir}}/caption-tui'
    chmod +x '{{shim_dir}}/caption-tui'

    browser="${VHS_BROWSER:-}"
    if [ -z "$browser" ]; then
        # rod caches a known-good Chromium here after its first download.
        browser="$(ls -1 "${HOME}/.cache/rod/browser"/*/chrome 2>/dev/null | head -1 || true)"
    fi
    if [ -n "$browser" ]; then
        for name in chrome chromium google-chrome google-chrome-stable; do
            ln -sf "$browser" "{{shim_dir}}/$name"
        done
        echo "browser: $browser"
    else
        # Nothing cached yet. Hide any wrapper so rod downloads its own, once.
        rm -f '{{shim_dir}}'/chrome '{{shim_dir}}'/chromium \
              '{{shim_dir}}'/google-chrome '{{shim_dir}}'/google-chrome-stable
        echo "browser: none found, letting VHS download one into ~/.cache/rod"
    fi

# Record docs/demo.tape into docs/demo.gif.
record: _shims
    #!/usr/bin/env bash
    set -euo pipefail
    # KITTY_WINDOW_ID and friends are cleared because they survive into ttyd's
    # child shell. caption-tui reads them as proof of a kitty terminal -- a
    # reasonable fallback when the escape-code probe is missed -- and then draws
    # kitty Unicode placeholders into xterm.js, which cannot render them: the
    # preview comes out as a block of red replacement glyphs. A clean
    # environment gets the fallback renderer the tape is written for.
    if [ ! -d '{{source}}' ]; then
        echo "no dataset at {{source}} -- run: just demo-dataset" >&2
        exit 1
    fi

    # Record against a throwaway copy. caption-tui saves as you type, so the
    # tape's three Tab-completions land in the .txt files -- and on the next
    # run those tags are already on the caption, getTagSuggestions filters out
    # tags a caption already has, and "por" completes to nothing and gets
    # written literally. Recording twice in a row has to produce the same GIF.
    rm -rf '{{stage}}'
    cp -r '{{source}}' '{{stage}}'
    env -u KITTY_WINDOW_ID -u KITTY_LISTEN_ON -u KITTY_PID \
        -u TMUX -u TMUX_PANE -u STY \
        -u TERM_PROGRAM -u TERM_PROGRAM_VERSION \
        PATH="{{shim_dir}}:${PATH}" \
        vhs '{{tape}}'

# Shrink docs/demo.gif in place with gifsicle.
optimise:
    #!/usr/bin/env bash
    set -euo pipefail
    # VHS writes a full-colour palette per frame; a terminal recording needs
    # nowhere near that, and the README has to load on a phone.
    before=$(stat -c%s '{{gif}}')
    gifsicle -O3 --lossy=60 --colors 96 -o '{{gif}}.tmp' '{{gif}}'
    mv '{{gif}}.tmp' '{{gif}}'
    after=$(stat -c%s '{{gif}}')
    printf 'gifsicle: %s -> %s (%d%%)\n' \
        "$(numfmt --to=iec $before)" "$(numfmt --to=iec $after)" \
        "$(( after * 100 / before ))"

# Capture the real kitty-protocol preview as docs/preview-kitty.png.
demo-screenshot: build _dataset-if-missing _shims
    #!/usr/bin/env bash
    set -euo pipefail
    # The GIF can never show this. VHS renders through ttyd + xterm.js, which
    # implements neither the kitty graphics protocol nor sixel, so a recorded
    # preview is always the half-block fallback. The only way to show what a
    # kitty terminal actually draws is to photograph one, which means a real
    # window on a real display: kitty + xdotool + scrot, on X11.
    #
    # Fullscreen, not a sized window. Window managers are free to ignore size
    # hints -- a tiling WM here hands out whatever half of the screen is going,
    # and `xdotool windowsize` gets overruled a frame later -- so the capture
    # would come out a different shape on every machine. Fullscreen is the one
    # geometry every WM agrees to, and the font size below is what keeps the
    # column count near the GIF's regardless of screen resolution.
    #
    # A fullscreen window takes over the display for about eight seconds.
    for tool in kitty xdotool scrot; do
        command -v "$tool" >/dev/null || { echo "need $tool on PATH" >&2; exit 1; }
    done
    : "${DISPLAY:?no X display -- run this from a graphical session}"

    rm -rf '{{stage}}'
    cp -r '{{source}}' '{{stage}}'
    mkdir -p docs

    class=caption-tui-shot
    PATH='{{shim_dir}}':"$PATH" kitty \
        --class "$class" \
        --start-as=fullscreen \
        --override font_size={{screenshot_font_size}} \
        --override confirm_os_window_close=0 \
        --directory '{{demo_dir}}' \
        -- caption-tui simpsons/ &

    win=$(xdotool search --sync --onlyvisible --class "$class" | tail -1)
    trap 'xdotool windowkill "$win" 2>/dev/null || true' EXIT
    # Let the fullscreen transition finish before anything is typed. The preview
    # is transmitted for the geometry it was decoded at, and a resize underneath
    # it leaves the placeholder cells pointing at an image that is no longer
    # placed -- a blank pane in the capture.
    sleep 4

    # The same beats as the tape, so the still and the GIF show one story.
    xdotool key --window "$win" --delay 150 Down Down Down Return
    sleep 3
    # Then one image away and back. The preview does not reliably appear the
    # first time the editor opens -- navigating brings it up. That bug is not
    # fixed; see docs/preview-bug.md. Without this the capture comes out with
    # an empty preview pane, which is exactly what this file exists to show.
    xdotool key --window "$win" --delay 250 Down Up
    sleep 4

    scrot -o '{{shot}}'
    before=$(stat -c%s '{{shot}}')

    # A terminal screenshot is a few dozen flat colours plus one image; a full
    # 24-bit PNG of it is mostly wasted. Quantising to 128 colours with no
    # dithering is visually identical here and about a third of the size. Both
    # tools are optional -- the capture is already correct without them.
    if command -v ffmpeg >/dev/null; then
        pal=$(mktemp --suffix=.png)
        ffmpeg -v error -i '{{shot}}' -vf "palettegen=max_colors=128:stats_mode=full" -y "$pal"
        ffmpeg -v error -i '{{shot}}' -i "$pal" -lavfi "paletteuse=dither=none" -y '{{shot}}.tmp'
        mv '{{shot}}.tmp' '{{shot}}'
        rm -f "$pal"
    fi
    command -v optipng >/dev/null && optipng -quiet -o5 '{{shot}}' || true

    printf '%s  %s -> %s\n' '{{shot}}' \
        "$(numfmt --to=iec $before)" "$(numfmt --to=iec $(stat -c%s '{{shot}}'))"

# Throw away .demo/ (dataset, shims).
demo-clean:
    rm -rf '{{demo_dir}}'
