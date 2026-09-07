import { tracked } from '@glimmer/tracking';

/** Appearance preference; auto follows the operating system. */
export type ThemeMode = 'auto' | 'dark' | 'light';

const KEY = 'choreo-theme';

class ThemeSettings {
  @tracked mode: ThemeMode = read();
}

function read(): ThemeMode {
  const stored =
    typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  return stored === 'light' || stored === 'auto' ? stored : 'dark';
}

function apply(mode: ThemeMode) {
  if (typeof document === 'undefined') {
    return;
  }
  const resolved =
    mode === 'auto'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : mode;
  document.documentElement.setAttribute('data-theme', resolved);
}

export const theme = new ThemeSettings();

// first paint already matches a stored choice
apply(theme.mode);
if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => {
      if (theme.mode === 'auto') {
        apply('auto');
      }
    });
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) {
      theme.mode = read();
      apply(theme.mode);
    }
  });
}

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
