// Prerequisite detection for `pnpm factory:go`.
//
// A fresh `pnpm install`-only checkout is missing several build artifacts and
// tool binaries that the factory needs, and historically each surfaced as a
// separate opaque crash from deep inside a run (CS-12186). This module detects
// all of them up front so the entrypoint can fail once with a single
// actionable message, and so `pnpm factory:setup` can provision them.
//
// It deliberately imports nothing from `@cardstack/boxel-cli` — one of the
// prerequisites it checks for is boxel-cli's own `dist/api.js`, so importing it
// here would defeat the purpose (the import would crash before the check runs).

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MIN_NODE_MAJOR = 24;
// Matches `.nvmrc` and root package.json `devEngines.runtime`.
export const PINNED_NODE = '24.17.0';

export interface Prerequisite {
  id: 'node' | 'boxel-cli-api' | 'host-dist' | 'playwright-chromium';
  label: string;
  satisfied: boolean;
  /** The single command that provisions this prerequisite on its own. */
  fix: string;
}

// This file lives at packages/software-factory/src/preflight.ts.
export function packageRoot(): string {
  return join(import.meta.dirname, '..');
}

function packagesDir(): string {
  return join(packageRoot(), '..');
}

export function repoRoot(): string {
  return join(packagesDir(), '..');
}

/** boxel-cli's bundled `@cardstack/boxel-cli/api` entry (built by `build:api`). */
export function boxelCliApiJsPath(): string {
  return join(packagesDir(), 'boxel-cli', 'dist', 'api.js');
}

/**
 * The host test-harness entry `boxel test` loads. Only a dev-mode host build
 * (`pnpm --filter @cardstack/host build`, i.e. `vite build --mode=development`)
 * emits it; a production build does not.
 */
export function hostTestHarnessPath(): string {
  return join(packagesDir(), 'host', 'dist', 'tests', 'index.html');
}

export function nodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split('.')[0]!, 10);
}

export function isNodeVersionOk(): boolean {
  return nodeMajorVersion() >= MIN_NODE_MAJOR;
}

export function boxelCliApiJsExists(): boolean {
  return existsSync(boxelCliApiJsPath());
}

export function hostTestHarnessExists(): boolean {
  return existsSync(hostTestHarnessPath());
}

export function playwrightBrowsersRoot(): string | undefined {
  let configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  // '0' stores browsers inside node_modules rather than a shared cache; locating
  // them reliably there is not worth the complexity, so don't block on it.
  if (configured === '0') return undefined;
  if (configured) return configured;

  let home = homedir();
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Caches', 'ms-playwright');
    case 'win32':
      return join(
        process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'),
        'ms-playwright',
      );
    default:
      return join(home, '.cache', 'ms-playwright');
  }
}

/**
 * `boxel test` runs `chromium.launch({ headless: true })`, which uses
 * Playwright's `chromium-headless-shell` binary. This is a cheap heuristic —
 * the presence of a downloaded `chromium_headless_shell-*` build in the browser
 * cache — rather than an actual browser launch. `npx playwright install
 * chromium` also downloads the headless shell, so this covers both install
 * commands. When the browser path can't be determined (PLAYWRIGHT_BROWSERS_PATH
 * set to '0'), assume present so we don't block on a false negative.
 */
export function playwrightHeadlessShellPresent(): boolean {
  let root = playwrightBrowsersRoot();
  if (!root) return true;
  if (!existsSync(root)) return false;
  try {
    return readdirSync(root).some((name) =>
      name.startsWith('chromium_headless_shell-'),
    );
  } catch {
    return false;
  }
}

export function checkPrerequisites(): Prerequisite[] {
  return [
    {
      id: 'node',
      label: `Node >= ${MIN_NODE_MAJOR} (found ${process.versions.node})`,
      satisfied: isNodeVersionOk(),
      fix: `Install Node >= ${MIN_NODE_MAJOR} (repo pins ${PINNED_NODE} via .nvmrc); e.g. \`nvm use\` or \`volta install node@${MIN_NODE_MAJOR}\``,
    },
    {
      id: 'boxel-cli-api',
      label: 'boxel-cli API bundle (packages/boxel-cli/dist/api.js)',
      satisfied: boxelCliApiJsExists(),
      fix: 'pnpm --filter @cardstack/boxel-cli build:api',
    },
    {
      id: 'host-dist',
      label:
        'host dev build with test entries (packages/host/dist/tests/index.html)',
      satisfied: hostTestHarnessExists(),
      fix: 'pnpm --filter @cardstack/host build',
    },
    {
      id: 'playwright-chromium',
      label: 'Playwright Chromium headless-shell binary',
      satisfied: playwrightHeadlessShellPresent(),
      fix: 'npx playwright install chromium-headless-shell',
    },
  ];
}

export function missingPrerequisites(): Prerequisite[] {
  return checkPrerequisites().filter((p) => !p.satisfied);
}

export function formatMissingPrerequisites(missing: Prerequisite[]): string {
  let lines = [
    `Cannot run the factory: ${missing.length} prerequisite${
      missing.length === 1 ? ' is' : 's are'
    } missing.`,
    '',
    'Provision everything at once:',
    '  pnpm factory:setup',
    '',
    'Or fix each individually:',
  ];
  for (let p of missing) {
    lines.push(`  • ${p.label}`);
    lines.push(`      ${p.fix}`);
  }
  return lines.join('\n');
}
