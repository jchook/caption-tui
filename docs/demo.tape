# caption-tui demo -- rendered by VHS (https://github.com/charmbracelet/vhs).
#
#   just demo          fetch dataset if missing, build, record, optimize
#
# The dataset is generated deterministically by scripts/fetch-demo-dataset.ts,
# so the row this tape lands on after `Down 5` is always the same untagged
# image. Change DEMO_SEED or DEMO_COUNT and the key counts below stop lining up.
#
# VHS renders through headless ttyd + xterm.js, which speaks neither the kitty
# graphics protocol nor sixel, so the preview here is the half-block fallback.
# The real kitty rendering is a static screenshot -- see docs/demo.md.
#
# `just record` stages a throwaway copy of the dataset, because caption-tui
# saves as you type and a second run would otherwise start from the first run's
# captions.

Require caption-tui

Output docs/demo.gif


Set Shell bash
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 16
Set Width 1200
Set Height 700
Set Padding 20
Set Framerate 24
Set TypingSpeed 60ms
Set WaitTimeout 30s

Set Theme { "name": "gruvbox-jchook", "background": "#262626", "foreground": "#dab997", "cursor": "#dab997", "cursorAccent": "#262626", "selectionBackground": "#dab997", "black": "#262626", "brightBlack": "#8a8a8a", "red": "#d75f5f", "brightRed": "#d75f5f", "green": "#afaf00", "brightGreen": "#afaf00", "yellow": "#ffaf00", "brightYellow": "#ffaf00", "blue": "#83adad", "brightBlue": "#83adad", "purple": "#d485ad", "brightPurple": "#d485ad", "cyan": "#85ad85", "brightCyan": "#85ad85", "white": "#dab997", "brightWhite": "#ebdbb2" }

# xterm.js (what ttyd renders into) advertises sixel in its device attributes
# but draws none of it, so leaving detection to run parks the preview pane on
# "Loading..." forever. Name the renderer instead.
#
# This has to sit after every `Set`: VHS only reads settings until the first
# non-setting command, and an `Env` above them makes it silently drop the lot
# (default 1200x600, default theme, default 22px font).
Env CAPTION_TUI_PROTOCOL halfBlock


# Setup, off camera.
Hide
Type "cd .demo && clear"
Enter
Show

# 120 real images from a Hugging Face dataset, most of them already captioned.
Type "caption-tui simpsons/"
Enter
Sleep 2500ms

# Move down the list. Tag counts are colour-coded: red none, yellow 1-3,
# green 4 or more.
Down@450ms 3
Sleep 1200ms

# Enter opens the editor, and the preview comes with it.
Enter
Sleep 1500ms

# Arrows keep working in the editor, so the preview follows the selection.
# Two rows down is simpsons_0006, which has no caption at all.
Down@800ms 2
Sleep 1500ms

# Autocomplete is built from the tags already in the folder -- type a prefix,
# Tab takes the suggestion.
Type "por"
Sleep 800ms
Tab
Sleep 600ms

Type "hom"
Sleep 800ms
Tab
Sleep 600ms

Type "liv"
Sleep 800ms
Tab
Sleep 600ms

Type "cart"
Sleep 800ms
Tab
Sleep 900ms

# Esc closes the editor and saves. Four tags now, so the row is green.
Escape
Sleep 2s

# G and g jump to the ends of the list.
Type "G"
Sleep 1500ms
Type "g"
Sleep 1200ms

Type "q"
Sleep 800ms
