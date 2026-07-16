'use strict';

if (typeof module !== 'undefined') {
  const MultiReporter = require('testem-multi-reporter');
  const TapReporter = require('testem/lib/reporters/tap_reporter');
  const XunitReporter = require('testem/lib/reporters/xunit_reporter');
  const fs = require('fs');
  const path = require('path');

  const config = {
    test_page: 'tests/index.html?hidepassed',
    disable_watching: true,
    browser_timeout: 120,
    browser_no_activity_timeout: 120,
    browser_disconnect_timeout: 60,
    launch_in_ci: ['Chrome'],
    launch_in_dev: ['Chrome'],
    browser_start_timeout: 240,
    browser_args: {
      Chrome: {
        ci: [
          // --no-sandbox is needed when running Chrome inside a container
          process.env.CI ? '--no-sandbox' : null,
          '--headless',
          '--disable-dbus',
          '--disable-dev-shm-usage',
          '--disable-software-rasterizer',
          '--js-flags=--max-old-space-size=4096 --expose-gc',
          '--enable-precise-memory-info',
          '--mute-audio',
          '--remote-debugging-port=0',
          '--window-size=1440,900',
          // The realm-server speaks HTTPS+HTTP/2 with a mkcert leaf cert
          // (see infra:ensure-dev-cert). `mkcert -install` is
          // best-effort in CI and doesn't reliably land mkcert's root
          // CA in headless Chrome's trust store, so relax cert checks
          // for the realm fetches the tests make. Safe — the URL is
          // fixed by the host config and the connection is loopback.
          // Chrome 144+ silently demotes `--ignore-certificate-errors`
          // to a dev-only flag unless paired with
          // `--allow-insecure-localhost`; without the pair, every
          // realm fetch fails with `TypeError: Failed to fetch`.
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
      path.join(junitDir, 'host-testem.log'),
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
          fs.createWriteStream(
            path.join(junitDir, `host-${process.env.HOST_TEST_PARTITION}.xml`),
          ),
          { get: () => false },
        ],
      },
    ];

    const multiReporter = new MultiReporter({ reporters });

    config.reporter = multiReporter;

    // Capture testem's own internal log to a file. testem only writes its
    // server-side events (socket attach / disconnect, disconnectCount, the
    // `socket reconnection limit has been exceeded` refusal, `Browser …
    // finished all tests`, process exit) to `log.stream`, and that stream is
    // a no-op sink unless `debug` names a path. Those events are the only
    // record of the browser↔testem handshake that produces the intermittent
    // post-suite `Browser timeout exceeded` synthetic failure — the TAP
    // output shows the passing tests but nothing about why the browser is
    // declared dead afterward. Persist it so the next occurrence shows which
    // side of the handshake dropped (uploaded as a CI artifact).
    config.debug = path.join(
      junitDir,
      `host-testem-debug-${process.env.HOST_TEST_PARTITION}.log`,
    );
  }

  module.exports = config;
}
