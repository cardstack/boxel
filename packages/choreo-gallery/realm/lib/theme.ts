import { tracked } from '@glimmer/tracking';

/**
 * The gallery's color scheme — every demo included, since they all draw from
 * the same `--bg`/`--ink`/`--line` ladder the gallery root declares rather
 * than hardcoding their own colors.
 *
 * Dark is the default: it is the palette every demo was designed against.
 * Light is there for whoever wants it, remembered once they pick it, but
 * nothing here goes looking at the OS to decide for them. The tracked value is
 * rendered on each gallery root's `data-theme`; the host document element
 * belongs to the host and is never touched.
 */
export type ThemeMode = 'auto' | 'dark' | 'light';

const KEY = 'choreo-theme';

class ThemeSettings {
  @tracked mode: ThemeMode = read();
  @tracked systemLight =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;

  get resolved(): 'dark' | 'light' {
    if (this.mode === 'auto') {
      return this.systemLight ? 'light' : 'dark';
    }
    return this.mode;
  }
}

function read(): ThemeMode {
  try {
    const stored =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return stored === 'light' || stored === 'auto' ? stored : 'dark';
  } catch {
    // Sandboxed srcdoc frames omit allow-same-origin. Their opaque origin
    // exposes `localStorage` as a throwing accessor, not as an absent global,
    // so the isolated experience simply uses the dark default.
    return 'dark';
  }
}

export const theme = new ThemeSettings();

if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', (event) => {
      theme.systemLight = event.matches;
    });
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) {
      theme.mode = read();
    }
  });
}

export function setThemeMode(mode: ThemeMode) {
  theme.mode = mode;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, mode);
    }
  } catch {
    // Persistence is optional inside an opaque-origin iframe. The tracked
    // in-memory mode still updates for the lifetime of that document.
  }
}
