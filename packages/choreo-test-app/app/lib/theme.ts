import { tracked } from '@glimmer/tracking';

/**
 * The whole app's color scheme — every demo included, since they all draw
 * from the same `--bg`/`--ink`/`--line` ladder in app.css rather than
 * hardcoding their own colors.
 *
 * Dark is the default, full stop — it is the palette every demo was actually
 * designed against. Light is there for whoever wants it, remembered once
 * they pick it, but nothing here goes looking at the OS to decide for them.
 */
export type ThemeMode = 'dark' | 'light';

const KEY = 'choreo-theme';

class ThemeSettings {
  @tracked mode: ThemeMode = read();
}

function read(): ThemeMode {
  const stored =
    typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  return stored === 'light' ? 'light' : 'dark';
}

function apply(mode: ThemeMode) {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.setAttribute('data-theme', mode);
}

export const theme = new ThemeSettings();

// first paint already matches a stored choice
apply(theme.mode);

export function setThemeMode(mode: ThemeMode) {
  theme.mode = mode;
  // A view transition snapshots the page and crossfades bitmaps — but
  // `html`'s own background is deliberately EXCLUDED from that snapshot (see
  // app.css, `:root::view-transition`), so under the topbar's
  // `backdrop-filter` it hard-cut while everything else tried to fade,
  // which read as jank once the page was scrolled. Plain CSS transitions on
  // `html`/`.topbar` (see app.css) do not have that split: there is no
  // snapshot, just a live page whose colors ease from one value to the next.
  apply(mode);
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(KEY, mode);
}

export function toggleTheme() {
  setThemeMode(theme.mode === 'dark' ? 'light' : 'dark');
}
