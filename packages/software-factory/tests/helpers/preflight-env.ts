import { playwrightBrowsersRoot } from '../../src/preflight.ts';

/**
 * Extra child env for tests that spawn `factory:go` with a relocated `HOME`.
 *
 * Those tests move `HOME` to isolate the boxel profile, but preflight resolves
 * the Playwright browser cache from `HOME` as well — under a temp home it finds
 * no `chromium_headless_shell-*` build and refuses to run the factory at all.
 * Installing browsers in CI does not help: they are installed, just not under
 * the temp home. Spreading this after the `HOME` override pins the child to the
 * cache the test process itself resolves, so only the profile is isolated.
 *
 * Empty when `playwrightBrowsersRoot()` is undefined, which happens only under
 * `PLAYWRIGHT_BROWSERS_PATH=0` — a value the inherited env already carries
 * through, and one preflight treats as "assume present" anyway.
 */
const root = playwrightBrowsersRoot();

export const playwrightBrowsersEnv: Record<string, string> = root
  ? { PLAYWRIGHT_BROWSERS_PATH: root }
  : {};
