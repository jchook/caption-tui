import { basename } from "node:path";

/**
 * How to invoke `$EDITOR` on a caption file.
 *
 * `$EDITOR` is a *command line*, not a program name -- `"nvim -u NONE"` and
 * `"code --wait"` are both legal -- so it is split on whitespace and the file
 * is appended last.
 */
export interface EditorCommand {
  command: string;
  args: string[];
}

/** $VISUAL/$EDITOR, falling back to a sensible terminal editor. */
export function resolveEditor(): string {
  return process.env.VISUAL || process.env.EDITOR || "nano";
}

/** Short name for the editor, for the "editing in ..." hint. */
export function editorName(editor: string): string {
  return basename(editor.split(/\s+/)[0] ?? editor);
}

const VIM_FAMILY = /^(n?vim|vi|view|gvim|vimx|nvim-qt)$/;

/**
 * Captions are one long line of prose, so a vim-family editor gets `set wrap`
 * on the way in. Vim wraps by default, but plenty of configs turn it off
 * globally for code -- and a caption that runs off the right edge is miserable
 * to edit. `-c` runs after the file is loaded, so it beats whatever the user's
 * vimrc did.
 *
 * Only the vim family gets it: `-c` means "run this command" to vim and
 * something else entirely (or nothing) to nano, emacs or helix.
 */
export function buildEditorCommand(
  editor: string,
  file: string,
): EditorCommand {
  const [command = "nano", ...args] = editor.split(/\s+/).filter(Boolean);

  if (VIM_FAMILY.test(basename(command))) {
    return { command, args: [...args, "-c", "set wrap", file] };
  }

  return { command, args: [...args, file] };
}

/** Single-quote `value` for /bin/sh. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The same command as one shell string, for `tmux split-window`, which takes a
 * shell command rather than an argv. Every word is quoted: caption files live
 * in a temp dir we name, but `$EDITOR` is the user's and may contain anything.
 */
export function toShellCommand({ command, args }: EditorCommand): string {
  return [command, ...args].map(shellQuote).join(" ");
}
