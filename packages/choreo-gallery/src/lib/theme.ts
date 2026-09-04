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
export type ThemeMode = 'dark' | 'light';

const KEY = 'choreo-theme';

class ThemeSettings {
  @tracked mode: ThemeMode = read();
}

function read(): ThemeMode {
  try {
    const stored =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    // Sandboxed srcdoc frames intentionally omit allow-same-origin. Their
    // opaque origin exposes `localStorage` as a throwing accessor, not as an
    // absent global, so the isolated experience simply uses the dark default.
    return 'dark';
  }
}

export const theme = new ThemeSettings();

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

export function toggleTheme() {
  setThemeMode(theme.mode === 'dark' ? 'light' : 'dark');
}
