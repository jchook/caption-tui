#!/usr/bin/env bun

import { resolve } from "node:path";
import { render } from "ink";
import React from "react";
import { App } from "./src/App.js";
import { inkControl } from "./src/utils/inkControl.js";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`
caption-tui - Fast image captioning with autocomplete

Usage:
  caption-tui [--natural] <path-to-dataset>

Arguments:
  path-to-dataset   Path to folder containing images (.png, .jpg, .jpeg)
                    and their caption files (.txt)

Options:
  --natural, -n     Natural-language mode: edit free-form prose captions
                    instead of comma-separated tags.

Controls (list mode):
  ↑/↓ or j/k       Navigate image list
  Enter            Edit selected image's caption
  q                Quit

Controls (tag mode edit):
  Enter/Tab        Accept suggestion or add current tag
  ,                Finish current tag, start new one
  → (at end)       Accept inline suggestion
  ↑/↓              Prev/next image (or navigate suggestions if shown)
  Esc              Close editor (saves changes)

Controls (natural mode edit):
  Enter            Save and go to next image
  ↑/↓              Prev/next image
  ←/→              Move the cursor
  Ctrl-←/→         Move the cursor a word at a time (also Alt-←/→, Alt-b/f)
  Ctrl-A / Ctrl-E  Jump to start / end of line (also Home / End)
  Ctrl-W           Delete the word before the cursor
  Ctrl-G           Edit in $EDITOR (opens in a tmux split when inside tmux,
                   keeping the image preview visible; full-screen otherwise)
  Esc              Close editor (saves changes)

Captions are stored in {imagename}.txt files (comma-separated tags, or prose
in natural mode). Supports Kitty, iTerm2, Sixel, and fallback rendering for
inline image preview.
`);
  process.exit(0);
}

const mode: "tags" | "natural" = args.some(
  (a) => a === "--natural" || a === "-n",
)
  ? "natural"
  : "tags";

const positional = args.filter((a) => !a.startsWith("-"));
const datasetPath = resolve(positional[0] ?? ".");

// Take over the whole terminal using the alternate screen buffer. This keeps
// the TUI on its own scrollback-free screen so it never overwrites the user's
// previous shell output (and that output isn't jumbled when the list scrolls).
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";

let altScreenActive = false;

function enterAltScreen() {
  if (altScreenActive) return;
  process.stdout.write(ENTER_ALT_SCREEN);
  // Move the cursor home so the app renders from the top of the fresh screen.
  process.stdout.write("\x1b[H");
  altScreenActive = true;
}

function leaveAltScreen() {
  if (!altScreenActive) return;
  process.stdout.write(LEAVE_ALT_SCREEN);
  altScreenActive = false;
}

enterAltScreen();

// Restore the primary screen even if we exit abnormally, so the user's shell
// isn't left stuck on the alternate buffer.
process.on("exit", leaveAltScreen);

const instance = render(React.createElement(App, { datasetPath, mode }));
const { waitUntilExit } = instance;

// Expose a full-repaint hook for the external-editor handoff (Ctrl-G), which
// leaves and re-enters the alt screen and needs Ink to redraw from scratch.
inkControl.clear = instance.clear;

waitUntilExit()
  .catch(() => {})
  .finally(leaveAltScreen);
