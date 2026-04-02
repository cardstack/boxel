'use strict';

const MultiReporter = require('testem-multi-reporter');
const TapReporter = require('testem/lib/reporters/tap_reporter');
const XunitReporter = require('testem/lib/reporters/xunit_reporter');
const fs = require('fs');
const path = require('path');

const config = {
  test_page:
    'tests/index.html?liveTest=true&realmURL=http://localhost:4201/catalog/&hidepassed',
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
