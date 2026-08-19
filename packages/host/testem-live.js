'use strict';

const MultiReporter = require('testem-multi-reporter');
const TapReporter = require('testem/lib/reporters/tap_reporter');
const XunitReporter = require('testem/lib/reporters/xunit_reporter');
const fs = require('fs');
const path = require('path');

const DEFAULT_REALM_URLS = ['https://localhost:4201/skills/'];

// REALM_URL may name one realm or a comma-separated list (each realm gets its
// own live-test discovery page below). Trim + drop empties so a single value or
// a trailing comma both behave.
const realmURLs = process.env.REALM_URL
  ? process.env.REALM_URL.split(',')
      .map((url) => url.trim())
      .filter(Boolean)
  : DEFAULT_REALM_URLS;

// Optional QUnit filter (plain substring or /regex/) so a caller can run a
// subset of the realm's tests — e.g. content-only catalog PRs run just the
// real-catalog-app smoke test.
const filterParam = process.env.LIVE_TEST_FILTER
  ? `&filter=${encodeURIComponent(process.env.LIVE_TEST_FILTER)}`
  : '';

const config = {
  test_page: realmURLs.map(
    (url) =>
      `tests/index.html?liveTest=true&realmURL=${encodeURIComponent(url)}&hidepassed${filterParam}`,
  ),
  disable_watching: true,
  browser_timeout: 120,
  browser_no_activity_timeout: 120,
  browser_disconnect_timeout: 20,
  browser_start_timeout: 240,
  launch_in_ci: ['Chrome'],
  launch_in_dev: ['Chrome'],
  browser_args: {
    Chrome: {
      ci: [
        process.env.CI ? '--no-sandbox' : null,
        '--headless',
        '--disable-dbus',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--mute-audio',
        '--remote-debugging-port=0',
        '--window-size=1440,900',
        // Local realm-server speaks HTTPS+HTTP/2 with a mkcert leaf cert
        // (see infra:ensure-dev-cert). `mkcert -install` is best-effort
        // in CI and may not land the root CA in the headless Chrome
        // trust store, so relax cert checks for the realm fetches that
        // the live-test runner makes. These flags disable TLS validation
        // for every HTTPS request in the session, so this testem config
        // is dev / CI only — it assumes REALM_URL (default
        // DEFAULT_REALM_URLS above) is a loopback origin. Chrome 144+
        // requires the `--allow-insecure-localhost` companion or it
        // silently demotes `--ignore-certificate-errors` and TLS
        // validation still fails.
        '--ignore-certificate-errors',
        '--allow-insecure-localhost',
      ].filter(Boolean),
    },
  },
};

if (process.env.CI) {
  const junitDir = path.join(__dirname, '..', '..', 'junit');
  fs.mkdirSync(junitDir, { recursive: true });
  const testemLog = fs.createWriteStream(
    path.join(junitDir, 'host-live-testem.log'),
  );

  const reporters = [
    {
      ReporterClass: TapReporter,
      args: [false, null, { get: () => false }],
    },
    {
      ReporterClass: TapReporter,
      args: [false, testemLog, { get: () => false }],
    },
    {
      ReporterClass: XunitReporter,
      args: [
        false,
        fs.createWriteStream(path.join(junitDir, 'host-live.xml')),
        { get: () => false },
      ],
    },
  ];

  config.reporter = new MultiReporter({ reporters });
}

module.exports = config;
