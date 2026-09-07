import { tracked } from '@glimmer/tracking';

/**
 * The whole app's color scheme — every demo included, since they all draw
 * from the same `--bg`/`--ink`/`--line` ladder in app.css rather than
 * hardcoding their own colors.
 *
 * Dark is the default, full stop — it is the palette every demo was actually
 * designed against. Light is there for whoever wants it, remembered once
 * they pick it, but nothing here goes looking at the OS to decide for them.
 * The tracked value is rendered on the gallery's `.choreo-site` boundary;
 * it must never mutate the host document element because Boxel owns that.
 */
export type ThemeMode = 'auto' | 'dark' | 'light';

const KEY = 'choreo-theme';
let darkScopes = 0;

class ThemeSettings {
  @tracked mode: ThemeMode = read();
  @tracked systemLight =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  get resolved(): 'dark' | 'light' {
    return darkScopes
      ? 'dark'
      : this.mode === 'auto'
        ? this.systemLight
          ? 'light'
          : 'dark'
        : this.mode;
  }
}

function read(): ThemeMode {
  try {
    const stored =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return stored === 'light' || stored === 'auto' ? stored : 'dark';
  } catch {
    // Sandboxed srcdoc frames intentionally omit allow-same-origin. Their
    // opaque origin exposes `localStorage` as a throwing accessor, not as an
    // absent global, so the isolated experience simply uses the dark default.
    return 'dark';
  }
}

export const theme = new ThemeSettings();
function apply() {
  if (typeof document !== 'undefined') {
    document
      .querySelectorAll('.choreo-site')
      .forEach((root) => root.setAttribute('data-theme', theme.resolved));
  }
}
if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', (event) => {
      theme.systemLight = event.matches;
      apply();
    });
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) {
      theme.mode = read();
      apply();
    }
  });
}
/** Scope gallery presentation to the Boxel mount, never the host document. */
export function forceDarkTheme() {
  darkScopes++;
  apply();
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    darkScopes--;
    apply();
  };
}

export function setThemeMode(mode: ThemeMode) {
  theme.mode = mode;
  apply();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, mode);
    }
  } catch {
    // Persistence is optional inside an opaque-origin iframe. The tracked
    // in-memory mode still updates for the lifetime of that document.
  }
}

export function toggleTheme() {
  setThemeMode(theme.mode === 'dark' ? 'light' : 'dark');
}
