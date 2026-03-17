#!/usr/bin/env bun

import React from "react";
import { render } from "ink";
import { App } from "./src/App.js";
import { resolve } from "node:path";

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

const datasetPath = resolve(args[0]!);

render(React.createElement(App, { datasetPath }));
