import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEditorCommand,
  editorName,
  shellQuote,
  toShellCommand,
} from "./editorCommand.js";

test("vim-family editors are told to wrap", () => {
  for (const editor of ["vim", "nvim", "vi", "/usr/bin/nvim", "gvim"]) {
    const { args } = buildEditorCommand(editor, "/tmp/caption.txt");
    assert.deepEqual(
      args,
      ["-c", "set wrap", "/tmp/caption.txt"],
      `editor ${editor}`,
    );
  }
});

test("$EDITOR keeps its own arguments, with the file last", () => {
  assert.deepEqual(buildEditorCommand("nvim -u NONE", "/tmp/c.txt"), {
    command: "nvim",
    args: ["-u", "NONE", "-c", "set wrap", "/tmp/c.txt"],
  });
});

test("non-vim editors are left alone", () => {
  // `-c` is a vim command; to nano it is --set-cursor and to helix nothing at
  // all, so it must not leak into editors that never asked for it.
  for (const editor of ["nano", "emacs", "hx", "code --wait"]) {
    const { args } = buildEditorCommand(editor, "/tmp/c.txt");
    assert.ok(!args.includes("-c"), `editor ${editor} got a vim flag`);
    assert.equal(args.at(-1), "/tmp/c.txt");
  }
});

test("an unset editor falls back to nano", () => {
  assert.equal(buildEditorCommand("", "/tmp/c.txt").command, "nano");
});

test("the shell form quotes every word", () => {
  assert.equal(
    toShellCommand(buildEditorCommand("nvim", "/tmp/a caption.txt")),
    "'nvim' '-c' 'set wrap' '/tmp/a caption.txt'",
  );
});

test("shellQuote survives a single quote", () => {
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test("editorName strips the path and arguments", () => {
  assert.equal(editorName("/usr/local/bin/nvim -u NONE"), "nvim");
  assert.equal(editorName("nano"), "nano");
});
