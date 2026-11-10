// Puppeteer reads this file from the working directory upward, both when its
// postinstall downloads a browser and when `launch()` resolves one, so every
// package in the repo picks it up.
//
// The pin applies only where no browser is supplied. `PUPPETEER_EXECUTABLE_PATH`
// takes precedence, and `mise-tasks/lib/env-vars.sh` sets it to the installed
// Chrome whenever there is one, CI included. Without a pin, the fallback is the
// Chrome for Testing build that Puppeteer's release bundles, which falls behind
// Chrome's security releases between Puppeteer releases.
//
// Keep this at or above `CHROME_MIN_VERSION` in
// `packages/realm-server/prerender.Dockerfile`, and raise both when a Chrome
// stable release fixes a High or Critical vulnerability. Puppeteer's
// postinstall doesn't re-run when only this file changes, so a checkout that
// installed an older pin is missing the new build, and its launch fails with
// "Tried to find the browser at the configured path". The dev prerender task
// (`mise-tasks/services/prerender`) fetches the build itself; anywhere else,
// run `pnpm exec puppeteer browsers install` in `packages/realm-server`.
const CHROME_FOR_TESTING_VERSION = '157.0.8103.38';

/** @type {import('puppeteer').Configuration} */
module.exports = {
  chrome: { version: CHROME_FOR_TESTING_VERSION },
  'chrome-headless-shell': { version: CHROME_FOR_TESTING_VERSION },
};
