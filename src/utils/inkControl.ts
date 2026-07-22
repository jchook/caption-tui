/**
 * A tiny bridge to the running Ink instance. index.ts stores `instance.clear`
 * here after render so code that isn't inside the React tree (e.g. the external
 * editor hook, which tears the screen down and rebuilds it) can force Ink to
 * repaint a full frame instead of diffing against a screen it no longer owns.
 */
export const inkControl: { clear?: () => void } = {};
