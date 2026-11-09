'use strict';

// Runs the component suite from the development build in dist-tests
// (`pnpm test:components`).
module.exports = {
  test_page: 'tests/index.html?hidepassed',
  disable_watching: true,
  launch_in_ci: ['Chrome'],
  launch_in_dev: ['Chrome'],
  browser_start_timeout: 120,
  browser_args: {
    Chrome: {
      ci: [
        // --no-sandbox is needed when running Chrome inside a container
        process.env.CI ? '--no-sandbox' : null,
        '--headless',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--mute-audio',
        '--remote-debugging-port=0',
        '--window-size=1440,900',
        // Each test sets the page's address with history.replaceState, and
        // Chrome otherwise ignores those calls past about 100 in ten seconds,
        // so a long run would leave a later test at an earlier one's address.
        '--disable-ipc-flooding-protection',
      ].filter(Boolean),
    },
  },
};
