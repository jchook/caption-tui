# Why not Bun

This project originally targeted **Bun** — a fast, batteries-included runtime +
test runner + package manager. It was aspirational and mostly pleasant, but the
terminal-graphics stack forced a move to **Node**. This doc records why, so the
decision doesn't get re-litigated.

## The concrete blocker

`ink-picture` detects terminal graphics support (kitty/sixel, pixel cell size) by
writing query escape sequences to the terminal and reading the replies back by
**monkey-patching `stdin.push`**. That interception is a Node readable-stream
implementation detail, and it never fires under Bun — Bun delivers TTY input
through a different path.

The result under Bun: every capability query silently returned nothing, so the app
concluded "no kitty support, default 6×12 cell size" and rendered images as the
**pixelated half-block fallback** instead of native kitty graphics.

That is symptomatic of the broader issue: Ink and ink-picture are **Node-first**
and lean on Node's TTY/stream internals. Staying on Bun meant maintaining
Bun-specific workarounds against libraries that never promised Bun support — not
worth it for a tool whose entire value is terminal rendering.

## What was *not* Bun's fault

For honesty: several of the nastier bugs we chased were **not** caused by Bun.
They're Ink and ink-picture behaviors that reproduce on Node too — Bun just made
them harder to diagnose. They were fixed with app-level changes:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Image flashes on, then vanishes | Ink treats a full-height app as "fullscreen" and repaints each frame with `ansiEscapes.clearTerminal`, which wipes the graphic | Render one row short of the terminal (`appRows = rows - 1`) so Ink stays on its standard render path |
| Text below the image corrupts (stacked borders, overlapping rows) | Ink's `incrementalRendering` per-line diffing desyncs from kitty's absolute-cursor, unclipped drawing | Use Ink's standard (non-incremental) renderer, which fully clears + rewrites changed frames |
| First-open pane stuck on "Loading…" | ink-picture's `"100%"` sizing depends on `measureElement`, which races to `0` on mount → decode skipped | Give `<Image>` explicit numeric `width`/`height` |
| Image overflows into the caption editor | kitty positions its graphic by absolute cursor math and ignores Ink's `overflow: hidden` | Draw the image one row shorter than its reserved pane |

None of these are graphics-protocol or Bun issues; they're the seams where Ink's
text renderer meets a terminal that draws bitmaps outside Ink's model. They were
far easier to reason about on Node, where the libraries behave the way their
authors intended.

## What we kept from the Bun era

`src/utils/terminalProbe.ts` — a startup capability probe — was born as a Bun
workaround but survived the migration on merit. It reads terminal replies via a
plain `stdin` `"data"` listener (which works everywhere) and runs **before Ink
takes over stdin**, which is simply more reliable than ink-picture's in-render
detection. It also gives us the true cell pixel size, needed to size the image to
the preview box.
