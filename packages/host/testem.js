'use strict';
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
  browser_disconnect_timeout: 20,
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
        '--mute-audio',
        '--remote-debugging-port=0',
        '--window-size=1440,900',
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
}

if (typeof module !== 'undefined') {
  module.exports = config;
}
