#!/usr/bin/env bun

import { resolve } from "node:path";
import { render } from "ink";
import React from "react";
import { App } from "./src/App.js";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`
caption-tui - Fast image captioning with autocomplete

Usage:
  caption-tui <path-to-dataset>

Arguments:
  path-to-dataset   Path to folder containing images (.png, .jpg, .jpeg)
                    and their caption files (.txt)

Controls (list mode):
  ↑/↓ or j/k       Navigate image list
  Enter            Edit selected image's caption
  q                Quit

Controls (edit mode):
  Enter/Tab        Accept suggestion or add current tag
  ,                Finish current tag, start new one
  → (at end)       Accept inline suggestion
  ↑/↓              Prev/next image (or navigate suggestions if shown)
  Esc              Close editor (saves changes)

Tags are stored in {imagename}.txt files as comma-separated values.
Supports Kitty, iTerm2, Sixel, and fallback rendering for inline image preview.
`);
  process.exit(0);
}

const datasetPath = resolve(args[0] ?? ".");

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

const { waitUntilExit } = render(React.createElement(App, { datasetPath }));

waitUntilExit()
  .catch(() => {})
  .finally(leaveAltScreen);
