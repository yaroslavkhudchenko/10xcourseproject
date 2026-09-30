// The themes a page can be drawn in and where the user's choice is kept, defined once for the layout's head script,
// which picks the theme before the first paint, and the theme switch, which stores the choice. Both run in the browser,
// so this module imports nothing.

/** The light theme: the `:root` values in src/styles/global.css, which a page gets with no class on `<html>`. */
export const LIGHT_THEME = "light";

/** The dark theme, and the class on `<html>` that switches global.css's `.dark` values on. */
export const DARK_THEME = "dark";

/** Every theme, each also a value the theme switch stores. */
export const THEMES = [LIGHT_THEME, DARK_THEME] as const;

/** One of the themes. */
export type Theme = (typeof THEMES)[number];

/**
 * The `localStorage` key under which the theme switch keeps the user's choice, one of THEMES. Without a stored choice,
 * the system's (`prefers-color-scheme`) decides.
 */
export const THEME_STORAGE_KEY = "theme";

/**
 * The event the layout's head script dispatches on `document` when it has switched the theme because the system's
 * changed while the page was open, so every theme switch on the page can say again whether the dark theme is on.
 */
export const THEME_CHANGE_EVENT = "drogeria:theme";
