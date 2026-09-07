# The kitty preview sometimes does not appear until you navigate

Open the editor on an image and the preview pane can come up empty. Move to the
next image and back and it appears. Reported from normal use; reproduced here
under instrumentation.

**Not fixed.** What follows is what has been measured, so the next attempt does
not start from zero.

## Reproducing

Needs X11 with `kitty`, `xdotool` and `scrot` (what `just demo-screenshot` uses).

```bash
just build
rm -rf .demo/simpsons && cp -r .demo/source .demo/simpsons
PATH="$PWD/.demo/bin:$PATH" kitty --class repro --start-as=fullscreen \
    --override font_size=24 --directory .demo -- caption-tui simpsons/ &
w=$(xdotool search --sync --onlyvisible --class repro | tail -1); sleep 4
xdotool key --window "$w" Return;  sleep 3; scrot -o /tmp/1-enter.png
xdotool key --window "$w" Escape;  sleep 1
xdotool key --window "$w" Return;  sleep 3; scrot -o /tmp/2-reenter.png
xdotool key --window "$w" --delay 200 Down Up; sleep 3; scrot -o /tmp/3-nav.png
```

Observed: `1-enter` has the image, `2-reenter` is blank, `3-nav` has it again.
With `Down Down Down` before the first `Return`, the *first* open is blank too.
So it is state-dependent, not simply "the first one".

## What has been ruled out

Each of these was tested against the failing case, not assumed.

- **The encoder.** The exact transmit and placeholder bytes the app emits for a
  failing frame — same image, same 35x19 grid, same image id — render correctly
  when written by a standalone script with no Ink involved. Grids of 12x6, 20x19
  and 35x19 all render side by side in one process.
- **The bytes on the wire.** Teeing `process.stdout` shows the failing frame
  contains one complete transmit (`a=T,U=1,i=1,c=35,r=19`, 109 chunks) followed
  by exactly 665 placeholder cells (35x19) prefixed `ESC[38;5;1m`, in that
  order, with no delete anywhere. The placeholder row payloads are **byte for
  byte identical** to those of a frame that renders correctly.
- **kitty accepting the image.** With `q=0` the terminal answers
  `ESC_Gi=1;OK ESC\` for the failing transmit. The image exists.
- **Timing.** Screenshots at 1s, 2s, 4s and 8s after the editor opens are all
  blank; it never resolves on its own. Inserting a 400ms delay between the
  transmit and `setPlacement` changes nothing.
- **Ink's incremental renderer.** `CAPTION_TUI_FULL_REPAINT=1` does not fix it,
  and with full repaints every subsequent frame re-emits the placeholder rows.
- **Synchronized output.** Ink 7 wraps frames in `ESC[?2026h` … `ESC[?2026l`.
  Placeholder rows written inside and outside that wrapper both render fine in
  isolation.
- **The image id.** Starting the id counter at 100 instead of 1 changes nothing.
- **Payload size.** A 490KB base64 payload over 121 chunks renders fine
  standalone, twice in a row, from one transmit.

## The one lead

Disabling the delete in the unmount cleanup of `KittyPlaceholderImage` made the
Escape-then-Enter case render. That is a single observation and the mechanism is
not understood: a byte trace of the same sequence shows `DELETE id=1` landing
*before* `TRANSMIT id=2`, which should be harmless, and deleting an image then
transmitting and displaying a new one works fine in isolation.

Worth knowing when chasing it: deleting an image immediately blanks any
placeholder cells still on screen that reference it. That makes end-of-run
screenshots misleading — capture at each step, not once at the end.

## Where to look next

The bytes are correct and kitty has the image, so the remaining variable is
kitty's screen state at the moment the cells are painted. Two things worth
trying: capture kitty's own debug log (`kitty --debug-keyboard`/`--debug-rendering`)
across a failing and a passing open, and re-check whether `RETIRE_GRACE_MS` and
the unmount delete can both fire against an id the screen is still referencing.
