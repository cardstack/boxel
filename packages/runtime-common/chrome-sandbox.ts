// Whether a browser this repository launches keeps Chrome's sandbox on. Every
// Playwright and Puppeteer launch takes that decision from here, so the gate
// and its reason (ADR 020 §1.2) live in one place. Node-only: it reads
// `process.platform`.
//
// On macOS and Windows, Chrome starts its sandbox without privileges, so it is
// on. On Linux it is off, because whether the sandbox starts there depends on
// the browser build and the host, and a launch that fails runs nothing:
// - Playwright's bundled Chromium has no setuid sandbox helper, so it needs
//   unprivileged user namespaces, which Ubuntu 23.10+ blocks for it by default.
// - Chrome refuses to start its sandbox as root, and some CI and container
//   hosts run as root.
// - The deployed prerenderer is a Linux ECS task where the sandbox has not
//   been shown to start. Linux CI and dev machines launch the way that task
//   does, so CI tests the configuration that ships.
//
// The gate is the platform, not an env var, so a missing variable can't break
// a launch.

/**
 * Whether a launch keeps Chrome's sandbox on. Playwright starts Chromium with
 * the sandbox off unless asked, so a Playwright launch passes this as
 * `chromiumSandbox`. A Puppeteer launch adds `CHROME_NO_SANDBOX_ARGS` when it
 * is false.
 */
export function chromeSandboxEnabled(): boolean {
  return process.platform !== 'linux';
}

/** The Chrome flags that run it without the sandbox. */
export const CHROME_NO_SANDBOX_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
];
